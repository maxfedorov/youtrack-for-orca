import { Button, Callout, plugin, read, set, Stack, Text, type PanelContext } from 'orca'
import { env, loadEnv, panelError, view } from './state'
import { loadLinks } from './listState'
import { Header } from './views/Header'
import { IssueDetail } from './views/IssueDetail'
import { IssueList } from './views/IssueList'
import { onAdded, authUrl, Setup } from './views/Setup'

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('yt.servers.authUrl', ({ url }) => set(authUrl, url)),
    plugin.on('yt.servers.added', (result) => onAdded(result)),
    plugin.on('yt.agentFinished', () => void loadLinks())
  )
  void loadEnv()
}

/** The screen for the current view; Task for start replaces the placeholder. */
function Screen() {
  const current = read(view)
  switch (current.kind) {
    case 'setup':
      return <Setup />
    case 'list':
      return <IssueList />
    case 'detail':
      return <IssueDetail id={current.issueId ?? ''} />
    case 'start':
      return <Text muted>Loading…</Text>
  }
}

export default function Panel() {
  const error = read(panelError)
  return (
    <Stack gap="sm">
      {read(view).kind === 'setup' ? null : <Header />}
      {error ? (
        <Callout tone="danger">
          <Stack gap="xs">
            <Text>{error}</Text>
            {read(env) ? null : (
              <Button variant="ghost" onPress={() => void loadEnv()}>
                Retry
              </Button>
            )}
          </Stack>
        </Callout>
      ) : null}
      <Screen />
    </Stack>
  )
}
