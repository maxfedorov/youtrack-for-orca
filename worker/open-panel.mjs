/** The `youtrack.openPanel` command: open our panel through the Orca CLI, else toggle the right sidebar. */
export function createOpenPanelCommand({ orcaCli, host }) {
  return async function openPanel() {
    let r = null
    try {
      r = orcaCli ? await orcaCli.openPanel('youtrack-for-orca', 'issues') : null
    } catch {
      r = null
    }
    if (!r?.ok) await host.call('commands.run', { action: 'sidebar.right.toggle' })
  }
}
