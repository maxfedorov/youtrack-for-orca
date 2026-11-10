/**
 * The panel <-> worker contract: every request is answered with a `Result`, never a thrown error.
 * Requests are grouped in handlers/youtrack.mjs (servers, issues, saved queries) and
 * handlers/start.mjs (repos, workspaces, agent launches, terminals).
 */
import os from 'node:os'
import { fail, ok, CODES } from './result.mjs'
import { toServers } from './mapping.mjs'
import { registerYoutrackHandlers } from './handlers/youtrack.mjs'
import { registerStartHandlers } from './handlers/start.mjs'
import { registerSettingsHandlers } from './handlers/settings.mjs'
import { createTemplateStore } from './templates.mjs'

/**
 * @param {any} orca the worker's `orca` object
 * @param {{
 *   youtrack: ReturnType<typeof import('./youtrack-cli.mjs').createYoutrack> | null,
 *   orcaCli: ReturnType<typeof import('./orca-cli.mjs').createOrcaCli> | null,
 *   links: ReturnType<typeof import('./links.mjs').createLinkStore>,
 *   launches: ReturnType<typeof import('./links.mjs').createLaunchTracker>,
 *   state: ReturnType<typeof import('./state.mjs').createStateStore>,
 *   templates?: ReturnType<typeof import('./templates.mjs').createTemplateStore>,
 *   detectAgents: () => { installed: string[], other: string[] },
 *   now: () => number,
 *   platform?: string,
 *   homedir?: string
 * }} deps `platform` defaults to `process.platform`, `homedir` to the user's home folder; `templates`
 *   to a store in the plugin's storage that imports the old `promptTemplate` setting
 */
export function registerHandlers(orca, deps) {
  /** The youtrack CLI as last resolved; null when it is not installed. */
  const current = () => (deps.getYoutrack ? deps.getYoutrack() : (deps.youtrack ?? null))
  const refreshYoutrack = async () => {
    await deps.refreshYoutrack?.()
  }
  /** The configured server with this alias: `ok(Server)`, or why there is none. */
  async function resolveServer(alias) {
    const youtrack = current()
    if (!youtrack) return fail(CODES.CLI_NOT_FOUND, 'The youtrack CLI was not found.')
    if (typeof alias !== 'string' || !alias) return fail(CODES.UNKNOWN, 'Unknown server')
    const r = await youtrack.instances()
    if (!r.ok) {
      if (r.error.code === CODES.CLI_NOT_FOUND) await refreshYoutrack()
      return r
    }
    const found = toServers(r.data).find((s) => s.alias === alias)
    return found ? ok(found) : fail(CODES.UNKNOWN, 'Unknown server')
  }
  const templates = deps.templates ?? createTemplateStore(orca.storage, { legacy: () => orca.settings.get('promptTemplate') })
  const ctx = { ...deps, templates, platform: deps.platform ?? process.platform, homedir: deps.homedir ?? os.homedir(), orca, resolveServer, refreshYoutrack }
  Object.defineProperty(ctx, 'youtrack', { get: current, enumerable: true })
  registerYoutrackHandlers(ctx)
  registerStartHandlers(ctx)
  registerSettingsHandlers(ctx)
}
