import { Button, Callout, Field, Heading, Input, Row, Stack, Text, Textarea, atom, read, set } from 'orca'
import { call, goBack, here, server, view } from '../state'
import { currentIssue, issues, rerunSearch } from '../listState'
import { Combobox } from './Combobox'
import { cutNote, fieldValues, loadFieldValues, pickable, valueOptions } from './FieldEditor'
import { MAX_DESCRIPTION, MAX_SUMMARY } from './IssueEdit'
import type { FieldMeta } from '../protocol'

type Form = {
  projects: { shortName: string; name: string }[]
  projectsError: string
  project: string | null
  /** The draft the form fills, and the fields it has; null while it is made or when it could not be. */
  draft: { id: string; fields: FieldMeta[] } | null
  draftError: string
  summary: string
  description: string
  /** Field name -> chosen value. */
  values: Record<string, string>
  more: boolean
  busy: boolean
  error: string
}
const EMPTY: Form = { projects: [], projectsError: '', project: null, draft: null, draftError: '', summary: '', description: '', values: {}, more: false, busy: false, error: '' }
const form = atom<Form>(EMPTY)
const patch = (next: Partial<Form>) => set(form, { ...read(form), ...next })
/** Bumped when the form opens or its project changes: answers for an older one are dropped. */
let opened = 0

const projectOf = (id: string) => id.slice(0, id.lastIndexOf('-'))

/** The project to offer first: that of the current workspace's issue, else of the first listed issue. */
function likelyProject(): string | null {
  const id = read(currentIssue)?.id ?? read(issues)[0]?.id
  return id ? projectOf(id) : null
}

/** Deletes the form's draft; the issue was not created from it. */
function discard(): void {
  const alias = read(server)
  const draft = read(form).draft
  if (alias && draft) void call('yt.issue.draft.discard', { server: alias, draftId: draft.id })
}

async function chooseProject(project: string): Promise<void> {
  const alias = read(server)
  if (!alias) return
  discard()
  const mine = ++opened
  patch({ project, draft: null, draftError: '', values: {}, more: false, error: '' })
  const answer = await call('yt.issue.draft', { server: alias, project })
  if (mine !== opened || read(view).kind !== 'create') return
  if (!answer.ok) return patch({ draftError: answer.message })
  patch({ draft: { id: answer.data.draftId, fields: answer.data.fields } })
  for (const field of answer.data.fields) if (field.required && pickable(field)) void loadFieldValues(answer.data.draftId, field.name)
}

/** Opens the form; Back returns to the screen it was opened from. */
export function openCreate(): void {
  opened++
  set(form, { ...EMPTY })
  set(view, { kind: 'create', back: here() })
  void loadProjects()
}

function close(): void {
  discard()
  opened++
  set(form, { ...EMPTY })
  goBack()
}

async function loadProjects(): Promise<void> {
  const alias = read(server)
  const mine = opened
  if (!alias) return
  const answer = await call('yt.projects', { server: alias })
  if (mine !== opened || read(view).kind !== 'create') return
  if (!answer.ok) return patch({ projectsError: answer.message })
  const projects = answer.data.projects
  const likely = likelyProject()
  patch({ projects, projectsError: '' })
  const first = projects.find((p) => p.shortName === likely)?.shortName ?? projects[0]?.shortName
  if (first && !read(form).project) void chooseProject(first)
}

async function create(): Promise<void> {
  const alias = read(server)
  const f = read(form)
  if (!alias || !f.draft || f.busy || !f.summary.trim()) return
  const mine = opened
  patch({ busy: true, error: '' })
  const answer = await call('yt.issue.create', { server: alias, draftId: f.draft.id, summary: f.summary.trim(), description: f.description, fields: f.values })
  if (mine !== opened || read(server) !== alias || read(view).kind !== 'create') return
  if (!answer.ok) return patch({ busy: false, error: answer.message })
  opened++
  set(form, { ...EMPTY })
  // The new issue opens; Back from it returns to the list.
  set(view, { kind: 'detail', issueId: answer.data.id })
  void rerunSearch()
}

