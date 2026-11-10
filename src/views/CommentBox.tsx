import { Button, Field, Row, Stack, Text, Textarea, atom, read, update } from 'orca'
import { call, server } from '../state'

/** Longest comment the worker accepts. */
export const MAX_COMMENT = 10_000
/** Shown when the answer did not come in time: the comment may have been added all the same. */
export const MAY_HAVE_POSTED = 'The comment may have been added. Check the comments before sending it again.'

type CommentState = { text: string; busy: boolean; error: string; note: string }
const EMPTY: CommentState = { text: '', busy: false, error: '', note: '' }

/** The draft of each issue, by `server|id`: a comment still being sent keeps its own. */
const drafts = atom<Record<string, CommentState>>({})

const keyOf = (alias: string, id: string) => `${alias}|${id}`
const stateOf = (key: string): CommentState => read(drafts)[key] ?? EMPTY
const patch = (key: string, next: Partial<CommentState>) =>
  update(drafts, (all) => ({ ...all, [key]: { ...(all[key] ?? EMPTY), ...next } }))

async function send(id: string, reload: (id: string) => unknown): Promise<void> {
  const alias = read(server)
  if (!alias) return
  const key = keyOf(alias, id)
  const state = stateOf(key)
  const text = state.text.trim()
  if (!text || state.busy) return
  patch(key, { busy: true, error: '', note: '' })
  const answer = await call('yt.issue.comment', { server: alias, id, text })
  if (answer.ok) {
    patch(key, EMPTY)
  } else if (answer.code === 'TIMEOUT') {
    patch(key, { busy: false, note: MAY_HAVE_POSTED })
  } else {
    patch(key, { busy: false, error: answer.message })
    return
  }
  if (read(server) === alias) await reload(id)
}

/**
 * Adds a comment to the issue when Send or Cmd+Enter (Ctrl+Enter) is pressed. On success the text is
 * cleared and the comments load again; a failure keeps the text and shows why.
 */
export function CommentBox({ id, onPosted }: { id: string; onPosted: (id: string) => unknown }) {
  const key = keyOf(read(server) ?? '', id)
  const state = stateOf(key)
  return (
    <Stack gap="xs">
      <Field label="Add comment">
        <Textarea
          label="Add comment"
          labelHidden
          rows={3}
          value={state.text}
          maxLength={MAX_COMMENT}
          invalid={state.error ? true : undefined}
          disabled={state.busy || undefined}
          onChange={(text) => patch(key, { text, error: '', note: '' })}
          onSubmit={(text) => {
            patch(key, { text })
            void send(id, onPosted)
          }}
        />
      </Field>
      <Row gap="xs" align="center">
        <Button variant="outline" size="sm" disabled={state.busy || !state.text.trim()} onPress={() => void send(id, onPosted)}>
          Send
        </Button>
        {state.error ? (
          <Text tone="danger" size="sm">
            {state.error}
          </Text>
        ) : state.note ? (
          <Text tone="warning" size="sm">
            {state.note}
          </Text>
        ) : null}
      </Row>
    </Stack>
  )
}
