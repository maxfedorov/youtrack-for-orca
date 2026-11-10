import { Button, Input, Row, Stack, Text, atom, read, set } from 'orca'
import { call, server } from '../state'

/** Longest command the worker accepts. */
export const MAX_COMMAND = 500

type CommandState = { issueId: string; text: string; busy: boolean; error: string; applied: boolean }
const EMPTY = { text: '', busy: false, error: '', applied: false }

/** The command being typed for one issue; another issue starts empty. */
const command = atom<CommandState>({ issueId: '', ...EMPTY })

const stateOf = (id: string): CommandState => {
  const current = read(command)
  return current.issueId === id ? current : { issueId: id, ...EMPTY }
}

async function apply(id: string, onApplied: () => unknown): Promise<void> {
  const current = read(server)
  const state = stateOf(id)
  const text = state.text.trim()
  if (!current || !text || state.busy) return
  set(command, { ...state, busy: true, error: '', applied: false })
  const answer = await call('yt.issue.command', { server: current, id, command: text })
  const now = read(command)
  if (now.issueId !== id) return
  if (!answer.ok) {
    set(command, { ...now, busy: false, error: answer.message })
    return
  }
  set(command, { issueId: id, ...EMPTY, applied: true })
  await onApplied()
}

/**
 * Applies a YouTrack command (such as "State Done") to one issue, only when Apply is pressed. On success
 * the text is cleared and `onApplied` reloads what shows the issue; a failure keeps the text and shows why.
 */
export function CommandBar({ id, onApplied }: { id: string; onApplied: () => unknown }) {
  const state = stateOf(id)
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
          onChange={(text) => set(command, { ...stateOf(id), text, error: '', applied: false })}
        />
        <Button variant="outline" size="sm" disabled={state.busy || !state.text.trim()} onPress={() => void apply(id, onApplied)}>
          Apply
        </Button>
      </Row>
      {state.error ? (
        <Text tone="danger" size="sm">
          {state.error}
        </Text>
      ) : state.applied ? (
        <Text muted size="sm">
          Command applied.
        </Text>
      ) : null}
    </Stack>
  )
}
