/** Status bar count, the "agent finished" notification, and the hook that refreshes the count after changes. */
import { CODES } from './result.mjs'
import { toServers } from './mapping.mjs'

const ITEM = 'count'
const DEFAULT_INTERVAL_MS = 300_000
const SIGN_IN_CODES = new Set([CODES.AUTH_FAILED, CODES.NO_SERVERS])
/** Tooltips stay one short line. */
const short = (text) => {
  const line = String(text ?? '').split(/\r?\n/)[0].trim()
  return line.length > 160 ? `${line.slice(0, 159)}…` : line
}

/**
 * @param {{
 *   host: { call(method: string, params?: any): Promise<any> },
 *   youtrack?: ReturnType<typeof import('./youtrack-cli.mjs').createYoutrack> | null,
 *   getYoutrack?: () => Promise<ReturnType<typeof import('./youtrack-cli.mjs').createYoutrack> | null>,
 *   state: ReturnType<typeof import('./state.mjs').createStateStore>,
 *   settings: { get(key: string): Promise<any> },
 *   intervalMs?: number,
 *   setInterval?: typeof globalThis.setInterval,
 *   clearInterval?: typeof globalThis.clearInterval
 * }} o
 */
export function createStatusBar({
  host, youtrack: youtrack0, getYoutrack, state, settings,
  intervalMs = DEFAULT_INTERVAL_MS,
  setInterval: setTimer = globalThis.setInterval,
  clearInterval: clearTimer = globalThis.clearInterval
}) {
  let lastText = null
  let timer = null
  const update = (patch) => host.call('statusBar.update', { id: ITEM, ...patch })

  /** `where` names the server and query of a failed count, when it got that far. */
  async function compute(youtrack) {
    const inst = await youtrack.instances()
    if (!inst.ok) return inst
    const servers = toServers(inst.data)
    const stored = await state.getServer()
    const chosen = servers.find((s) => s.alias === stored) ?? servers.find((s) => s.active) ?? servers[0]
    if (!chosen) return { ok: false, error: { code: CODES.NO_SERVERS, message: '' } }
    const raw = await settings.get('defaultQuery')
    const query = typeof raw === 'string' ? raw : ''
    const where = `${chosen.alias}: ${query}`
    const count = await youtrack.countIssues(chosen.alias, query)
    return count.ok ? { ok: true, data: { count: count.data, tooltip: where } } : { ...count, where, alias: chosen.alias }
  }

  /** The tooltip of a failed count: what went wrong, in a line. */
  function failureTooltip(r) {
    const message = short(r.error?.message)
    if (r.error?.code === CODES.NO_SERVERS) return 'No YouTrack server. Open the panel to add one.'
    if (r.error?.code === CODES.AUTH_FAILED) return `Signed out of ${r.alias ?? 'the server'}. Open the panel to sign in again.`
    if (r.error?.code === CODES.QUERY_INVALID) {
      return `The Default query in the plugin settings is not valid${message ? `: ${message}` : ''}`
    }
    return `The count could not be updated${r.where ? ` (${r.where})` : ''}${message ? `: ${message}` : ''}`
  }

  async function refresh() {
    try {
      const youtrack = getYoutrack ? await getYoutrack() : youtrack0
      if (!youtrack) return await update({ visible: false })
      const r = await compute(youtrack)
      if (r.ok) {
        lastText = `YT: ${r.data.count}`
        return await update({ text: lastText, tooltip: r.data.tooltip, tone: 'neutral', visible: true })
      }
      const tooltip = failureTooltip(r)
      if (SIGN_IN_CODES.has(r.error.code)) {
        lastText = 'YT: !'
        return await update({ text: lastText, tooltip, tone: 'warning', visible: true })
      }
      if (r.error.code === CODES.QUERY_INVALID) {
        // No count can be shown for a query that never works, so none is kept either.
        lastText = 'YT: ?'
        return await update({ text: lastText, tooltip, tone: 'warning', visible: true })
      }
      // Network trouble or anything else: keep what is shown, only flag it.
      const patch = { tooltip, tone: 'warning', visible: true }
      if (lastText) patch.text = lastText
      await update(patch)
    } catch {
      // the status bar is best effort
    }
  }

  return {
    refresh,
    async start() {
      await refresh()
      try {
        if (!timer) timer = setTimer(refresh, intervalMs)
        timer?.unref?.()
      } catch {
        // without a timer the count is still refreshed after changes
      }
    },
    stop() {
      if (timer) clearTimer(timer)
      timer = null
    }
  }
}

/** How long an agent must stay done after working before it counts as finished. */
const SETTLE_MS = 3_000

/**
 * Notifies when an agent the plugin launched has finished its work. An agent reports `done` while it
 * starts (also between brief `working` reports) and before its prompt runs, so a pane counts as
 * finished only once it has worked and then stayed done for `settleMs`.
 * @param {{
 *   host: { call(method: string, params?: any): Promise<any> },
 *   launches: ReturnType<typeof import('./links.mjs').createLaunchTracker>,
 *   post?: (name: string, payload: any) => void,
 *   settleMs?: number,
 *   setTimeout?: typeof globalThis.setTimeout,
 *   clearTimeout?: typeof globalThis.clearTimeout
 * }} o
 */
export function createFinishNotifier({
  host, launches, post,
  settleMs = SETTLE_MS,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout
}) {
  /** Panes that worked since their last finish, each with the finish waiting to settle, if any. */
  const panes = new Map()

  async function finish(event) {
    try {
      const found = await launches.takeFinished({
        terminalId: event.terminalId,
        paneKey: event.paneKey,
        workspaceId: event.workspaceId ?? undefined
      })
      if (!found) return
      await host.call('notifications.show', { title: `Agent finished ${found.issueId}`, body: found.server })
      await post?.('yt.agentFinished', { server: found.server, issueId: found.issueId, workspaceId: event.workspaceId ?? null })
    } catch {
      // a failed notification must not break the event stream
    }
  }

  function cancel(pane) {
    if (pane?.timer) clearTimer(pane.timer)
    if (pane) pane.timer = null
  }

  return {
    /** @param {{ workspaceId: string | null, terminalId?: string, paneKey?: string, state: string, mainAgent?: { state: string } }} event */
    async onAgentStatus(event) {
      try {
        const key = event?.paneKey || event?.terminalId || event?.workspaceId
        if (!key) return
        const state = event.mainAgent?.state ?? event.state
        const pane = panes.get(key)
        if (state !== 'done') {
          cancel(pane)
          if (state === 'working') panes.set(key, { timer: null })
          return
        }
        // Done without work since the last finish (starting up, or repeated): nothing finished.
        if (!pane || pane.timer) return
        pane.timer = setTimer(() => {
          panes.delete(key)
          return finish(event)
        }, settleMs)
        pane.timer?.unref?.()
      } catch {
        // a failed notification must not break the event stream
      }
    },
    stop() {
      for (const pane of panes.values()) cancel(pane)
      panes.clear()
    }
  }
}

/**
 * A view of `orca` whose panel handlers named in `names` call `refresh()` after they answer with `ok: true`.
 * @param {any} orca
 * @param {string[]} names
 * @param {() => Promise<void>} refresh
 */
export function refreshAfter(orca, names, refresh) {
  const watched = new Set(names)
  const panels = {
    ...orca.panels,
    handle: (name, fn) =>
      orca.panels.handle(
        name,
        watched.has(name)
          ? async (...args) => {
              const r = await fn(...args)
              if (r && r.ok === true) void refresh().catch(() => {})
              return r
            }
          : fn
      )
  }
  return Object.create(orca, { panels: { value: panels } })
}
