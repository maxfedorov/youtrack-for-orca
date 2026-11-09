import { Callout, plugin, read, set, Stack, Text, type PanelContext } from 'orca'
import { loadEnv, panelError, view } from './state'
import { Header } from './views/Header'
import { onAdded, authUrl, Setup } from './views/Setup'

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('yt.servers.authUrl', ({ url }) => set(authUrl, url)),
    plugin.on('yt.servers.added', (result) => onAdded(result))
  )
  void loadEnv()
}

/** The screen for the current view; Tasks for list, detail and start replace the placeholders. */
function Screen() {
  const current = read(view)
  switch (current.kind) {
    case 'setup':
      return <Setup />
    case 'list':
    case 'detail':
    case 'start':
      return <Text muted>Loading…</Text>
  }
}

export default function Panel() {
  const error = read(panelError)
  return (
    <Stack gap="sm">
      {read(view).kind === 'setup' ? null : <Header />}
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Screen />
    </Stack>
  )
}
