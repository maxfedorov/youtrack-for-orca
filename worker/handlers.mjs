/**
 * The panel <-> worker contract: every request is answered with a `Result`, never a thrown error.
 * Requests are grouped in handlers/youtrack.mjs (servers, issues, saved queries) and
 * handlers/start.mjs (repos, workspaces, agent launches, terminals).
 */
import { fail, ok, CODES } from './result.mjs'
import { toServer } from './mapping.mjs'
import { registerYoutrackHandlers } from './handlers/youtrack.mjs'
import { registerStartHandlers } from './handlers/start.mjs'

/**
 * @param {any} orca the worker's `orca` object
 * @param {{
 *   youtrack: ReturnType<typeof import('./youtrack-cli.mjs').createYoutrack> | null,
 *   orcaCli: ReturnType<typeof import('./orca-cli.mjs').createOrcaCli> | null,
 *   links: ReturnType<typeof import('./links.mjs').createLinkStore>,
 *   launches: ReturnType<typeof import('./links.mjs').createLaunchTracker>,
 *   state: ReturnType<typeof import('./state.mjs').createStateStore>,
 *   detectAgents: () => { installed: string[], other: string[] },
 *   now: () => number,
 *   platform?: string
 * }} deps `platform` defaults to `process.platform`
 */
export function registerHandlers(orca, deps) {
  const { youtrack } = deps
  /** The configured server with this alias: `ok(Server)`, or why there is none. */
  async function resolveServer(alias) {
    if (!youtrack) return fail(CODES.CLI_NOT_FOUND, 'The youtrack CLI was not found.')
    if (typeof alias !== 'string' || !alias) return fail(CODES.UNKNOWN, 'Unknown server')
    const r = await youtrack.instances()
    if (!r.ok) return r
    const found = r.data.map(toServer).find((s) => s.alias === alias)
    return found ? ok(found) : fail(CODES.UNKNOWN, 'Unknown server')
  }
  const ctx = { ...deps, platform: deps.platform ?? process.platform, orca, resolveServer }
  registerYoutrackHandlers(ctx)
  registerStartHandlers(ctx)
}
