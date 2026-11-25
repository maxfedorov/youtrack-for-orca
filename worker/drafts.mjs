// The drafts the new-issue form started, one per server and project, kept so a form opened again
// reuses its draft instead of leaving a new one behind each time.
import { createSerial } from './serial.mjs'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const keyOf = (server, project) => `${server}|${project}`
/** Drafts kept at most; the oldest is forgotten (it stays in YouTrack as the user's draft). */
const MAX_DRAFTS = 50

/** @param {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }} storage */
export function createDraftStore(storage) {
  const serial = createSerial()
  async function read() {
    const v = await storage.get('drafts')
    return isRecord(v) ? Object.fromEntries(Object.entries(v).filter(([, id]) => typeof id === 'string' && id)) : {}
  }
  const change = (fn) =>
    serial(async () => {
      const all = await read()
      const next = fn(all)
      const kept = Object.entries(next).slice(-MAX_DRAFTS)
      await storage.set('drafts', Object.fromEntries(kept))
    })
  return {
    get: async (server, project) => (await read())[keyOf(server, project)] ?? null,
    set: (server, project, draftId) => change((all) => ({ ...Object.fromEntries(Object.entries(all).filter(([k]) => k !== keyOf(server, project))), [keyOf(server, project)]: draftId })),
    /** Whether this server has the draft; the plugin only fills, submits and deletes its own drafts. */
    has: async (server, draftId) => Object.entries(await read()).some(([k, id]) => id === draftId && k.startsWith(`${server}|`)),
    forget: (server, draftId) => change((all) => Object.fromEntries(Object.entries(all).filter(([k, id]) => !(id === draftId && k.startsWith(`${server}|`)))))
  }
}
