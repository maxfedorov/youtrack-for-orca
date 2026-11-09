/** Safe process execution: execFile with an argv array only, never a shell string. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const MAX_CONCURRENT = 4
const STRIPPED_ENV = ['YOUTRACK_TOKEN', 'YOUTRACK_BASE_URL']

let active = 0
const waiting = []

function acquire() {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

function release() {
  const next = waiting.shift()
  if (next) next()
  else active--
}

/**
 * @typedef {{ exitCode: number | null, stdout: string, stderr: string, timedOut: boolean, spawnError?: string }} ProcResult
 * Run a process (at most 4 at once). Never rejects.
 * `env` is merged over process.env; YOUTRACK_TOKEN / YOUTRACK_BASE_URL are always removed.
 * `onStderrLine` receives complete stderr lines as they arrive.
 * @param {string} file
 * @param {string[]} args
 * @param {{ timeoutMs: number, input?: string, env?: Record<string, string>, onStderrLine?: (line: string) => void }} opts
 * @param {typeof execFile} [execFileImpl]
 * @returns {Promise<ProcResult>}
 */
export async function runProcess(file, args, opts, execFileImpl = execFile) {
  await acquire()
  try {
    const env = { ...process.env, ...(opts.env ?? {}) }
    for (const k of STRIPPED_ENV) delete env[k]
    return await new Promise((resolve) => {
      let child
      try {
        child = execFileImpl(
          file,
          args,
          { timeout: opts.timeoutMs, env, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
          (err, stdout, stderr) => {
            const out = { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
            if (!err) return resolve({ exitCode: 0, ...out, timedOut: false })
            const timedOut = Boolean(err.killed)
            const spawnError = typeof err.code === 'string' ? err.code : undefined
            const res = {
              exitCode: typeof err.code === 'number' ? err.code : null,
              ...out,
              timedOut
            }
            if (spawnError) res.spawnError = spawnError
            resolve(res)
          }
        )
      } catch (e) {
        return resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: e?.code ?? 'EXEC_FAILED' })
      }
      if (opts.onStderrLine && child?.stderr) {
        let buf = ''
        child.stderr.setEncoding?.('utf8')
        child.stderr.on('data', (chunk) => {
          buf += chunk
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).replace(/\r$/, '')
            buf = buf.slice(i + 1)
            if (line) opts.onStderrLine(line)
          }
        })
        child.stderr.on('end', () => {
          if (buf.trim()) opts.onStderrLine(buf.replace(/\r$/, ''))
          buf = ''
        })
      }
      if (child?.stdin) {
        if (opts.input !== undefined) child.stdin.end(opts.input)
        else child.stdin.end()
      }
    })
  } finally {
    release()
  }
}

/**
 * Find an executable on PATH. win32: env.Path ?? env.PATH, `;` separator, PATHEXT extensions.
 * @param {string} name
 * @param {{ env?: Record<string, string | undefined>, platform?: string, exists?: (p: string) => boolean }} [o]
 * @returns {string | null}
 */
export function findOnPath(name, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const win = platform === 'win32'
  const pathVar = (win ? (env.Path ?? env.PATH) : env.PATH) ?? ''
  const dirs = pathVar.split(win ? ';' : ':').filter(Boolean)
  const exts = win ? (env.PATHEXT || '.EXE;.CMD').split(';').filter(Boolean) : ['']
  const join = win ? path.win32.join : path.posix.join
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (exists(candidate)) return candidate
    }
  }
  return null
}
