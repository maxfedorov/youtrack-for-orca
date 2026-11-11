/** Requests of the panel's settings view: prompt templates, the defaults of each server, and resetting the settings. */
import { ok } from '../result.mjs'
import { fallback, invalid, safeHandle, shortMessage, token } from './common.mjs'

const isId = (v) => typeof v === 'string' && v !== ''

/** Every setting the manifest declares, with its default (a test keeps the two the same). */
export const SETTING_DEFAULTS = Object.freeze({
  defaultQuery: 'for: me #Unresolved',
  columns: 'State, Priority, Assignee, Created, Updated',
  branchTemplate: '{{id_lower}}-{{summary_slug}}',
  defaultAgent: 'claude',
  defaultLaunchMode: 'worktree',
  startWithoutPrompt: false,
  includeDescription: false,
  youtrackPath: ''
})

export function registerSettingsHandlers(ctx) {
  const { orca, orcaCli, state, templates, resolveServer } = ctx
  const handle = (name, fn) => safeHandle(orca, name, fn)

  handle('yt.templates', () => templates.list())
  handle('yt.templates.save', ({ id, name, body }) => templates.save({ id: id ?? undefined, name, body }))
  handle('yt.templates.delete', ({ id }) => (isId(id) ? templates.remove(id) : invalid('Invalid template')))
  handle('yt.templates.setDefault', ({ id }) => (isId(id) ? templates.setDefault(id) : invalid('Invalid template')))
  handle('yt.templates.restore', () => templates.restore())

  // Puts every plugin setting back to its default; templates and server choices are kept.
  handle('yt.settings.reset', async () => {
    const failed = []
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      const done = await fallback(async () => (await orca.settings.set(key, value), true), false)
      if (!done) failed.push(key)
    }
    return failed.length ? invalid(`Some settings could not be reset: ${failed.join(', ')}`) : ok({})
  })

  // The projects to choose from and each server's default; the panel lists the servers itself.
  handle('yt.servers.defaults', async () => {
    const r = orcaCli ? await fallback(() => orcaCli.repos(), { ok: false, error: { message: 'Projects could not be listed.' } }) : null
    const defaults = await fallback(() => state.serverRepos(), {})
    if (r?.ok && Array.isArray(r.data)) return ok({ repos: r.data, defaults })
    return ok({ repos: [], reposError: r ? shortMessage(String(r.error?.message ?? 'Projects could not be listed.')) : 'The Orca CLI was not found.', defaults })
  })

  /** `repoId` null or '' clears the default. */
  handle('yt.servers.setDefaultRepo', async ({ server, repoId }) => {
    if (repoId != null && repoId !== '') {
      const bad = token(repoId, 'project')
      if (bad) return invalid(bad)
    }
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setServerRepo(s.data.alias, repoId || null)
    return ok({})
  })
}
