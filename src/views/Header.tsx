import { Badge, Button, IconButton, Row, Select, Stack, read, set, update } from 'orca'
import { onServerChanged } from '../listState'
import { call, env, panelError, refreshTick, server } from '../state'

export function signIn(url: string): void {
  void call('yt.terminal.run', { command: 'login', url }).then((answer) => {
    if (!answer.ok) set(panelError, answer.message)
  })
}

async function choose(alias: string): Promise<void> {
  const previous = read(server)
  set(server, alias)
  const answer = await call('yt.setServer', { server: alias })
  if (!answer.ok) {
    set(server, previous)
    set(panelError, answer.message)
    return
  }
  await onServerChanged()
}

export function Header() {
  const servers = read(env)?.servers ?? []
  const current = servers.find((item) => item.alias === read(server))
  return (
    <Stack gap="xs">
      <Row gap="xs" justify="between">
        <Select
          label="Server"
          value={read(server) ?? undefined}
          options={servers.map((item) => ({ value: item.alias, label: item.alias }))}
          onChange={(value) => void choose(value)}
        />
        <IconButton icon="refresh" label="Refresh" onPress={() => update(refreshTick, (n) => n + 1)} />
      </Row>
      {current && current.status !== 'authenticated' ? (
        <Row gap="xs">
          <Badge tone="warning">Signed out</Badge>
          <Button variant="ghost" onPress={() => signIn(current.url)}>
            Sign in again
          </Button>
        </Row>
      ) : null}
    </Stack>
  )
}
