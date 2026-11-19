import { Button, IconButton, Row, Stack, Text, atom, read, set, update } from 'orca'
import { call, server } from '../state'
import { refreshIssue } from './CommandBar'
import { Combobox } from './Combobox'
import type { IssueDetail, ProjectField } from '../protocol'

/** Option value of "No value" (an option cannot have an empty value). */
const CLEAR = '__clear__'

type Meta = { status: 'loading' | 'ok' | 'error'; fields: ProjectField[]; error: string }
/** The fields of each project, by `server|project`, read once when a field is first changed. */
const metas = atom<Record<string, Meta>>({})
/** The field being changed, on which issue (`server|id`); null when none. */
const picking = atom<{ key: string; field: string; busy: boolean; error: string } | null>(null)

const issueKey = (issue: IssueDetail) => `${read(server) ?? ''}|${issue.id}`
const metaKey = (issue: IssueDetail) => `${read(server) ?? ''}|${issue.project.shortName}`

/** Forgets what was read, so the next change reads the project's fields again. */
export function resetFieldEditor(): void {
  set(picking, null)
  set(metas, {})
}

async function loadMeta(issue: IssueDetail): Promise<void> {
  const alias = read(server)
  const key = metaKey(issue)
  const known = read(metas)[key]
  if (!alias || known?.status === 'loading' || known?.status === 'ok') return
  update(metas, (all) => ({ ...all, [key]: { status: 'loading', fields: [], error: '' } }))
  const answer = await call('yt.project.fields', { server: alias, project: issue.project.shortName })
  update(metas, (all) => ({
    ...all,
    [key]: answer.ok ? { status: 'ok', fields: answer.data.fields, error: '' } : { status: 'error', fields: [], error: answer.message }
  }))
}

function pick(issue: IssueDetail, field: string): void {
  set(picking, { key: issueKey(issue), field, busy: false, error: '' })
  void loadMeta(issue)
}

async function choose(issue: IssueDetail, field: string, value: string): Promise<void> {
  const alias = read(server)
  const p = read(picking)
  if (!alias || !p || p.busy) return
  set(picking, { ...p, busy: true, error: '' })
  const answer = await call('yt.issue.setField', { server: alias, id: issue.id, field, value: value === CLEAR ? null : value })
  if (read(picking)?.key !== p.key) return
  if (!answer.ok) {
    set(picking, { ...p, busy: false, error: answer.message })
    return
  }
  set(picking, null)
  await refreshIssue(alias, issue.id)
}

function Picker({ issue, name, value }: { issue: IssueDetail; name: string; value: string }) {
  const p = read(picking)
  const meta = read(metas)[metaKey(issue)]
  const field = meta?.fields.find((f) => f.name === name)
  let body
  if (!meta || meta.status === 'loading') {
    body = <Text muted size="sm">Loading values…</Text>
  } else if (meta.status === 'error') {
    body = <Text muted size="sm">{`${meta.error} Change ${name} with a command instead.`}</Text>
  } else if (!field || field.kind === 'other' || field.multi) {
    body = <Text muted size="sm">{`Change ${name} with a command, such as "${name} ${value}".`}</Text>
  } else {
    const options = field.values.map((v) => (v.label ? { value: v.name, label: v.label, description: v.name } : { value: v.name, label: v.name }))
    body = (
      <Combobox
        label={name}
        value={null}
        placeholder={value}
        disabled={p?.busy}
        options={field.required ? options : [{ value: CLEAR, label: 'No value', pinned: true }, ...options]}
        onChange={(chosen) => void choose(issue, name, chosen)}
      />
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

/** The issue's fields, each with a button that changes it from the values its project offers. */
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
            <IconButton icon="edit" label={`Change ${field.name}`} variant="ghost" size="sm" disabled={mine === field.name} onPress={() => pick(issue, field.name)} />
          </Row>
          {mine === field.name ? <Picker issue={issue} name={field.name} value={field.value} /> : null}
        </Stack>
      ))}
    </Stack>
  )
}
