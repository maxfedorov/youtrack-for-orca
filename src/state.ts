import { atom, plugin, set } from 'orca'
import type { ErrorCode, Result, Server } from './protocol'
import { fitAnswer } from './shapes'

export type Env = {
  cli: { found: boolean; version?: string; installCommand?: string }
  orcaCli: { found: boolean }
  servers: Server[]
  server: string | null
  query: string
  defaultQuery: string
  /** The instance list failed; shown with Retry. */
  error?: string
}
export type View = { kind: 'setup' | 'list' | 'detail' | 'start' | 'add'; issueId?: string }
export type Unwrapped<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string }

export const env = atom<Env | null>(null)
/** Alias of the selected server. */
export const server = atom<string | null>(null)
export const query = atom('')
export const view = atom<View>({ kind: 'setup' })
/** Bumped by the header's refresh button; list and detail views reload when it changes. */
export const refreshTick = atom(0)
/** Message of the last failed request, shown by the panel; null when none. */
export const panelError = atom<string | null>(null)
/** Something worked only in part (a warning); stays until dismissed. */
export const notice = atom<string | null>(null)

/** Error texts are drawn in `Text`, which refuses more than 16 KiB; keep them short. */
export const MAX_MESSAGE = 2000
const short = (text: string) => (text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE - 1).replace(/[\ud800-\udbff]$/, '')}…`)
const UNEXPECTED = 'The plugin got an unexpected answer. Try again.'
/** Messages for the ways `plugin.request` rejects, by host error code. */
const REJECTED: Record<string, string> = {
  timeout: 'The plugin did not answer in time. Try again.',
  unavailable: 'The plugin is not available right now. Try again.',
  unknown_method: 'This action is not available in this version of the plugin.'
}

/** Turns a Result into data or an error state; never throws, whatever the answer is. */
export function unwrap<T>(result: Result<T> | null | undefined): Unwrapped<T> {
  const r = result as unknown
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return { ok: false, code: 'UNKNOWN', message: 'No answer from the worker' }
  const answer = r as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } | null }
  if (answer.ok === true && 'data' in answer) return { ok: true, data: answer.data as T }
  if (answer.ok === false) {
    const error = typeof answer.error === 'object' && answer.error !== null ? answer.error : {}
    const code = typeof error.code === 'string' && error.code ? (error.code as ErrorCode) : 'UNKNOWN'
    const message = typeof error.message === 'string' && error.message ? error.message : 'The request failed. Try again.'
    return { ok: false, code, message: short(message) }
  }
  return { ok: false, code: 'UNKNOWN', message: UNEXPECTED }
}

const rejectionCode = (error: unknown) => (typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined)

/** Why a `plugin.request` rejected, in words for the error callout. */
function rejected(error: unknown): string {
  const code = rejectionCode(error)
  if (typeof code === 'string' && REJECTED[code]) return REJECTED[code]
  return error instanceof Error && error.message ? short(error.message) : 'The request failed. Try again.'
}

/**
 * Requests that change something get the longest wait the platform allows, longer than the worker's own
 * time limits, so a slow start is not reported as failed while it goes on.
 */
const TIMEOUTS: Partial<Record<string, number>> = {
  'yt.start.run': 120_000,
  'yt.runInExisting': 120_000,
  'yt.savedQueries.create': 120_000
}

/**
 * `plugin.request` that always resolves: a rejection, a malformed Result or data of a shape the
 * screens cannot read all become a failed result.
 */
export async function call<N extends keyof import('orca').PluginRequests>(
  name: N,
  input: import('orca').PluginRequests[N]['input']
): Promise<Unwrapped<Extract<import('orca').PluginRequests[N]['output'], { ok: true }>['data']>> {
  try {
    const timeoutMs = TIMEOUTS[name]
    let answer = unwrap((await (timeoutMs ? plugin.request(name, input, { timeoutMs }) : plugin.request(name, input))) as never)
    if (answer.ok) {
      const fitted = fitAnswer(name, answer.data)
      answer = fitted ? { ok: true, data: fitted.data as never } : { ok: false, code: 'UNKNOWN', message: UNEXPECTED }
    }
    if (answer.ok) set(panelError, null)
    else if (answer.code === 'CLI_NOT_FOUND' && name !== 'yt.env') void loadEnv()
    return answer as never
  } catch (error) {
    return { ok: false, code: rejectionCode(error) === 'timeout' ? 'TIMEOUT' : 'UNKNOWN', message: rejected(error) }
  }
}

/** Reads `yt.env` into the atoms; picks the first screen. */
export async function loadEnv(): Promise<void> {
  const answer = await call('yt.env', {})
  if (!answer.ok) {
    set(panelError, answer.message)
    return
  }
  const data = answer.data as Env
  set(panelError, null)
  set(env, data)
  set(server, data.server)
  set(query, data.query)
  set(view, data.cli.found && data.servers.length > 0 ? { kind: 'list' } : { kind: 'setup' })
}
