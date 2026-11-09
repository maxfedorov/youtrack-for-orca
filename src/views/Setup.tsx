import { atom, Button, Callout, Code, EmptyState, Input, Link, Row, Stack, Text, read, set } from 'orca'
import { call, env, loadEnv, panelError, server, unwrap, view } from '../state'
import { onServerChanged } from '../listState'
import { signIn } from './Header'

const urlDraft = atom('')
const adding = atom(false)
/** Sign-in link of a running 'yt.servers.add'. */
export const authUrl = atom<string | null>(null)
/** Failure of the last add; offers the terminal sign-in. */
export const addError = atom<string | null>(null)

/** Called from the panel's event subscription. */
export function onAdded(payload: unknown): void {
  set(adding, false)
  set(authUrl, null)
  const result = typeof payload === 'object' && payload !== null ? (payload as { ok?: unknown; data?: unknown }) : null
  if (result?.ok === true) {
    set(addError, null)
    set(urlDraft, '')
    const data = result.data as { alias?: unknown } | null | undefined
    const alias = data && typeof data === 'object' && typeof data.alias === 'string' && data.alias ? data.alias : null
    if (read(view).kind === 'add' && alias) void selectAdded(alias)
    else void loadEnv()
  } else {
    set(addError, result?.ok === false ? unwrap(result as never).message : 'Could not add the server')
  }
}

/** After a server was added from the header: select it and load its list. */
async function selectAdded(alias: string): Promise<void> {
  const answer = await call('yt.setServer', { server: alias })
  if (!answer.ok) {
    set(panelError, answer.message)
    set(view, { kind: 'list' })
    return
  }
  set(server, alias)
  await onServerChanged()
}

async function add(): Promise<void> {
  const url = read(urlDraft).trim()
  if (!url) return
  set(addError, null)
  set(authUrl, null)
  set(adding, true)
  const answer = await call('yt.servers.add', { url })
  if (!answer.ok) {
    set(adding, false)
    set(addError, answer.message)
  }
}

function InstallScreen() {
  const command = read(env)?.cli.installCommand
  return (
    <EmptyState title="Install youtrack CLI" icon="terminal" description="The plugin talks to YouTrack through the youtrack command line tool.">
      {command ? <Code block>{command}</Code> : null}
      <Row gap="xs">
        <Button
          onPress={() =>
            void call('yt.terminal.run', { command: 'install' }).then((answer) => {
              if (!answer.ok) set(panelError, answer.message)
            })
          }
        >
          Open terminal with command
        </Button>
        <Button variant="ghost" onPress={() => void loadEnv()}>
          Check again
        </Button>
      </Row>
    </EmptyState>
  )
}

function AddServerScreen() {
  const waiting = read(adding)
  const link = read(authUrl)
  const failure = read(addError)
  const draft = read(urlDraft)
  return (
    <Stack gap="sm">
      <Text weight="semibold">Add a YouTrack server</Text>
      <Input
        label="Server URL"
        placeholder="https://youtrack.example.com"
        value={draft}
        disabled={waiting}
        onChange={(value) => set(urlDraft, value)}
        onSubmit={() => void add()}
      />
      <Button onPress={() => void add()} disabled={waiting || !draft.trim()}>
        Add server
      </Button>
      {waiting ? <Text muted>Waiting for sign-in in the browser…</Text> : null}
      {waiting && link ? (/^https?:\/\//i.test(link) ? <Link href={link}>{link}</Link> : <Text>{link}</Text>) : null}
      {failure ? (
        <Callout tone="danger">
          <Stack gap="xs">
            <Text>{failure}</Text>
            <Button variant="ghost" onPress={() => signIn(draft.trim())}>
              Sign in in terminal
            </Button>
          </Stack>
        </Callout>
      ) : null}
    </Stack>
  )
}

/** The add-server form as a view of its own, opened from the header. */
export function AddServer() {
  return (
    <Stack gap="sm">
      <Button variant="ghost" size="sm" onPress={() => set(view, { kind: 'list' })}>
        ← Back
      </Button>
      <AddServerScreen />
    </Stack>
  )
}

export function Setup() {
  const current = read(env)
  if (!current) return <Text muted>Loading…</Text>
  if (!current.cli.found) return <InstallScreen />
  if (current.error) {
    return (
      <Callout tone="danger">
        <Stack gap="xs">
          <Text>{current.error}</Text>
          <Button variant="ghost" onPress={() => void loadEnv()}>
            Retry
          </Button>
        </Stack>
      </Callout>
    )
  }
  return <AddServerScreen />
}

