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

/**
 * Keep an issue detail well under the 1 MiB answer limit: cut the description and long comments,
 * keep the newest comments. `truncated: true` marks the detail and each cut comment.
 */
export function capDetail(detail) {
  let truncated = false
  const out = { ...detail }
  if (out.descriptionMd.length > MAX_DESCRIPTION) {
    out.descriptionMd = out.descriptionMd.slice(0, MAX_DESCRIPTION)
    truncated = true
  }
  let comments = out.comments
  if (comments.length > MAX_COMMENTS) {
    comments = comments.slice(-MAX_COMMENTS)
    truncated = true
  }
  out.comments = comments.map((c) => {
    if (c.textMd.length <= MAX_COMMENT) return c
    truncated = true
    return { ...c, textMd: c.textMd.slice(0, MAX_COMMENT), truncated: true }
  })
  if (truncated) out.truncated = true
  return out
}
