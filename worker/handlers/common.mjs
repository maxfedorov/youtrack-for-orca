/** Shared input checks and the error boundary for every request handler. */
import { fail, CODES } from '../result.mjs'

export const ISSUE_ID = /^[A-Za-z0-9_]+-\d+$/
export const MAX_QUERY = 2000
export const MAX_NAME = 60
const MAX_TOKEN = 500

export const invalid = (message) => fail(CODES.UNKNOWN, message)

/** Wrap a handler: unexpected exceptions become `UNKNOWN` results, never throws. */
export function guard(fn) {
  return async (input) => {
    try {
      return await fn(input && typeof input === 'object' ? input : {})
    } catch (e) {
      return fail(CODES.UNKNOWN, e instanceof Error ? e.message : String(e))
    }
  }
}

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
