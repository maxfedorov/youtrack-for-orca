// Remembers which workspaces were created for which issue, and which agent
// launches are still waiting for their "finished" notification.
// Storage is read and written on every call; nothing is cached in memory.

const MAX_LINKS_PER_ISSUE = 20
const MAX_LAUNCHES = 50

/**
 * @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }} Storage
 */

const keyOf = (server, issueId) => `${server}|${issueId}`

/** @param {Storage} storage */
export function createLinkStore(storage) {
  async function read() {
    const v = await storage.get('links')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  }

  /** Newest live workspace id in an entry list, or undefined. */
  function newestLive(list, liveIds) {
    let best
    for (const e of Array.isArray(list) ? list : []) {
      if (liveIds.has(e.workspaceId) && (best === undefined || e.createdAt >= best.createdAt)) best = e
    }
    return best?.workspaceId
  }

  return {
    /** @param {string} server @param {string} issueId @param {string} workspaceId @param {number} createdAt */
    async add(server, issueId, workspaceId, createdAt) {
      const all = await read()
      const key = keyOf(server, issueId)
      const list = (Array.isArray(all[key]) ? all[key] : []).filter((e) => e.workspaceId !== workspaceId)
      list.push({ workspaceId, createdAt })
      all[key] = list.slice(-MAX_LINKS_PER_ISSUE)
      await storage.set('links', all)
    },

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

    /** Drops entries whose workspace is not in `liveIds`. */
    async prune(liveIds) {
      const all = await read()
      const next = {}
      for (const [key, list] of Object.entries(all)) {
        const kept = (Array.isArray(list) ? list : []).filter((e) => liveIds.has(e.workspaceId))
        if (kept.length) next[key] = kept
      }
      await storage.set('links', next)
    },
  }
}

/** @param {Storage} storage */
export function createLaunchTracker(storage) {
  async function read() {
    const v = await storage.get('launches')
    return Array.isArray(v) ? v : []
  }

  return {
    /** @param {{ terminalId: string, server: string, issueId: string, workspaceId: string, at: number }} launch */
    async track({ terminalId, server, issueId, workspaceId, at }) {
      const list = (await read()).filter((e) => e.terminalId !== terminalId)
      list.push({ terminalId, server, issueId, workspaceId, at })
      await storage.set('launches', list.slice(-MAX_LAUNCHES))
    },

    /** Returns the launch once and forgets it. @returns {Promise<{ server: string, issueId: string } | null>} */
    async takeFinished(terminalId) {
      const list = await read()
      const found = list.find((e) => e.terminalId === terminalId)
      if (!found) return null
      await storage.set('launches', list.filter((e) => e !== found))
      return { server: found.server, issueId: found.issueId }
    },
  }
}
