// Remembers which workspaces were created for which issue, and which agent
// launches are still waiting for their "finished" notification.
// Storage is read and written on every call; nothing is cached in memory.

import { createSerial } from './serial.mjs'

const MAX_LINKS_PER_ISSUE = 20
const MAX_LAUNCHES = 50

/**
 * @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }} Storage
 */

const keyOf = (server, issueId) => `${server}|${issueId}`
/** Stored lists may hold anything a damaged or older storage left; only objects are entries. */
const entries = (list) => (Array.isArray(list) ? list.filter((e) => e !== null && typeof e === 'object' && !Array.isArray(e)) : [])

/** @param {Storage} storage */
export function createLinkStore(storage) {
  const serial = createSerial()
  async function read() {
    const v = await storage.get('links')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  }

  /** Newest live workspace id in an entry list, or undefined. */
  function newestLive(list, liveIds) {
    let best
    for (const e of entries(list)) {
      if (liveIds.has(e.workspaceId) && (best === undefined || e.createdAt >= best.createdAt)) best = e
    }
    return best?.workspaceId
  }

  return {
    /** @param {string} server @param {string} issueId @param {string} workspaceId @param {number} createdAt */
    add: (server, issueId, workspaceId, createdAt) =>
      serial(async () => {
        const all = await read()
        const key = keyOf(server, issueId)
        const list = entries(all[key]).filter((e) => e.workspaceId !== workspaceId)
        list.push({ workspaceId, createdAt })
        all[key] = list.slice(-MAX_LINKS_PER_ISSUE)
        await storage.set('links', all)
      }),

    /** @returns {Promise<string | null>} */
    async latest(server, issueId, liveIds) {
      const all = await read()
      return newestLive(all[keyOf(server, issueId)], liveIds) ?? null
    },

    /** @returns {Promise<Record<string, string>>} issueId -> newest live workspaceId */
    async forServer(server, liveIds) {
      const all = await read()
      const prefix = `${server}|`
      const out = {}
      for (const [key, list] of Object.entries(all)) {
        if (!key.startsWith(prefix)) continue
        const id = newestLive(list, liveIds)
        if (id !== undefined) out[key.slice(prefix.length)] = id
      }
      return out
    },

    /**
     * Drops entries whose workspace is not in `liveIds`. With `before`, entries created at or after that
     * time stay: `liveIds` was read then, so a newer workspace may be missing from it.
     */
    prune: (liveIds, before = Infinity) =>
      serial(async () => {
        const all = await read()
        const next = {}
        for (const [key, list] of Object.entries(all)) {
          const kept = entries(list).filter((e) => liveIds.has(e.workspaceId) || !(e.createdAt < before))
          if (kept.length) next[key] = kept
        }
        await storage.set('links', next)
      }),

    /** Drops every entry of one workspace, on every server and issue. */
    drop: (workspaceId) =>
      serial(async () => {
        const all = await read()
        const next = {}
        for (const [key, list] of Object.entries(all)) {
          const kept = entries(list).filter((e) => e.workspaceId !== workspaceId)
          if (kept.length) next[key] = kept
        }
        await storage.set('links', next)
      }),
  }
}

/**
 * The `workspace.removed` listener: drops the links of the removed workspace, prunes the rest against
 * the workspace list, then tells the panels to load their links again. The event may name the workspace
 * by another id than the list does, so a listed workspace at the removed path counts as gone too.
 * @param {{ host: (method: string, params: object) => Promise<any>, links: ReturnType<typeof createLinkStore>, now: () => number, post: (name: string, payload: object) => void }} deps
 */
export function createRemovedListener({ host, links, now, post }) {
  return async (event) => {
    const id = typeof event?.workspaceId === 'string' ? event.workspaceId : ''
    const path = typeof event?.path === 'string' ? event.path : ''
    try {
      if (id) await links.drop(id)
      const snapshotAt = now()
      const r = await host('workspace.list', {})
      const list = Array.isArray(r?.workspaces) ? r.workspaces : []
      const live = new Set(
        list
          .filter((w) => w && typeof w.id === 'string' && w.id !== id && !(path && w.path === path))
          .map((w) => w.id)
      )
      if (r?.truncated !== true) await links.prune(live, snapshotAt)
    } catch {
      // the panels load the links again and prune what is gone
    }
    post('yt.linksChanged', {})
  }
}

/** @param {Storage} storage */
export function createLaunchTracker(storage) {
  const serial = createSerial()
  async function read() {
    return entries(await storage.get('launches'))
  }

  return {
    /** @param {{ terminalId: string, server: string, issueId: string, workspaceId: string, at: number }} launch */
    track: ({ terminalId, paneKey, server, issueId, workspaceId, at }) =>
      serial(async () => {
        const list = (await read()).filter((e) => e.terminalId !== terminalId)
        const entry = { terminalId, server, issueId, workspaceId, at }
        if (paneKey) entry.paneKey = paneKey
        list.push(entry)
        await storage.set('launches', list.slice(-MAX_LAUNCHES))
      }),

    /**
     * Returns the launch once and forgets it. `ids` is a terminal id or `{ terminalId, paneKey, workspaceId }`;
     * a terminal match wins over a pane match, which wins over a workspace match.
     * @returns {Promise<{ server: string, issueId: string } | null>} */
    takeFinished: (ids) =>
      serial(async () => {
        const list = await read()
        const { terminalId, paneKey, workspaceId } = typeof ids === 'string' ? { terminalId: ids } : (ids ?? {})
        const by = (key, value) => (value ? list.find((e) => e[key] === value) : undefined)
        const found = by('terminalId', terminalId) ?? by('paneKey', paneKey) ?? by('workspaceId', workspaceId)
        if (!found) return null
        await storage.set('launches', list.filter((e) => e !== found))
        return { server: found.server, issueId: found.issueId }
      }),
  }
}
