import { Button, Callout, Checkbox, Heading, Input, RadioGroup, Row, Select, Skeleton, Stack, Text, Textarea, read, set } from 'orca'
import {
  back, canStart, editPrompt, failure, includeDescription, load, loadedFor, mode, name, prep, prompt, PROMPT_LIMIT, resetPrompt,
  repoId, runError, running, setProject, status, submit, sync, toggleDescription, workspaceId, chosenAgent
} from '../startState'
import { AgentPicker } from './start/AgentPicker'
import { BranchPicker } from './start/BranchPicker'
import type { StartPrepare } from '../protocol'

const BackButton = () => (
  <Button variant="ghost" size="sm" onPress={back}>
    ← Back
  </Button>
)

function Form({ id, p }: { id: string; p: StartPrepare }) {
  const current = read(mode)
  const worktree = current === 'worktree'
  const length = read(prompt).length
  const agent = chosenAgent()
  const tooLong = Boolean(agent) && length > PROMPT_LIMIT
  const gate = canStart()
  const error = read(runError)
  return (
    <Stack gap="sm">
      <RadioGroup
        label="Run in"
        value={current}
        orientation="horizontal"
        options={[
          { value: 'worktree', label: 'New worktree', disabled: !p.orcaCli },
          { value: 'current', label: 'Current workspace' }
        ]}
        onChange={(value) => set(mode, value === 'current' || !p.orcaCli ? 'current' : 'worktree')}
      />
      {p.orcaCli ? null : <Text muted>Orca CLI not found — new worktrees are unavailable.</Text>}
      {p.reposError ? <Text tone="danger" size="sm">{p.reposError}</Text> : null}
      <Select
        label="Project"
        value={read(repoId) ?? undefined}
        placeholder="Choose a project"
        disabled={!worktree}
        options={p.repos.map((repo) => ({ value: repo.id, label: repo.name }))}
        onChange={setProject}
      />
      <Input label="Name" value={read(name)} disabled={!worktree} onChange={(value) => set(name, value)} />
      <BranchPicker enabled={worktree} />
      <Select
        label="Workspace"
        value={read(workspaceId) ?? undefined}
        placeholder="Choose a workspace"
        disabled={worktree}
        options={p.workspaces.map((item) => ({ value: item.id, label: item.project ? `${item.name} — ${item.project}` : item.name }))}
        onChange={(value) => set(workspaceId, value)}
      />
      {worktree ? null : (
        <Callout tone="warning">
          <Text>The agent works in this folder on its current branch. No new branch is created.</Text>
        </Callout>
      )}
      <AgentPicker />
      {gate.hint ? <Text muted size="sm">{gate.hint}</Text> : null}
      <Checkbox
        label="Include issue description in prompt"
        checked={read(includeDescription)}
        disabled={!agent}
        onChange={toggleDescription}
      />
      <Textarea label="Prompt" rows={8} value={read(prompt)} disabled={!agent} onChange={editPrompt} />
      <Row gap="xs" align="center" justify="between">
        <Button variant="ghost" size="sm" disabled={!agent} onPress={resetPrompt}>
          Reset to template
        </Button>
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
  const ready = read(loadedFor) === id ? read(status) : 'loading'
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
