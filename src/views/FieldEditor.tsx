import { Button, IconButton, Row, Stack, Text, atom, read, set, update } from 'orca'
import { call, server } from '../state'
import { refreshIssue } from './CommandBar'
import { Combobox } from './Combobox'
import type { FieldValues, IssueDetail } from '../protocol'

/** Option value of "No value" (an option cannot have an empty value). */
const CLEAR = '__clear__'

/** Shown under a picker whose field offers more values than were sent. */
export const cutNote = (name: string) => `Only the first 500 values are listed. Set another one with a command, such as "${name} <value>".`

/** A field the panel can change: one value from a list. */
export const pickable = (f: { kind?: string; multi?: boolean }) => Boolean(f.kind) && f.kind !== 'other' && !f.multi

export type Values = { status: 'loading' | 'ok' | 'error'; values: FieldValues['values']; cut: boolean; error: string; forbidden?: boolean }
/** The values of each field, by `server|issue or draft|field`, read when its picker first opens. */
const valueCache = atom<Record<string, Values>>({})
/** The field being changed, on which issue (`server|id`); null when none. */
const picking = atom<{ key: string; field: string; busy: boolean; error: string } | null>(null)

const issueKey = (issue: IssueDetail) => `${read(server) ?? ''}|${issue.id}`

/** The values known for a field of an issue or draft of the selected server; undefined until asked. */
export const fieldValues = (id: string, field: string): Values | undefined => read(valueCache)[`${read(server) ?? ''}|${id}|${field}`]

/** Reads the values a field offers on an issue or draft once; a failure is kept, so the screens can say why. */
export async function loadFieldValues(id: string, field: string): Promise<void> {
  const alias = read(server)
  const key = `${alias ?? ''}|${id}|${field}`
  const known = read(valueCache)[key]
  if (!alias || known?.status === 'loading' || known?.status === 'ok') return
  update(valueCache, (all) => ({ ...all, [key]: { status: 'loading', values: [], cut: false, error: '' } }))
  const answer = await call('yt.issue.fieldValues', { server: alias, id, field })
  update(valueCache, (all) => ({
    ...all,
    [key]: answer.ok
      ? { status: 'ok', values: answer.data.values, cut: answer.data.cut, error: '' }
      : { status: 'error', values: [], cut: false, error: answer.message, forbidden: answer.code === 'FORBIDDEN' }
  }))
}

/** Forgets the values read, so the next change reads them again (they can depend on the issue). */
export function resetFieldEditor(): void {
  set(picking, null)
  set(valueCache, {})
}

function pick(issue: IssueDetail, field: string): void {
  set(picking, { key: issueKey(issue), field, busy: false, error: '' })
  void loadFieldValues(issue.id, field)
}

async function choose(issue: IssueDetail, field: string, value: string): Promise<void> {
  const alias = read(server)
  const p = read(picking)
  if (!alias || !p || p.busy) return
  set(picking, { ...p, busy: true, error: '' })
  const answer = await call('yt.issue.setField', { server: alias, id: issue.id, field, value: value === CLEAR ? null : value })
  if (read(picking)?.key !== p.key) return
  if (!answer.ok) {
    set(picking, { ...p, busy: false, error: answer.code === 'FORBIDDEN' ? 'You cannot change this issue.' : answer.message })
    return
  }
  set(picking, null)
  update(valueCache, () => ({}))
  await refreshIssue(alias, issue.id)
}

/** Options for a value list; users show their name with the login beside it. */
export const valueOptions = (values: FieldValues['values']) =>
  values.map((v) => (v.label ? { value: v.name, label: v.label, description: v.name } : { value: v.name, label: v.name }))

function Picker({ issue, field }: { issue: IssueDetail; field: IssueDetail['fields'][number] }) {
  const p = read(picking)
  const known = fieldValues(issue.id, field.name)
  let body
  if (!known || known.status === 'loading') {
    body = <Text muted size="sm">Loading values…</Text>
  } else if (known.status === 'error') {
    body = <Text muted size="sm">{known.forbidden ? `You cannot change ${field.name} on this issue.` : `${known.error} Change ${field.name} with a command instead.`}</Text>
  } else {
    const options = valueOptions(known.values)
    body = (
      <Stack gap="xs">
        <Combobox
          label={field.name}
          value={null}
          placeholder={field.value}
          disabled={p?.busy}
          options={field.required ? options : [{ value: CLEAR, label: 'No value', pinned: true }, ...options]}
          onChange={(chosen) => void choose(issue, field.name, chosen)}
        />
        {known.cut ? <Text muted size="sm">{cutNote(field.name)}</Text> : null}
      </Stack>
    )
  }
  return (
    <Stack gap="xs">
      {body}
      {p?.error ? (
        <Text tone="danger" size="sm">
          {p.error}
        </Text>
      ) : null}
      <Row gap="xs">
        <Button variant="ghost" size="sm" disabled={p?.busy} onPress={() => set(picking, null)}>
          Cancel
        </Button>
      </Row>
    </Stack>
  )
}

/** The issue's fields; each single-value list field has a button that changes it from the values it offers. */
export function FieldList({ issue }: { issue: IssueDetail }) {
  const p = read(picking)
  const mine = p?.key === issueKey(issue) ? p.field : null
  return (
    <Stack key="fields" gap="xs">
      {issue.fields.map((field, index) => (
        <Stack key={`${field.name}#${index}`} gap="xs">
          <Row gap="xs" align="center" justify="between">
            <Stack gap="none">
              <Text muted size="xs">
                {field.name}
              </Text>
              <Text key={`field-value:${field.name}`} size="sm">
                {field.value}
              </Text>
            </Stack>
            {pickable(field) ? (
              <IconButton icon="edit" label={`Change ${field.name}`} variant="ghost" size="sm" disabled={mine === field.name} onPress={() => pick(issue, field.name)} />
            ) : null}
          </Row>
          {mine === field.name ? <Picker issue={issue} field={field} /> : null}
        </Stack>
      ))}
    </Stack>
  )
}
