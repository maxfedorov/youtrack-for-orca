/** Status bar count, the "agent finished" notification, and the hook that refreshes the count after changes. */
import { CODES } from './result.mjs'
import { toServers } from './mapping.mjs'

const ITEM = 'count'
const DEFAULT_INTERVAL_MS = 300_000
const SIGN_IN_CODES = new Set([CODES.AUTH_FAILED, CODES.NO_SERVERS])

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

  async function compute(youtrack) {
    const inst = await youtrack.instances()
    if (!inst.ok) return inst
    const servers = toServers(inst.data)
    const stored = await state.getServer()
    const chosen = servers.find((s) => s.alias === stored) ?? servers.find((s) => s.active) ?? servers[0]
    if (!chosen) return { ok: false, error: { code: CODES.NO_SERVERS } }
    const raw = await settings.get('defaultQuery')
    const query = typeof raw === 'string' ? raw : ''
    const count = await youtrack.countIssues(chosen.alias, query)
    return count.ok ? { ok: true, data: { count: count.data, tooltip: `${chosen.alias}: ${query}` } } : count
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
      if (SIGN_IN_CODES.has(r.error.code)) {
        lastText = 'YT: !'
        return await update({ text: lastText, tone: 'warning', visible: true })
      }
      // Network trouble or anything else: keep what is shown, only flag it.
      const patch = { tone: 'warning', visible: true }
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

/**
 * @param {{
 *   host: { call(method: string, params?: any): Promise<any> },
 *   launches: ReturnType<typeof import('./links.mjs').createLaunchTracker>,
 *   post?: (name: string, payload: any) => void
 * }} o
 */
export function createFinishNotifier({ host, launches, post }) {
  return {
    /** @param {{ workspaceId: string | null, terminalId?: string, paneKey?: string, state: string, mainAgent?: { state: string } }} event */
    async onAgentStatus(event) {
      try {
        if ((event.mainAgent?.state ?? event.state) !== 'done') return
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
