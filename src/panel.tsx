import { Button, Callout, plugin, read, set, Stack, Text, type PanelContext } from 'orca'
import { env, loadEnv, notice, panelError, view } from './state'
import { loadLinks } from './listState'
import { postedUrl } from './shapes'
import { Header } from './views/Header'
import { IssueDetail } from './views/IssueDetail'
import { IssueList } from './views/IssueList'
import { StartView } from './views/StartView'
import { onAdded, authUrl, AddServer, Setup } from './views/Setup'

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('yt.servers.authUrl', (payload) => {
      const url = postedUrl(payload)
      if (url) set(authUrl, url)
    }),
    plugin.on('yt.servers.added', (result) => onAdded(result)),
    plugin.on('yt.agentFinished', () => void loadLinks()),
    plugin.on('yt.linksChanged', () => void loadLinks())
  )
  visible = ctx.visible
  void loadEnv()
}

/** Whether the person can see the panel; a workspace may have been removed while it was hidden. */
let visible: PanelContext['visible'] | null = null
let wasVisible = true

/** Called while rendering: loads the links again when the panel is shown again. */
function syncVisible(): void {
  const now = visible ? read(visible) : true
  if (now && !wasVisible && read(view).kind !== 'setup') queueMicrotask(() => void loadLinks())
  wasVisible = now
}

/** The screen for the current view. */
function Screen() {
  const current = read(view)
  switch (current.kind) {
    case 'setup':
      return <Setup />
    case 'add':
      return <AddServer />
    case 'list':
      return <IssueList />
    case 'detail':
      return <IssueDetail id={current.issueId ?? ''} />
    case 'start':
      return <StartView id={current.issueId ?? ''} />
  }
}

export default function Panel() {
  syncVisible()
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
      {read(notice) ? (
        <Callout tone="warning">
          <Stack gap="xs">
            <Text>{read(notice) ?? ''}</Text>
            <Button variant="ghost" onPress={() => set(notice, null)}>
              Dismiss
            </Button>
          </Stack>
        </Callout>
      ) : null}
      <Screen />
    </Stack>
  )
}
