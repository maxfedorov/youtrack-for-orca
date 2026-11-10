/** Wrapper around the `youtrack` CLI: argv building, error classification, locating the binary. */
import path from 'node:path'
import { ok, fail, CODES } from './result.mjs'
import { findOnPath, runProcess } from './exec.mjs'

const READ_MS = 15_000
const WRITE_MS = 30_000
const LOGIN_MS = 10 * 60_000
const ISSUE_FIELDS = 'idReadable,summary,created,updated,resolved,State,Priority,Assignee'
const VIEW_FIELDS = 'tags(name),reporter(login,fullName),customFields(name,value(name,login,fullName,text,presentation,minutes,$type),$type,projectCustomField(emptyFieldText))'
const CLI_ENV = Object.freeze({ YOUTRACK_NO_UPDATE: '1', NO_COLOR: '1' })

/**
 * Locate the youtrack binary: setting, PATH, then well-known install dirs.
 * @param {{ settingPath?: string, env: Record<string, string | undefined>, platform: string, homedir: string, exists: (p: string) => boolean }} o
 * @returns {string | null}
 */
export function resolveYoutrack({ settingPath, env, platform, homedir, exists }) {
  if (settingPath && exists(settingPath)) return settingPath
  const onPath = findOnPath('youtrack', { env, platform, exists })
  if (onPath) return onPath
  const win = platform === 'win32'
  const p = win ? path.win32 : path.posix
  const candidates = win
    ? [
        p.join(env.USERPROFILE || homedir, '.local', 'bin', 'youtrack.exe'),
        env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'youtrack.exe'),
        p.join(env.USERPROFILE || homedir, 'scoop', 'shims', 'youtrack.exe')
      ]
    : [p.join(homedir, '.local', 'bin', 'youtrack'), '/opt/homebrew/bin/youtrack', '/usr/local/bin/youtrack']
  return candidates.find((c) => c && exists(c)) ?? null
}

/** Find the first `{ error: {...} }` object in stderr; the JSON may be one line or indented. */
function parseCliError(stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('{')) continue
    for (let j = i; j < lines.length; j++) {
      try {
        const e = JSON.parse(lines.slice(i, j + 1).join('\n'))?.error
        if (e && typeof e === 'object') return e
        break
      } catch {
        // incomplete or not JSON, e.g. a `warning:` line; try a longer slice
      }
    }
  }
  return null
}

/**
 * Map a failed CLI run to a domain error.
 * @param {{ exitCode?: number | null, stderr?: string, timedOut?: boolean, spawnError?: string, tooLarge?: boolean }} r
 * @returns {{ code: string, message: string }}
 */
export function classifyCliError({ stderr, timedOut, spawnError, tooLarge }) {
  if (spawnError === 'ENOENT') return { code: CODES.CLI_NOT_FOUND, message: 'The YouTrack CLI was not found.' }
  if (spawnError) {
    // Found but not runnable, such as a folder or a file without permission to run it.
    return { code: CODES.CLI_NOT_FOUND, message: `The YouTrack CLI could not be started (${spawnError}). Check the YouTrack CLI path in the plugin settings.` }
  }
  if (tooLarge) return { code: CODES.UNKNOWN, message: 'The YouTrack CLI answered with more data than the plugin can read.' }
  if (timedOut) return { code: CODES.TIMEOUT, message: 'The YouTrack CLI did not answer in time.' }
  const err = parseCliError(stderr)
  if (!err) {
    const text = String(stderr ?? '').trim().split(/\r?\n/).filter(Boolean).pop()
    return { code: CODES.UNKNOWN, message: text || 'The YouTrack CLI failed.' }
  }
  const message = String(err.message ?? 'The YouTrack CLI failed.')
  const c = err.code
  const http = /HTTP (\d{3})/.exec(message)?.[1]
  if (c === 'unauthorized' || http === '401') return { code: CODES.AUTH_FAILED, message }
  if (c === 'forbidden' || http === '403') return { code: CODES.FORBIDDEN, message }
  if (c === 'not_found' || http === '404') return { code: CODES.NOT_FOUND, message }
  if (c === 'api_error' && http === '400' && /Can't parse search query/.test(message)) {
    return { code: CODES.QUERY_INVALID, message }
  }
  if (/unknown server profile/.test(message)) return { code: CODES.NO_SERVERS, message }
  if (c === 'internal_error' && /dial tcp|no such host|network is unreachable|connection refused|Client\.Timeout/.test(message)) {
    return { code: CODES.NETWORK, message }
  }
  return { code: CODES.UNKNOWN, message }
}

