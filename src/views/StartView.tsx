import { Button, Callout, Field, Heading, Input, Row, Select, Skeleton, Stack, Switch, Text, Textarea, read, set } from 'orca'
import {
  back, canStart, editPrompt, failure, includeDescription, load, loadedFor, mode, name, prep, prompt, PROMPT_LIMIT, resetPrompt,
  repoId, runError, running, setProject, status, submit, sync, toggleDescription, workspaceId, chosenAgent, currentAvailable, usableMode,
  worktreeAvailable, workspaceOptions, templateId, chooseTemplate, withoutPrompt, clearPrompt
} from '../startState'
import { AgentPicker } from './start/AgentPicker'
import { BranchPicker } from './start/BranchPicker'
import { Combobox } from './Combobox'
import { server } from '../state'
import type { StartPrepare } from '../protocol'

const BackButton = () => (
  <Button variant="ghost" size="sm" disabled={read(running)} onPress={() => back()}>
    ← Back
  </Button>
)

function Form({ id, p }: { id: string; p: StartPrepare }) {
  const current = read(mode)
  const worktree = current === 'worktree'
  const length = read(prompt).length
  const agent = chosenAgent()
  const noPrompt = read(withoutPrompt)
  /** The prompt and the controls that build it: off without an agent or without a prompt. */
  const promptOff = !agent || noPrompt
  const tooLong = !promptOff && length > PROMPT_LIMIT
  const gate = canStart()
  const error = read(runError)
  return (
    <Stack gap="sm">
      {/*
        A Select under the Field's label, like every other field here: Orca draws a RadioGroup's
        circles a little above the text of their labels.
      */}
      <Field label="Run in">
        <Select
          label="Run in"
          labelHidden
          value={current}
          options={[
            { value: 'worktree', label: 'New worktree', disabled: !worktreeAvailable(p) },
            { value: 'current', label: 'Current workspace', disabled: !currentAvailable(p) }
          ]}
          onChange={(value) => set(mode, usableMode(p, value === 'current' ? 'current' : 'worktree'))}
        />
      </Field>
      {p.orcaCli ? null : <Text muted>Orca CLI not found — new worktrees are unavailable.</Text>}
      {p.orcaCli && p.reposError ? (
        <Text muted size="sm">{`Projects could not be loaded, so new worktrees are unavailable: ${p.reposError}`}</Text>
      ) : null}
      {p.workspacesError ? (
        <Text muted size="sm">{`Workspaces could not be loaded, so the current workspace is unavailable: ${p.workspacesError}`}</Text>
      ) : null}
      <Combobox
        label="Project"
        value={read(repoId)}
        placeholder="Choose a project"
        disabled={!worktree}
        options={p.repos.map((repo) => ({ value: repo.id, label: repo.name }))}
        onChange={setProject}
      />
      <Field label="Name">
        <Input label="Name" labelHidden value={read(name)} disabled={!worktree} onChange={(value) => set(name, value)} />
      </Field>
      <BranchPicker enabled={worktree} />
      {/* Not used for a new worktree: no value is shown then, but the choice is kept for Current workspace. */}
      <Combobox
        label="Workspace"
        value={worktree ? null : read(workspaceId)}
        placeholder={worktree ? 'A new worktree is created' : 'Choose a workspace'}
        disabled={worktree}
        options={workspaceOptions(p.workspaces, p.defaultWorkspaceId)}
        onChange={(value) => set(workspaceId, value)}
      />
      {worktree ? null : (
        <Callout tone="warning">
          <Text>The agent works in this folder on its current branch. No new branch is created.</Text>
        </Callout>
      )}
      <AgentPicker />
      {gate.hint ? <Text muted size="sm">{gate.hint}</Text> : null}
      {/* Switches: Orca centers them on their label's line, while a Checkbox's box sits above the text. */}
      <Switch
        label="Start without a prompt"
        checked={noPrompt}
        disabled={!agent}
        onChange={(on) => set(withoutPrompt, on)}
      />
      <Switch
        label="Include issue description in prompt"
        checked={read(includeDescription)}
        disabled={promptOff}
        onChange={toggleDescription}
      />
      {p.templates.length > 0 ? (
        <Combobox
          label="Template"
          value={read(templateId)}
          placeholder="Choose a template"
          disabled={promptOff}
          options={p.templates.map((t) => ({ value: t.id, label: t.name }))}
          onChange={chooseTemplate}
        />
      ) : null}
      <Field label="Prompt">
        <Textarea label="Prompt" labelHidden rows={8} value={read(prompt)} disabled={promptOff} onChange={editPrompt} />
      </Field>
      <Row gap="xs" align="center" justify="between">
        <Row gap="xs">
          <Button variant="ghost" size="sm" disabled={promptOff} onPress={resetPrompt}>
            Reset to template
          </Button>
          <Button variant="ghost" size="sm" disabled={promptOff || length === 0} onPress={clearPrompt}>
            Clear
          </Button>
        </Row>
        <Text tone={tooLong ? 'danger' : undefined} muted={!tooLong} size="sm">
          {`${length} / ${PROMPT_LIMIT}`}
        </Text>
      </Row>
      {tooLong ? (
        <Text tone="danger" size="sm">
          The prompt is too long. Shorten it to {PROMPT_LIMIT} characters or fewer.
        </Text>
      ) : null}
      {error ? (
        <Callout tone="danger">
          <Text>{error}</Text>
        </Callout>
      ) : null}
      <Row gap="xs">
        <Button disabled={!gate.ok} onPress={() => void submit(id)}>
          Start
        </Button>
      </Row>
    </Stack>
  )
}

export function StartView({ id }: { id: string }) {
  sync(id)
  const ready = read(loadedFor) === `${read(server)}|${id}` ? read(status) : 'loading'
  const p = read(prep)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <BackButton />
        <Heading level={3}>{`Start ${id}`}</Heading>
      </Row>
      {ready === 'error' ? (
        <Callout tone="danger">
          <Stack gap="xs">
            <Text>{read(failure)}</Text>
            <Button variant="ghost" onPress={() => void load(id)}>
              Retry
            </Button>
          </Stack>
        </Callout>
      ) : ready === 'ok' && p ? (
        <Form id={id} p={p} />
      ) : (
        <Skeleton shape="text" lines={6} label="Loading" />
      )}
    </Stack>
  )
}
