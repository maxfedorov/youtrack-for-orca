import { Button, Input, Row, Stack, Text, atom, read, set, update } from 'orca'
import { call, server, view } from '../state'
import { listStatus, loadLinks, rerunSearch } from '../listState'

/** Longest command the worker accepts. */
export const MAX_COMMAND = 500
/** Shown when the answer did not come in time: the command may have run on the server all the same. */
export const MAY_HAVE_APPLIED = 'The command may have been applied. Refresh before trying again.'

type CommandState = { text: string; busy: boolean; error: string; note: string; applied: boolean }
const EMPTY: CommandState = { text: '', busy: false, error: '', note: '', applied: false }

/** The command state of each issue, by `server|id`: a command still running keeps its own. */
const commands = atom<Record<string, CommandState>>({})

const keyOf = (alias: string, id: string) => `${alias}|${id}`
const stateOf = (key: string): CommandState => read(commands)[key] ?? EMPTY
const patch = (key: string, next: Partial<CommandState>) =>
  update(commands, (all) => ({ ...all, [key]: { ...(all[key] ?? EMPTY), ...next } }))

/** Reloads what shows the issue now: the open detail of that issue, and the list of that server. */
let reloadDetail: ((id: string) => unknown) | null = null
export function onCommandApplied(reload: (id: string) => unknown): void {
  reloadDetail = reload
}

async function refreshAfter(alias: string, id: string): Promise<void> {
  if (read(server) !== alias) return
  const current = read(view)
  const work: unknown[] = []
  if (read(listStatus) !== 'idle') work.push(rerunSearch(), loadLinks())
  if (current.kind === 'detail' && current.issueId === id && reloadDetail) work.push(reloadDetail(id))
  await Promise.all(work)
}

async function apply(id: string): Promise<void> {
  const alias = read(server)
  if (!alias) return
  const key = keyOf(alias, id)
  const state = stateOf(key)
  const text = state.text.trim()
  if (!text || state.busy) return
  patch(key, { busy: true, error: '', note: '', applied: false })
  const answer = await call('yt.issue.command', { server: alias, id, command: text })
  if (answer.ok) {
    patch(key, { ...EMPTY, applied: true })
  } else if (answer.code === 'TIMEOUT') {
    patch(key, { busy: false, note: MAY_HAVE_APPLIED })
  } else {
    patch(key, { busy: false, error: answer.message })
    return
  }
  await refreshAfter(alias, id)
}

/**
 * Applies a YouTrack command (such as "State Done") to one issue, only when Apply is pressed. On success
 * the text is cleared and the list and the open detail reload; a failure keeps the text and shows why.
 */
export function CommandBar({ id }: { id: string }) {
  const key = keyOf(read(server) ?? '', id)
  const state = stateOf(key)
  return (
    <Stack gap="xs">
      <Row gap="xs" align="end">
        <Input
          label="Command"
          placeholder="State Done"
          value={state.text}
          maxLength={MAX_COMMAND}
          invalid={state.error ? true : undefined}
          disabled={state.busy || undefined}
          onChange={(text) => patch(key, { text, error: '', note: '', applied: false })}
        />
        <Button variant="outline" size="sm" disabled={state.busy || !state.text.trim()} onPress={() => void apply(id)}>
          Apply
        </Button>
      </Row>
      {state.error ? (
        <Text tone="danger" size="sm">
          {state.error}
        </Text>
      ) : state.note ? (
        <Text tone="warning" size="sm">
          {state.note}
        </Text>
      ) : state.applied ? (
        <Text muted size="sm">
          Command applied.
        </Text>
      ) : null}
    </Stack>
  )
}