/**
 * @param {{ bin: string, run?: (args: string[], opts: object) => Promise<import('./exec.mjs').ProcResult> }} o
 */
export function createYoutrack({ bin, run = (args, opts) => runProcess(bin, args, opts) }) {
  const tail = ['--json', '--quiet']

  async function exec(args, timeoutMs, parse, extra = {}) {
    const r = await run(args, { timeoutMs, env: { ...CLI_ENV }, ...extra })
    if (r.exitCode !== 0 || r.timedOut || r.spawnError || r.tooLarge) {
      const e = classifyCliError(r)
      return fail(e.code, e.message)
    }
    try {
      return ok(parse(r.stdout, r))
    } catch {
      return fail(CODES.UNKNOWN, 'The YouTrack CLI returned an unexpected answer.')
    }
  }

  const json = (s) => JSON.parse(s)
  /** A list the CLI found empty can come back as `null`. */
  const list = (s) => JSON.parse(s) ?? []
  const read = (server, args, parse = json) => exec(['--server', server, ...args, ...tail], READ_MS, parse)

  return {
    version: () => exec(['--version'], READ_MS, (s) => s.trim()),
    instances: () => exec(['instance', 'list', ...tail], READ_MS, list),
    listIssues: (server, query, offset, limit) =>
      read(server, ['issue', 'list', '--query', query, '--limit', String(limit), '--offset', String(offset), '--fields', ISSUE_FIELDS], list),
    countIssues: (server, query) =>
      exec(['--server', server, 'issue', 'count', '--query', query, ...tail], READ_MS, (s) => {
        const n = Number(s.trim())
        if (!Number.isFinite(n) || s.trim() === '') throw new Error('not a number')
        return n
      }),
    viewIssue: (server, id) => read(server, ['issue', 'view', id, '-f', VIEW_FIELDS]),
    listComments: (server, id) => read(server, ['issue', 'comment', 'list', id], list),
    savedSearches: (server) => read(server, ['search', 'list'], list),
    createSavedSearch: (server, name, query) =>
      exec(['--server', server, 'search', 'create', '--name', name, '--query', query, ...tail], WRITE_MS, json),
    /**
     * Applies a YouTrack command; after `--`, so a command starting with a dash is not read as a flag.
     * `--no-new-tags`: a mistyped tag name fails instead of creating a new tag.
     */
    applyCommand: (server, id, command) =>
      exec(['--server', server, 'issue', 'command', '--no-new-tags', ...tail, '--', id, command], WRITE_MS, () => ({})),
    /**
     * Adds a comment with the server's default visibility; the text goes through standard input, so
     * it is never read as a flag and has no command-line length limit.
     */
    addComment: (server, id, text) =>
      exec(['--server', server, 'issue', 'comment', 'create', '--text-file', '-', ...tail, '--', id], WRITE_MS, () => ({}), { input: text }),
    /**
     * Removes a configured server from the CLI, which signs it out; after `--`, so an alias starting
     * with a dash is not read as a flag. `--force` skips the CLI's own confirmation (the panel asks).
     * `warning`: what the CLI warned about, such as a token left in the keyring.
     */
    deleteInstance: (alias) =>
      // Without --quiet: the CLI then prints its warnings ("! …" on stderr), such as a sign-in token
      // it could not remove from the system keyring.
      exec(['instance', 'delete', '--force', '--json', '--', alias], WRITE_MS, (stdout, r) => {
        const warnings = String(r.stderr ?? '').split(/\r?\n/).filter((l) => l.startsWith('! ')).map((l) => l.slice(2).trim()).filter(Boolean)
        return warnings.length ? { warning: warnings.join('\n') } : {}
      }),
    /** @param {string} url @param {(authUrl: string) => void} onAuthUrl */
    loginWeb: (url, onAuthUrl) =>
      exec(['auth', 'login', url, '--web', '--json'], LOGIN_MS, (s) => (s.trim() ? json(s) : {}), {
        onStderrLine: (line) => {
          if (!line.trim().startsWith('{')) return
          try {
            const u = JSON.parse(line)?.authorizationUrl
            if (typeof u === 'string') onAuthUrl(u)
          } catch {
            // ignore non-JSON lines
          }
        }
      })
  }
}
