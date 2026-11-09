/** Shared input checks and the error boundary for every request handler. */
import { fail, CODES } from '../result.mjs'

export const ISSUE_ID = /^[A-Za-z0-9_]+-\d+$/
export const MAX_QUERY = 2000
export const MAX_NAME = 60
const MAX_TOKEN = 500

export const invalid = (message) => fail(CODES.UNKNOWN, message)

/** The panel <-> worker answer limit is 1 MiB; stay under it with some room. */
export const MAX_ANSWER_BYTES = 1_000_000

const errorName = (e) => (e instanceof Error ? e.name : typeof e)

/**
 * A plain JSON copy of what a handler returned, shaped as a Result: anything else (no Result, a
 * failure without code or message, values JSON cannot carry, an answer over the size limit) becomes
 * an `UNKNOWN` failure, so the panel always gets an answer it can show.
 */
function toAnswer(r) {
  if (!r || typeof r !== 'object' || typeof r.ok !== 'boolean') return fail(CODES.UNKNOWN, 'The request returned no answer.')
  if (!r.ok) {
    const code = typeof r.error?.code === 'string' && r.error.code ? r.error.code : CODES.UNKNOWN
    const message = typeof r.error?.message === 'string' && r.error.message ? r.error.message : 'The request failed.'
    return fail(code, message)
  }
  let text
  try {
    text = JSON.stringify(r.data === undefined ? { ok: true, data: {} } : r)
  } catch {
    return fail(CODES.UNKNOWN, 'The request returned an answer that cannot be sent.')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_ANSWER_BYTES) return fail(CODES.UNKNOWN, 'The answer is too large to show.')
  return JSON.parse(text)
}

/**
 * Wrap a handler: it always resolves to a JSON-safe Result. Unexpected exceptions become `UNKNOWN`
 * results and are logged by request name only (the message may hold issue text).
 * @param {(input: any) => Promise<any>} fn
 * @param {{ name?: string, log?: (message: string) => void }} [o]
 */
export function guard(fn, { name = 'request', log } = {}) {
  return async (input) => {
    try {
      return toAnswer(await fn(input && typeof input === 'object' ? input : {}))
    } catch (e) {
      try {
        log?.(`${name} failed: ${errorName(e)}`)
      } catch {
        // logging is best effort
      }
      return fail(CODES.UNKNOWN, e instanceof Error && e.message ? e.message : 'Something went wrong.')
    }
  }
}

/** Register a panel request handler behind `guard`. */
export function safeHandle(orca, name, fn) {
  return orca.panels.handle(name, guard(fn, { name, log: (m) => orca.log?.(m) }))
}

/** Post to the panels; a failed post (no panel open, rate limit) is dropped, never thrown or left unhandled. */
export function safePost(orca, name, payload) {
  try {
    Promise.resolve(orca.panels.post(name, payload)).catch(() => {})
  } catch {
    // dropped
  }
}

/** A CLI issue object with a readable id; rows without one cannot be shown or opened. */
export const hasId = (raw) => raw !== null && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.idReadable === 'string' && raw.idReadable !== ''

/** Shown when the youtrack CLI answered with JSON of an unexpected shape. */
export const unexpected = () => fail(CODES.UNKNOWN, 'The youtrack CLI returned an unexpected answer.')

/** A non-empty string value that cannot be mistaken for a command-line flag. */
export function token(v, what) {
  if (typeof v !== 'string' || !v.trim() || v.length > MAX_TOKEN || v.startsWith('-')) return `Invalid ${what}`
  return null
}

export const settingString = (v, fallback) => (typeof v === 'string' ? v : fallback)

/** Only plain http(s) host/path urls; nothing a shell would treat specially. */
const PLAIN_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/
export const isPlainUrl = (v) => typeof v === 'string' && v.length <= 200 && PLAIN_URL.test(v)

export const normalizeUrl = (u) => String(u).replace(/\/+$/, '').toLowerCase()
export const issueUrl = (baseUrl, id) => `${String(baseUrl).replace(/\/+$/, '')}/issue/${id}`

export const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
export const MAX_DESCRIPTION = 100_000
export const MAX_COMMENT = 20_000
export const MAX_COMMENTS = 200

export const MAX_DETAIL_BYTES = 900_000
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8')

/** Cut to at most `n` UTF-16 units without leaving half of a surrogate pair. */
function cut(text, n) {
  if (text.length <= n) return text
  const code = text.charCodeAt(n - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n)
}

/**
 * Keep an issue detail under the 1 MiB answer limit: cut the description and long comments, keep the
 * newest comments, then drop the oldest comments (and finally shorten the description) until the
 * serialized detail fits in MAX_DETAIL_BYTES. `truncated: true` marks the detail and each cut comment;
 * `commentsOmitted` counts comments dropped.
 */
export function capDetail(detail) {
  let truncated = false
  const out = { ...detail }
  if (out.descriptionMd.length > MAX_DESCRIPTION) {
    out.descriptionMd = cut(out.descriptionMd, MAX_DESCRIPTION)
    truncated = true
  }
  let comments = out.comments
  let omitted = 0
  if (comments.length > MAX_COMMENTS) {
    omitted = comments.length - MAX_COMMENTS
    comments = comments.slice(-MAX_COMMENTS)
  }
  comments = comments.map((c) => {
    if (c.textMd.length <= MAX_COMMENT) return c
    truncated = true
    return { ...c, textMd: cut(c.textMd, MAX_COMMENT), truncated: true }
  })
  // Each comment adds its own size plus a comma to the serialized array.
  const sizes = comments.map((c) => bytes(c) + 1)
  let total = bytes({ ...out, comments: [] }) + sizes.reduce((a, b) => a + b, 0)
  let first = 0
  while (total > MAX_DETAIL_BYTES && first < comments.length) total -= sizes[first++]
  omitted += first
  out.comments = comments.slice(first)
  while (total > MAX_DETAIL_BYTES && out.descriptionMd.length > 0) {
    out.descriptionMd = cut(out.descriptionMd, Math.floor(out.descriptionMd.length / 2))
    total = bytes(out)
    truncated = true
  }
  if (omitted > 0) {
    out.commentsOmitted = omitted
    truncated = true
  }
  if (truncated) out.truncated = true
  return out
}

/** Shell line that installs the youtrack CLI, per platform; shown by `yt.env`, run by `yt.terminal.run`. */
export const INSTALL = {
  darwin: 'brew install jetbrains/utils/youtrack',
  linux: 'brew install jetbrains/utils/youtrack',
  win32: 'winget install JetBrains.YouTrackCLI'
}
