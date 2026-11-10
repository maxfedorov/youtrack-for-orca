import { Field, Input, Select, Stack, Text, read } from 'orca'
import { baseBranch, chooseRef, PROJECT_DEFAULT, filter, refs, refsError, repoOf, prep, repoId, setFilter } from '../../startState'

const MAX_OPTIONS = 200

export function BranchPicker({ enabled }: { enabled: boolean }) {
  const p = read(prep)
  const chosen = read(baseBranch)
  const ref = repoOf(p?.repos ?? [], read(repoId))?.worktreeBaseRef
  const first = { value: PROJECT_DEFAULT, label: ref ? `Project default (${ref})` : 'Project default' }
  // The current choice stays in the list even when a newer filter no longer finds it.
  const names = [...(chosen ? [chosen] : []), ...read(refs).filter((item) => item !== chosen)]
  const options = [first, ...names.map((item) => ({ value: item, label: item }))].slice(0, MAX_OPTIONS)
  return (
    <Field label="Create from">
      <Stack gap="xs">
        <Input type="search" label="Filter branches" labelHidden value={read(filter)} placeholder="Filter branches" disabled={!enabled} onChange={setFilter} />
        <Select label="Create from" labelHidden value={chosen || PROJECT_DEFAULT} options={options} disabled={!enabled} onChange={(value) => chooseRef(value === PROJECT_DEFAULT ? '' : value)} />
        {read(refsError) ? (
          <Text muted size="sm">
            {`Branches could not be loaded, so only the project default is offered. ${read(refsError)}`}
          </Text>
        ) : null}
      </Stack>
    </Field>
  )
}
