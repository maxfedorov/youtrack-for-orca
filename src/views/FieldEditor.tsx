import { Box, Grid, IconButton, Input, List, ListItem, Stack, Text, atom, read, set, update } from 'orca'
import { call, server } from '../state'
import { refreshIssue } from './CommandBar'
import { Combobox } from './Combobox'
import type { FieldValues, IssueDetail } from '../protocol'

/** Option value of "No value" (an option cannot have an empty value). */
const CLEAR = '__clear__'

/** Shown under a picker whose field offers more values than were sent. */
export const cutNote = (name: string) => `Only the first 500 values are listed. Set another one with a command, such as "${name} <value>".`

const LISTED = ['enum', 'state', 'user', 'version', 'ownedField', 'build']
/** A field the panel can change: one value from a list. */
export const pickable = (f: { kind?: string; multi?: boolean }) => LISTED.includes(f.kind ?? '') && !f.multi
/** A field the panel can change by typing: one string, whole number or period. */
export const typed = (f: { kind?: string; multi?: boolean }) => ['string', 'integer', 'period'].includes(f.kind ?? '') && !f.multi

export type Values = { status: 'loading' | 'ok' | 'error'; values: FieldValues['values']; cut: boolean; error: string; forbidden?: boolean }
/** The values of each field, by `server|issue or draft|field`, read when its picker first opens. */
const valueCache = atom<Record<string, Values>>({})
/** A value being written, or the last write that failed, on which issue (`server|id`); null when none. */
const writing = atom<{ key: string; field: string; busy: boolean; error: string } | null>(null)
/** Text typed into a field and not saved yet, by `server|issue|field`. */
const typing = atom<Record<string, string>>({})

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
  set(writing, null)
  set(typing, {})
  set(valueCache, {})
}

/** Why a write failed, naming the field unless the message already does. */
const writeError = (field: string, code: string, message: string) =>
  code === 'FORBIDDEN' ? 'You cannot change this issue.' : message.startsWith(field) ? message : `${field}: ${message}`

/** Saves one field's value (null empties it), then shows the issue as it is now. */
async function save(issue: IssueDetail, field: string, value: string | null): Promise<void> {
  const alias = read(server)
  const key = issueKey(issue)
  if (!alias || read(writing)?.busy) return
  set(writing, { key, field, busy: true, error: '' })
  const answer = await call('yt.issue.setField', { server: alias, id: issue.id, field, value })
  if (read(writing)?.key !== key) return
  if (!answer.ok) {
    set(writing, { key, field, busy: false, error: writeError(field, answer.code, answer.message) })
    return
  }
  set(writing, null)
  update(valueCache, () => ({}))
  update(typing, ({ [`${key}|${field}`]: _saved, ...rest }) => rest)
  await refreshIssue(alias, issue.id)
}

/** Options for a value list; users show their name with the login beside it. */
export const valueOptions = (values: FieldValues['values']) =>
  values.map((v) => (v.label ? { value: v.name, label: v.label, description: v.name } : { value: v.name, label: v.name }))

/** Why the open list of a field has no options yet, or a note about them; '' when there is none. */
function valuesNote(known: Values | undefined, name: string): string {
  if (!known || known.status === 'loading') return 'Loading values…'
  if (known.status === 'error') return known.forbidden ? `You cannot change ${name} on this issue.` : `${known.error} Change ${name} with a command instead.`
  return known.cut ? cutNote(name) : ''
}

/** A field whose value is a list: the value opens the values it may take, read the first time; choosing one saves it. */
function FieldPicker({ issue, field }: { issue: IssueDetail; field: IssueDetail['fields'][number] }) {
  const w = read(writing)
  const known = fieldValues(issue.id, field.name)
  const options = known?.status === 'ok' ? valueOptions(known.values) : []
  return (
    <Combobox
      label={field.name}
      value={null}
      placeholder={field.value}
      disabled={w?.busy}
      options={field.required || options.length === 0 ? options : [{ value: CLEAR, label: 'No value', pinned: true }, ...options]}
      note={valuesNote(known, field.name)}
      onOpen={() => void loadFieldValues(issue.id, field.name)}
      onChange={(chosen) => void save(issue, field.name, chosen === CLEAR ? null : chosen)}
      compact
    />
  )
}

/**
 * A field whose value is typed: shown like the other values. Pressing it opens an input with the
 * value; Enter saves what was typed, an emptied input empties the field, and the cross
 * closes it unsaved. An empty field shows its empty text, and as the placeholder.
 */
function FieldInput({ issue, field }: { issue: IssueDetail; field: IssueDetail['fields'][number] }) {
  const key = `${issueKey(issue)}|${field.name}`
  const current = field.empty ? '' : field.value
  const text = read(typing)[key]
  const close = () => update(typing, ({ [key]: _closed, ...rest }) => rest)
  if (text === undefined) {
    return (
      <List label={field.name}>
        <ListItem key={`${field.name}:value`} title={field.value} onPress={() => update(typing, (all) => ({ ...all, [key]: current }))} />
      </List>
    )
  }
  const submit = () => {
    const next = (read(typing)[key] ?? current).trim()
    if (next === current) return close()
    void save(issue, field.name, next === '' ? null : next)
  }
  return (
    <Stack gap="none">
      <Box direction="row" align="center" gap="xs">
        <Box grow shrink minWidth={0}>
          <Input
            label={field.name}
            labelHidden
            value={text}
            placeholder={field.empty ? field.value : undefined}
            disabled={read(writing)?.busy}
            onChange={(value) => update(typing, (all) => ({ ...all, [key]: value }))}
            onSubmit={submit}
          />
        </Box>
        <IconButton icon="close" label={`Cancel editing ${field.name}`} variant="ghost" size="sm" disabled={read(writing)?.busy} onPress={close} />
      </Box>
      {text.trim() !== current ? (
        <Box paddingX="sm">
          <Text muted size="xs">Enter to save</Text>
        </Box>
      ) : null}
    </Stack>
  )
}

/** One cell of the field grid: the name in small muted text over the value, both on the list rows' inset. */
function FieldCell({ issue, field }: { issue: IssueDetail; field: IssueDetail['fields'][number] }) {
  return (
    <Stack gap="none">
      <Box paddingX="sm">
        <Text muted size="xs">
          {field.name}
        </Text>
      </Box>
      {pickable(field) ? (
        <FieldPicker issue={issue} field={field} />
      ) : typed(field) ? (
        <FieldInput issue={issue} field={field} />
      ) : (
        <Box paddingX="sm" paddingY="xs">
          <Text key={`field-value:${field.name}`} size="sm">
            {field.value}
          </Text>
        </Box>
      )}
    </Stack>
  )
}

/**
 * The issue's fields in a grid as wide as the panel. A single-value list field is changed right there
 * from the values it offers, a string, number or period by typing it; the others show their value and
 * are changed with a command.
 */
export function FieldList({ issue }: { issue: IssueDetail }) {
  const w = read(writing)
  const error = w?.key === issueKey(issue) ? w.error : ''
  return (
    <Stack key="fields" gap="xs">
      <Grid minItemWidth="sm" gap="sm">
        {issue.fields.map((field, index) => (
          <FieldCell key={`${field.name}#${index}`} issue={issue} field={field} />
        ))}
      </Grid>
      {error ? (
        <Text tone="danger" size="sm">
          {error}
        </Text>
      ) : null}
    </Stack>
  )
}
