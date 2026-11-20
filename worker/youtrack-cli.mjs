/** Wrapper around the `youtrack` CLI: argv building, error classification, locating the binary. */
import path from 'node:path'
import { ok, fail, CODES } from './result.mjs'
import { findOnPath, runProcess } from './exec.mjs'
import { MAX_VALUES } from './project-fields.mjs'

const READ_MS = 15_000
const WRITE_MS = 30_000
const LOGIN_MS = 10 * 60_000
const SKILL_MS = 60_000
const ISSUE_FIELDS = 'idReadable,summary,created,updated,resolved,State,Priority,Assignee'
/** The list's fields plus the columns' custom fields, each once (names compare without case). */
const listFields = (columns) => {
  const names = ISSUE_FIELDS.split(',')
  const seen = new Set(names.map((n) => n.toLowerCase()))
  for (const c of columns) if (!seen.has(c.toLowerCase())) seen.add(c.toLowerCase()) && names.push(c)
  return names.join(',')
}
const VIEW_FIELDS = 'tags(name),reporter(login,fullName),customFields(name,value(name,login,fullName,text,presentation,minutes,$type),$type,projectCustomField(emptyFieldText,canBeEmpty,field(fieldType(id))))'
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
  const profile = env.USERPROFILE || homedir
  // Orca leaves LOCALAPPDATA out of a plugin worker's environment.
  const local = env.LOCALAPPDATA || p.join(profile, 'AppData', 'Local')
  const candidates = win
    ? [
        p.join(profile, '.local', 'bin', 'youtrack.exe'),
        p.join(local, 'Microsoft', 'WinGet', 'Links', 'youtrack.exe'),
        p.join(profile, 'scoop', 'shims', 'youtrack.exe')
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

/** The `message` of each JSON object the CLI printed one after another (one per agent). */
function messagesOf(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('{')) continue
    for (let j = i; j < lines.length; j++) {
      try {
        const m = JSON.parse(lines.slice(i, j + 1).join('\n'))?.message
        if (typeof m === 'string' && m) out.push(m.slice(0, 300))
        i = j
        break
      } catch {
        // incomplete; try a longer slice
      }
    }
  }
  return out.slice(0, 50)
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
    /** `columns`: custom fields to read for the list's columns; ones a project lacks are skipped by the CLI. */
    listIssues: (server, query, offset, limit, columns = []) =>
      read(server, ['issue', 'list', '--query', query, '--limit', String(limit), '--offset', String(offset), '--fields', listFields(columns)], list),
    countIssues: (server, query) =>
      exec(['--server', server, 'issue', 'count', '--query', query, ...tail], READ_MS, (s) => {
        const n = Number(s.trim())
        if (!Number.isFinite(n) || s.trim() === '') throw new Error('not a number')
        return n
      }),
    viewIssue: (server, id) => read(server, ['issue', 'view', id, '-f', VIEW_FIELDS]),
    listComments: (server, id) => read(server, ['issue', 'comment', 'list', id], list),
    listLinks: (server, id) => read(server, ['issue', 'link', 'list', id, '-f', 'issues(idReadable,summary,resolved)'], list),
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
     * Installs the YouTrack CLI skill for every coding agent the CLI finds on this machine, or brings
     * an older copy up to date; already current copies are left alone.
     */
    updateSkill: () => exec(['skill', 'update', ...tail], SKILL_MS, (s) => ({ messages: messagesOf(s) })),
    /** Projects the account can see, by short name. */
    listProjects: (server) =>
      read(server, ['project', 'list'], (s) =>
        (JSON.parse(s) ?? [])
          .filter((p) => typeof p?.shortName === 'string' && p.shortName)
          .slice(0, 500)
          .map((p) => ({ shortName: p.shortName, name: typeof p.name === 'string' ? p.name : p.shortName }))
      ),
    /** The values one field of an issue (or a draft) offers this user, from the issue's field context. */
    fieldValues: (server, id, field) =>
      exec(['--server', server, 'issue', 'field', 'list-values', '--limit', String(MAX_VALUES), ...tail, '--', id, field], READ_MS, list),
    /** A new draft in a project: what the new-issue form reads its fields from, and submits at the end. */
    draftCreate: (server, project) =>
      exec(['--server', server, 'issue', 'draft', 'create', '--project', project, ...tail], WRITE_MS, (s) => {
        const id = JSON.parse(s)?.id
        if (typeof id !== 'string' || !id) throw new Error('no id')
        return { id }
      }),
    /** Fills a draft: summary as one `--summary=` argument, fields as one JSON argument, description on standard input. */
    draftUpdate: (server, draftId, { summary, description, fields }) => {
      const args = ['--server', server, 'issue', 'draft', 'update', `--summary=${summary}`, '--description-file', '-']
      if (Object.keys(fields).length > 0) args.push(`--custom-fields=${JSON.stringify(fields)}`)
      return exec([...args, ...tail, '--', draftId], WRITE_MS, () => ({}), { input: description })
    },
    /** Turns the draft into an issue; answers its readable id. */
    draftSubmit: (server, draftId) =>
      exec(['--server', server, 'issue', 'draft', 'submit', ...tail, '--', draftId], WRITE_MS, (s) => {
        const id = JSON.parse(s)?.idReadable
        if (typeof id !== 'string' || !id) throw new Error('no id')
        return { id }
      }),
    /** Deletes a draft without asking (the panel's Back or another project). */
    draftDelete: (server, draftId) =>
      exec(['--server', server, 'issue', 'draft', 'delete', '--force', ...tail, '--', draftId], WRITE_MS, () => ({})),
    /** Sets one field of an issue, or empties it with `clear`; issue, field and value come after `--`. */
    setField: (server, id, field, { value, user = false, clear = false }) => {
      const args = ['--server', server, 'issue', 'field', 'set']
      if (user) args.push('--type', 'user')
      if (clear) args.push('--clear')
      return exec([...args, ...tail, '--', id, field, ...(clear ? [] : [value])], WRITE_MS, () => ({}))
    },
    /**
     * Changes the summary, the description or both. The summary is one `--summary=` argument, so it is
     * never read as a flag; the description goes through standard input ('' clears it).
     */
    updateIssue: (server, id, { summary, description }) => {
      const args = ['--server', server, 'issue', 'update']
      if (summary !== undefined) args.push(`--summary=${summary}`)
      if (description !== undefined) args.push('--description-file', '-')
      const extra = description !== undefined ? { input: description } : {}
      return exec([...args, ...tail, '--', id], WRITE_MS, () => ({}), extra)
    },
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
