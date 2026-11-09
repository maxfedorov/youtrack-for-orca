// Selected server and the last query used on each server.

/**
 * @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }} Storage
 */

/** @param {Storage} storage */
export function createStateStore(storage) {
  async function queries() {
    const v = await storage.get('queries')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  }

  return {
    /** @returns {Promise<string | null>} */
    async getServer() {
      const v = await storage.get('server')
      return typeof v === 'string' ? v : null
    },
    /** @param {string} alias */
    async setServer(alias) {
      await storage.set('server', alias)
    },
    /** @param {string} server @param {string} fallback */
    async getQuery(server, fallback) {
      const v = (await queries())[server]
      return typeof v === 'string' ? v : fallback
    },
    /** @param {string} server @param {string} query */
    async setQuery(server, query) {
      const all = await queries()
      all[server] = query
      await storage.set('queries', all)
    },
  }
}
