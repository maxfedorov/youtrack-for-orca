// Wiring only: resolve the CLIs, build the stores, register handlers, status bar and notifications.
import os from 'node:os'
import { existsSync } from 'node:fs'
import { createYoutrackHolder } from './cli-holder.mjs'
import { createOrcaCli, resolveOrcaCli } from './orca-cli.mjs'
import { createLinkStore, createLaunchTracker } from './links.mjs'
import { createStateStore } from './state.mjs'
import { detectAgents } from './agents.mjs'
import { registerHandlers } from './handlers.mjs'
import { createOpenPanelCommand } from './open-panel.mjs'
import { createStatusBar, createFinishNotifier, refreshAfter } from './status.mjs'

const REFRESHING = ['yt.setServer', 'yt.start.run', 'yt.runInExisting', 'yt.savedQueries.create']
let statusBar = null

/** @param {import('orca/worker').OrcaWorkerApi} orca */
export default async function activate(orca) {
  const env = process.env
  const platform = process.platform
  const holder = createYoutrackHolder({
    getSetting: () => orca.settings.get('youtrackPath'),
    env, platform, homedir: os.homedir(), exists: existsSync
  })
  await holder.refresh()
  const orcaBin = resolveOrcaCli({ resourcesPath: process.resourcesPath, platform, env, exists: existsSync })
  const orcaCli = orcaBin ? createOrcaCli({ bin: orcaBin }) : null

  const links = createLinkStore(orca.storage)
  const launches = createLaunchTracker(orca.storage)
  const state = createStateStore(orca.storage)
  let agents = null

  statusBar = createStatusBar({ host: orca.host, getYoutrack: () => holder.refresh(), state, settings: orca.settings })
  registerHandlers(refreshAfter(orca, REFRESHING, statusBar.refresh), {
    getYoutrack: holder.get, refreshYoutrack: holder.refresh, orcaCli, links, launches, state,
    detectAgents: () => (agents ??= detectAgents({ env, platform })),
    now: () => Date.now()
  })

  const notifier = createFinishNotifier({ host: orca.host, launches, post: (name, payload) => orca.panels.post(name, payload) })
  orca.events.on('agent.status.changed', notifier.onAgentStatus)

  orca.commands.register('youtrack.openPanel', createOpenPanelCommand({ orcaCli, host: orca.host }))

  await statusBar.start()
}

export async function deactivate() {
  statusBar?.stop()
  statusBar = null
}
