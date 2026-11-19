import { Button, Callout, Field, Heading, Input, Row, Stack, Text, Textarea, atom, read, set } from 'orca'
import { call, goBack, here, server, view } from '../state'
import { currentIssue, issues, rerunSearch } from '../listState'
import { Combobox } from './Combobox'
import { loadProjectFields, projectMeta } from './FieldEditor'
import { MAX_DESCRIPTION, MAX_SUMMARY } from './IssueEdit'
import type { ProjectField } from '../protocol'

type Form = {
  projects: { shortName: string; name: string }[]
  projectsError: string
  project: string | null
  summary: string
  description: string
  /** Field name -> chosen value. */
  values: Record<string, string>
  more: boolean
  busy: boolean
  error: string
}
const EMPTY: Form = { projects: [], projectsError: '', project: null, summary: '', description: '', values: {}, more: false, busy: false, error: '' }
const form = atom<Form>(EMPTY)
const patch = (next: Partial<Form>) => set(form, { ...read(form), ...next })

const projectOf = (id: string) => id.slice(0, id.lastIndexOf('-'))

/** The project to offer first: that of the current workspace's issue, else of the first listed issue. */
function likelyProject(): string | null {
  const id = read(currentIssue)?.id ?? read(issues)[0]?.id
  return id ? projectOf(id) : null
}

function chooseProject(project: string): void {
  patch({ project, values: {}, error: '' })
  void loadProjectFields(project)
}

/** Opens the form; Back returns to the screen it was opened from. */
export function openCreate(): void {
  set(form, { ...EMPTY })
  set(view, { kind: 'create', back: here() })
  void loadProjects()
}

async function loadProjects(): Promise<void> {
  const alias = read(server)
  if (!alias) return
  const answer = await call('yt.projects', { server: alias })
  if (read(view).kind !== 'create') return
  if (!answer.ok) return patch({ projectsError: answer.message })
  const projects = answer.data.projects
  const likely = likelyProject()
  patch({ projects, projectsError: '' })
  const first = projects.find((p) => p.shortName === likely)?.shortName ?? projects[0]?.shortName
  if (first && !read(form).project) chooseProject(first)
}

const pickable = (f: ProjectField) => f.kind !== 'other' && !f.multi && f.values.length > 0

async function create(): Promise<void> {
  const alias = read(server)
  const f = read(form)
  if (!alias || !f.project || f.busy || !f.summary.trim()) return
  patch({ busy: true, error: '' })
  const answer = await call('yt.issue.create', { server: alias, project: f.project, summary: f.summary.trim(), description: f.description, fields: f.values })
  if (read(view).kind !== 'create') return
  if (!answer.ok) return patch({ busy: false, error: answer.message })
  set(form, { ...EMPTY })
  // The new issue opens; Back from it returns to the list.
  set(view, { kind: 'detail', issueId: answer.data.id })
  void rerunSearch()
}

function FieldPicker({ field }: { field: ProjectField }) {
  const f = read(form)
  const options = field.values.map((v) => (v.label ? { value: v.name, label: v.label, description: v.name } : { value: v.name, label: v.name }))
  return (
    <Combobox
      label={field.name}
      value={f.values[field.name] ?? null}
      placeholder={field.required ? 'Required' : (field.emptyText ?? 'Default')}
      disabled={f.busy}
      options={options}
      onChange={(value) => patch({ values: { ...read(form).values, [field.name]: value }, error: '' })}
    />
  )
}

function Fields({ project }: { project: string }) {
  const meta = projectMeta(project)
  const f = read(form)
  if (!meta || meta.status === 'loading') return <Text muted size="sm">Loading the fields of {project}…</Text>
  if (meta.status === 'error') {
    return <Text muted size="sm">{`The fields of this project could not be read (${meta.error}). The issue gets their default values.`}</Text>
  }
  const usable = meta.fields.filter(pickable)
  const required = usable.filter((field) => field.required)
  const optional = usable.filter((field) => !field.required)
  const unsupported = meta.fields.filter((field) => field.required && !pickable(field))
  return (
    <Stack gap="sm">
      {required.map((field) => (
        <FieldPicker key={field.name} field={field} />
      ))}
      {unsupported.length > 0 ? (
        <Text muted size="sm">{`Also required, set after creating with a command: ${unsupported.map((field) => field.name).join(', ')}.`}</Text>
      ) : null}
      {optional.length > 0 ? (
        <Row gap="xs">
          <Button variant="ghost" size="sm" onPress={() => patch({ more: !f.more })}>
            {f.more ? 'Fewer fields' : 'More fields'}
          </Button>
        </Row>
      ) : null}
      {f.more ? optional.map((field) => <FieldPicker key={field.name} field={field} />) : null}
    </Stack>
  )
}

/** A new issue: project, summary, description and the fields its project offers values for. */
export function CreateIssue() {
  const f = read(form)
  const summary = f.summary.trim()
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Button variant="ghost" size="sm" disabled={f.busy} onPress={goBack}>
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
        onChange={chooseProject}
      />
      <Field label="Summary">
        <Input label="Summary" labelHidden value={f.summary} maxLength={MAX_SUMMARY} disabled={f.busy || undefined} onChange={(value) => patch({ summary: value.replace(/[\r\n]+/g, ' '), error: '' })} />
      </Field>
      <Field label="Description">
        <Textarea label="Description" labelHidden rows={6} value={f.description} disabled={f.busy || undefined} onChange={(value) => patch({ description: value, error: '' })} />
      </Field>
      {f.project ? <Fields project={f.project} /> : null}
      {f.error ? (
        <Callout tone="danger">
          <Text>{f.error}</Text>
        </Callout>
      ) : null}
      <Row gap="xs">
        <Button disabled={f.busy || !f.project || !summary || summary.length > MAX_SUMMARY || f.description.length > MAX_DESCRIPTION} onPress={() => void create()}>
          Create
        </Button>
      </Row>
    </Stack>
  )
}
