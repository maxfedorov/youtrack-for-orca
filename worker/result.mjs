/** Result helpers shared by every worker handler: domain errors are returned, never thrown. */

export const CODES = Object.freeze({
  CLI_NOT_FOUND: 'CLI_NOT_FOUND',
  NO_SERVERS: 'NO_SERVERS',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK: 'NETWORK',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  QUERY_INVALID: 'QUERY_INVALID',
  ORCA_CLI_NOT_FOUND: 'ORCA_CLI_NOT_FOUND',
  ORCA_CLI_FAILED: 'ORCA_CLI_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
  PROMPT_TOO_LONG: 'PROMPT_TOO_LONG'
})

export function ok(data) {
  return { ok: true, data }
}

export function fail(code, message) {
  return { ok: false, error: { code, message } }
}
