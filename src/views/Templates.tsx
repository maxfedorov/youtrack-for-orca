import { Badge, Button, Callout, Field, Heading, IconButton, Input, Row, Skeleton, Stack, Text, Textarea, read } from 'orca'
import {
  askDelete, cancelDelete, cancelDraft, confirmDelete, defaultTemplateId, deleting, draft, draftError, draftReady, editDraft, editTemplate,
  loadTemplates, makeDefault, MAX_TEMPLATE_BODY, MAX_TEMPLATE_NAME, newTemplate, restoreBuiltIns, saveDraft, templates, templatesBusy,
  templatesError, templatesLoadError, templatesStatus, type Draft
} from '../settingsState'
import type { Template } from '../protocol'

const PLACEHOLDERS =
  'Placeholders: {{id}}, {{id_lower}}, {{summary}}, {{summary_slug}}, {{url}}, {{project}}, {{server}}, {{state}}, {{priority}}, {{assignee}}, {{description}}, {{branch}}. Issue text is put between untrusted-data markers.'

function Editor({ d }: { d: Draft }) {
  const busy = read(templatesBusy)
  const error = read(draftError)
  return (
    <Stack gap="sm">
      <Text weight="semibold">{d.id ? 'Edit template' : 'New template'}</Text>
      <Field label="Name">
        <Input label="Name" labelHidden value={d.name} maxLength={MAX_TEMPLATE_NAME} disabled={busy || undefined} onChange={(name) => editDraft({ name })} />
      </Field>
      <Field label="Template" description={PLACEHOLDERS}>
        <Textarea
          label="Template"
          labelHidden
          rows={12}
          value={d.body}
          maxLength={MAX_TEMPLATE_BODY}
          disabled={busy || undefined}
          onChange={(body) => editDraft({ body })}
        />
      </Field>
      <Row gap="xs" align="center" justify="between">
        <Button variant="ghost" size="sm" disabled={busy || d.body.length === 0} onPress={() => editDraft({ body: '' })}>
          Clear
        </Button>
        <Text muted size="sm">{`${d.body.length} / ${MAX_TEMPLATE_BODY}`}</Text>
      </Row>
      {error ? (
        <Text tone="danger" size="sm">
          {error}
        </Text>
      ) : null}
      <Row gap="xs">
        <Button variant="solid" tone="accent" disabled={busy || !draftReady(d)} onPress={() => void saveDraft()}>
          Save
        </Button>
        <Button variant="ghost" disabled={busy} onPress={cancelDraft}>
          Cancel
        </Button>
      </Row>
    </Stack>
  )
}

function TemplateRow({ template, isDefault }: { template: Template; isDefault: boolean }) {
  const busy = read(templatesBusy)
  return (
    <Stack gap="xs">
      <Row gap="xs" align="center" justify="between">
        <Row gap="xs" align="center">
          <Text truncate>{template.name}</Text>
          {isDefault ? <Badge tone="accent">Default</Badge> : null}
        </Row>
        <Row gap="xs" align="center">
          <IconButton icon="star" label={`Make ${template.name} the default`} disabled={busy || isDefault} onPress={() => makeDefault(template.id)} />
          <IconButton icon="edit" label={`Edit ${template.name}`} disabled={busy} onPress={() => editTemplate(template)} />
          <IconButton icon="delete" label={`Delete ${template.name}`} disabled={busy} onPress={() => askDelete(template.id)} />
        </Row>
      </Row>
      {read(deleting) === template.id ? (
        <Callout tone="danger">
          <Stack gap="xs">
            <Text>{`Delete the template ${template.name}?`}</Text>
            <Row gap="xs">
              <Button tone="danger" onPress={() => void confirmDelete()}>
                Delete
              </Button>
              <Button variant="ghost" onPress={cancelDelete}>
                Cancel
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
    </Stack>
  )
}

/** The prompt templates: the default is preselected in Start. */
export function TemplatesSection() {
  const status = read(templatesStatus)
  const d = read(draft)
  const error = read(templatesError)
  return (
    <Stack gap="sm">
      <Heading level={3}>Prompt templates</Heading>
      {status === 'error' ? (
        <Callout tone="danger">
          <Stack gap="xs">
            <Text>{read(templatesLoadError)}</Text>
            <Button variant="ghost" onPress={() => void loadTemplates()}>
              Retry
            </Button>
          </Stack>
        </Callout>
      ) : status !== 'ok' ? (
        <Skeleton shape="text" lines={3} label="Loading templates" />
      ) : d ? (
        <Editor d={d} />
      ) : (
        <Stack gap="sm">
          {error ? (
            <Text tone="danger" size="sm">
              {error}
            </Text>
          ) : null}
          {read(templates).map((template) => (
            <TemplateRow key={template.id} template={template} isDefault={template.id === read(defaultTemplateId)} />
          ))}
          <Row gap="xs" wrap>
            <Button variant="outline" icon="add" disabled={read(templatesBusy)} onPress={newTemplate}>
              New template
            </Button>
            <Button variant="ghost" disabled={read(templatesBusy)} onPress={restoreBuiltIns}>
              Restore built-in templates
            </Button>
          </Row>
        </Stack>
      )}
    </Stack>
  )
}
