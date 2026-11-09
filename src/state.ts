import { atom, plugin, set } from 'orca'
import type { ErrorCode, Result, Server } from './protocol'

export type Env = {
  cli: { found: boolean; version?: string }
  orcaCli: { found: boolean }
  servers: Server[]
  server: string | null
  query: string
}
export type View = { kind: 'setup' | 'list' | 'detail' | 'start'; issueId?: string }
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

/** Turns a Result into data or an error state; never throws. */
export function unwrap<T>(result: Result<T> | null | undefined): Unwrapped<T> {
  if (result && result.ok) return { ok: true, data: result.data }
  if (result && !result.ok) return { ok: false, code: result.error.code, message: result.error.message }
  return { ok: false, code: 'UNKNOWN', message: 'No answer from the worker' }
}

/** `plugin.request` that turns a rejection into a failed result. */
export async function call<N extends keyof import('orca').PluginRequests>(
  name: N,
  input: import('orca').PluginRequests[N]['input']
): Promise<Unwrapped<Extract<import('orca').PluginRequests[N]['output'], { ok: true }>['data']>> {
  try {
    return unwrap(await plugin.request(name, input) as never) as never
  } catch (error) {
    return { ok: false, code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }
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