function FieldPicker({ draftId, field }: { draftId: string; field: FieldMeta }) {
  const f = read(form)
  const known = fieldValues(draftId, field.name)
  if (!known || known.status === 'loading') return <Text muted size="sm">{`Loading the values of ${field.name}…`}</Text>
  if (known.status === 'error') return <Text muted size="sm">{`${field.name}: ${known.error}`}</Text>
  return (
    <Stack gap="xs">
      <Combobox
        label={field.name}
        value={f.values[field.name] ?? null}
        placeholder={field.value && field.value !== '\u2014' ? field.value : field.required ? 'Required' : 'Default'}
        disabled={f.busy}
        options={valueOptions(known.values)}
        onChange={(value) => patch({ values: { ...read(form).values, [field.name]: value }, error: '' })}
      />
      {known.cut ? <Text muted size="sm">{cutNote(field.name)}</Text> : null}
    </Stack>
  )
}

function showMore(draftId: string, optional: FieldMeta[]): void {
  const more = !read(form).more
  patch({ more })
  if (more) for (const field of optional) void loadFieldValues(draftId, field.name)
}

function Fields() {
  const f = read(form)
  if (f.draftError) {
    return (
      <Callout tone="warning">
        <Text>{f.draftError}</Text>
      </Callout>
    )
  }
  if (!f.draft) return <Text muted size="sm">{f.project ? `Loading the fields of ${f.project}…` : ''}</Text>
  const usable = f.draft.fields.filter(pickable)
  const required = usable.filter((field) => field.required)
  const optional = usable.filter((field) => !field.required)
  const unsupported = f.draft.fields.filter((field) => field.required && !pickable(field))
  const draftId = f.draft.id
  return (
    <Stack gap="sm">
      {required.map((field) => (
        <FieldPicker key={field.name} draftId={draftId} field={field} />
      ))}
      {unsupported.length > 0 ? (
        <Text muted size="sm">{`Also required, set after creating with a command: ${unsupported.map((field) => field.name).join(', ')}.`}</Text>
      ) : null}
      {optional.length > 0 ? (
        <Row gap="xs">
          <Button variant="ghost" size="sm" onPress={() => showMore(draftId, optional)}>
            {f.more ? 'Fewer fields' : 'More fields'}
          </Button>
        </Row>
      ) : null}
      {f.more ? optional.map((field) => <FieldPicker key={field.name} draftId={draftId} field={field} />) : null}
    </Stack>
  )
}

/** A new issue: project, summary, description and the fields its draft offers values for. */
export function CreateIssue() {
  const f = read(form)
  const summary = f.summary.trim()
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Button variant="ghost" size="sm" disabled={f.busy} onPress={close}>
          ← Back
        </Button>
        <Heading level={3}>New issue</Heading>
      </Row>
      {f.projectsError ? (
        <Callout tone="danger">
          <Text>{f.projectsError}</Text>
        </Callout>
      ) : null}
      <Combobox
        label="Project"
        value={f.project}
        placeholder="Choose a project"
        disabled={f.busy}
        options={f.projects.map((p) => ({ value: p.shortName, label: p.name, description: p.shortName }))}
        onChange={(project) => void chooseProject(project)}
      />
      <Field label="Summary">
        <Input label="Summary" labelHidden value={f.summary} maxLength={MAX_SUMMARY} disabled={f.busy || undefined} onChange={(value) => patch({ summary: value.replace(/[\r\n]+/g, ' '), error: '' })} />
      </Field>
      <Field label="Description">
        <Textarea label="Description" labelHidden rows={6} value={f.description} disabled={f.busy || undefined} onChange={(value) => patch({ description: value, error: '' })} />
      </Field>
      {f.project ? <Fields /> : null}
      {f.error ? (
        <Callout tone="danger">
          <Text>{f.error}</Text>
        </Callout>
      ) : null}
      <Row gap="xs">
        <Button disabled={f.busy || !f.draft || !summary || summary.length > MAX_SUMMARY || f.description.length > MAX_DESCRIPTION} onPress={() => void create()}>
          Create
        </Button>
      </Row>
    </Stack>
  )
}
