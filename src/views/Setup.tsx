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
/** Shown under the waiting text when "Check again" found no new server yet. */
const notYet = atom(false)

/** The worker gives the browser sign-in 10 minutes; past this the post is not coming. */
export const SIGN_IN_DEADLINE_MS = 11 * 60_000
const DID_NOT_FINISH = 'Sign-in did not finish. Try again, or sign in in the terminal.'
let deadline: ReturnType<typeof setTimeout> | null = null
/** False after Cancel or leaving the form: a late failure of that sign-in is not shown. */
let pending = false

function stopWaiting(): void {
  pending = false
  if (deadline) clearTimeout(deadline)
  deadline = null
  set(adding, false)
  set(authUrl, null)
  set(notYet, false)
}

/** Cancel: the form is usable again; the browser sign-in may still finish and add the server. */
export function cancelAdd(): void {
  stopWaiting()
}

/** Opens the add-server form from scratch. */
export function openAddServer(): void {
  stopWaiting()
  set(urlDraft, '')
  set(addError, null)
  set(view, { kind: 'add' })
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

/** "Check again" while waiting: the sign-in may have finished without its post reaching the panel. */
async function checkAdded(): Promise<void> {
  const url = read(urlDraft).trim()
  const answer = await call('yt.env', {})
  if (!read(adding)) return
  const found = answer.ok ? answer.data.servers.find((item) => sameUrl(item.url, url)) : undefined
  if (!found) {
    set(notYet, true)
    return
  }
  stopWaiting()
  set(urlDraft, '')
  if (read(view).kind === 'add') await selectAdded(found.alias)
  else await loadEnv()
}

/** Called from the panel's event subscription. */
export function onAdded(payload: unknown): void {
  const wasPending = pending
  stopWaiting()
  const result = typeof payload === 'object' && payload !== null ? (payload as { ok?: unknown; data?: unknown }) : null
  if (result?.ok === true) {
    set(addError, null)
    set(urlDraft, '')
    const data = result.data as { alias?: unknown } | null | undefined
    const alias = data && typeof data === 'object' && typeof data.alias === 'string' && data.alias ? data.alias : null
    if (read(view).kind === 'add' && alias) void selectAdded(alias)
    else void loadEnv()
  } else if (wasPending) {
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
  stopWaiting()
  set(addError, null)
  set(adding, true)
  pending = true
  deadline = setTimeout(() => {
    deadline = null
    if (!read(adding)) return
    stopWaiting()
    set(addError, DID_NOT_FINISH)
  }, SIGN_IN_DEADLINE_MS)
  const answer = await call('yt.servers.add', { url })
  if (!answer.ok) {
    stopWaiting()
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
      {waiting && read(notYet) ? <Text muted size="sm">Not signed in yet.</Text> : null}
      {waiting ? (
        <Row gap="xs">
          <Button variant="outline" onPress={() => void checkAdded()}>
            Check again
          </Button>
          <Button variant="ghost" onPress={cancelAdd}>
            Cancel
          </Button>
        </Row>
      ) : null}
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
      <Button
        variant="ghost"
        size="sm"
        onPress={() => {
          cancelAdd()
          set(view, { kind: 'list' })
        }}
      >
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

