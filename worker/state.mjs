// Selected server, the last query used on each server, the saved searches shown there as quick views,
// and what to offer when starting work: the Orca project last chosen for each YouTrack project (and an
// optional default for each server), and the field and value last chosen for the agent to set when done.

import { createSerial } from './serial.mjs'

/** Projects remembered per server; the oldest is forgotten first. */
const MAX_PROJECTS = 200

/**
 * @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }} Storage
 */

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const record = (v) => (isRecord(v) ? v : {})
/** Only the string values; damaged entries are left out. */
const strings = (v) => Object.fromEntries(Object.entries(record(v)).filter(([, x]) => typeof x === 'string'))

/** @param {Storage} storage */
export function createStateStore(storage) {
  const serial = createSerial()
  const queries = async () => record(await storage.get('queries'))
  /** `{ server: { shortName: repoId } }` */
  const projectRepos = async () => record(await storage.get('projectRepos'))
  /** `{ server: repoId }` */
  const serverRepos = async () => strings(await storage.get('serverRepos'))
  /** `{ server: { shortName: { field, state } } }` */
  const finishChoices = async () => record(await storage.get('finishChoices'))
  /** `{ server: [savedSearchId] }` */
  const quickViews = async () => record(await storage.get('quickViews'))

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
    setQuery: (server, query) =>
      serial(async () => {
        const all = await queries()
        all[server] = query
        await storage.set('queries', all)
      }),

    /** The ids of the saved searches shown as quick views on a server, in order. */
    async quickViews(server) {
      const v = (await quickViews())[server]
      return Array.isArray(v) ? v.filter((id) => typeof id === 'string') : []
    },
    /** Replaces the quick views of a server; repeated ids count once. */
    setQuickViews: (server, ids) =>
      serial(async () => {
        const all = await quickViews()
        all[server] = [...new Set(ids)]
        await storage.set('quickViews', all)
      }),

    /** The Orca project last chosen for this YouTrack project on this server, or null. */
    async projectRepo(server, project) {
      const v = strings((await projectRepos())[server])[project]
      return typeof v === 'string' ? v : null
    },
    /** Remembers the Orca project chosen for a YouTrack project; the newest choice goes last. */
    rememberProjectRepo: (server, project, repoId) =>
      serial(async () => {
        const all = await projectRepos()
        const mine = strings(all[server])
        delete mine[project]
        mine[project] = repoId
        all[server] = Object.fromEntries(Object.entries(mine).slice(-MAX_PROJECTS))
        await storage.set('projectRepos', all)
      }),

    /** What the agent was last asked to set when done in a YouTrack project (`state` '' for no change), or null. */
    async finishChoice(server, project) {
      const v = record((await finishChoices())[server])[project]
      return isRecord(v) && typeof v.field === 'string' && typeof v.state === 'string' ? { field: v.field, state: v.state } : null
    },
    /** Remembers the finish choice of a YouTrack project; the newest choice goes last. */
    rememberFinishChoice: (server, project, { field, state }) =>
      serial(async () => {
        const all = await finishChoices()
        const mine = record(all[server])
        delete mine[project]
        mine[project] = { field, state }
        all[server] = Object.fromEntries(Object.entries(mine).slice(-MAX_PROJECTS))
        await storage.set('finishChoices', all)
      }),

    /** The default Orca project of a server, or null. */
    async serverRepo(server) {
      return (await serverRepos())[server] ?? null
    },
    /** Every server's default Orca project. */
    serverRepos,
    /** Sets or, with null, clears the default Orca project of a server. */
    setServerRepo: (server, repoId) =>
      serial(async () => {
        const all = await serverRepos()
        if (repoId) all[server] = repoId
        else delete all[server]
        await storage.set('serverRepos', all)
      }),

    /** Forgets everything stored for a server that was removed. */
    forgetServer: (server) =>
      serial(async () => {
        if ((await storage.get('server')) === server) await storage.set('server', null)
        for (const key of ['queries', 'quickViews', 'projectRepos', 'serverRepos', 'finishChoices']) {
          const all = record(await storage.get(key))
          if (!(server in all)) continue
          delete all[server]
          await storage.set(key, all)
        }
      }),
  }
}
