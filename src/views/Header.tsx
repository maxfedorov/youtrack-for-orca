import { Badge, Button, IconButton, Row, Select, Stack, read, set } from 'orca'
import { onServerChanged, refreshAll } from '../listState'
import { openAddServer } from './Setup'
import { call, env, panelError, server } from '../state'
import { askRemove } from '../removeServer'
import { RemoveServerQuestion } from './RemoveServer'

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
        <Row gap="xs">
          <Select
            label="Server"
            value={read(server) ?? undefined}
            options={servers.map((item) => ({ value: item.alias, label: item.alias }))}
            onChange={(value) => void choose(value)}
          />
          <IconButton
            icon="delete"
            tone="danger"
            label="Remove server"
            disabled={!current}
            onPress={() => (current ? askRemove(current.alias, 'header') : undefined)}
          />
        </Row>
        <Row gap="xs">
          <IconButton icon="refresh" label="Refresh" onPress={() => void refreshAll()} />
          <IconButton icon="add" label="Add server" onPress={openAddServer} />
        </Row>
      </Row>
      <RemoveServerQuestion from="header" />
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
