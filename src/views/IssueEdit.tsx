import { Button, Field, Input, Row, Stack, Text, Textarea, atom, read, set } from 'orca'
import { call, server } from '../state'
import { refreshIssue } from './CommandBar'
import type { IssueDetail } from '../protocol'

/** Longest summary and description the worker accepts. */
export const MAX_SUMMARY = 255
export const MAX_DESCRIPTION = 60_000

type Draft = { key: string; summary: string; description: string; busy: boolean; error: string }

/** The issue being edited (`server|id`) and its draft; null when none is. */
const draft = atom<Draft | null>(null)
const keyOf = (issue: IssueDetail) => `${read(server) ?? ''}|${issue.id}`

export const editing = (issue: IssueDetail) => read(draft)?.key === keyOf(issue)
export const startEdit = (issue: IssueDetail) =>
  set(draft, { key: keyOf(issue), summary: issue.summary, description: issue.descriptionMd, busy: false, error: '' })
export const stopEdit = () => set(draft, null)
const patch = (next: Partial<Draft>) => {
  const d = read(draft)
  if (d) set(draft, { ...d, ...next })
}

/** Sends what changed; on success the edit closes and the issue and the list show it. */
async function save(issue: IssueDetail): Promise<void> {
  const d = read(draft)
  const alias = read(server)
  if (!d || !alias || d.busy || d.key !== keyOf(issue)) return
  const summary = d.summary.trim()
  const change: { summary?: string; description?: string } = {}
  if (summary !== issue.summary) change.summary = summary
  // A description shown cut short is never written back.
  if (!issue.truncated && d.description !== issue.descriptionMd) change.description = d.description
  if (Object.keys(change).length === 0) return stopEdit()
  patch({ busy: true, error: '' })
  const answer = await call('yt.issue.update', { server: alias, id: issue.id, ...change })
  if (read(draft)?.key !== d.key) return
  if (!answer.ok) return patch({ busy: false, error: answer.message })
  stopEdit()
  await refreshIssue(alias, issue.id)
}

/** The summary and description as fields, with Save and Cancel. */
export function IssueEditForm({ issue }: { issue: IssueDetail }) {
  const d = read(draft)
  if (!d) return null
  const summary = d.summary.trim()
  const tooLong = summary.length > MAX_SUMMARY || d.description.length > MAX_DESCRIPTION
  return (
    <Stack gap="xs">
      <Field label="Summary">
        <Input label="Summary" labelHidden value={d.summary} maxLength={MAX_SUMMARY} disabled={d.busy || undefined} onChange={(value) => patch({ summary: value.replace(/[\r\n]+/g, ' '), error: '' })} />
      </Field>
      <Field label="Description">
        <Textarea
          label="Description"
          labelHidden
          rows={10}
          value={d.description}
          disabled={d.busy || issue.truncated || undefined}
          onChange={(value) => patch({ description: value, error: '' })}
        />
      </Field>
      {issue.truncated ? (
        <Text muted size="sm">
          This description is too long to edit here. Edit it in the browser.
        </Text>
      ) : null}
      {d.error ? (
        <Text tone="danger" size="sm">
          {d.error}
        </Text>
      ) : null}
      <Row gap="xs">
        <Button disabled={d.busy || !summary || tooLong} onPress={() => void save(issue)}>
          Save
        </Button>
        <Button variant="ghost" disabled={d.busy} onPress={stopEdit}>
          Cancel
        </Button>
      </Row>
    </Stack>
  )
}
