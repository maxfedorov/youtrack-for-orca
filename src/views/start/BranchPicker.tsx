import { Button, Input, List, ListItem, Row, Stack, Text, read } from 'orca'
import { baseBranch, chooseRef, filter, refs, refsError, repoOf, resetBranch, prep, repoId, setFilter } from '../../startState'

export function BranchPicker({ enabled }: { enabled: boolean }) {
  const p = read(prep)
  const chosen = read(baseBranch)
  const ref = repoOf(p?.repos ?? [], read(repoId))?.worktreeBaseRef
  const fallback = ref ? `Project default (${ref})` : 'Project default'
  const found = read(refs)
  return (
    <Stack gap="xs">
      <Text weight="medium" size="sm">
        Create from
      </Text>
      <Row gap="xs" align="center">
        <Text>{chosen || fallback}</Text>
        {chosen && enabled ? (
          <Button variant="ghost" size="sm" onPress={resetBranch}>
            Use project default
          </Button>
        ) : null}
      </Row>
      <Input
        type="search"
        label="Filter branches"
        value={read(filter)}
        placeholder="Filter branches"
        disabled={!enabled}
        onChange={setFilter}
      />
      {read(refsError) ? (
        <Text tone="danger" size="sm">
          {read(refsError)}
        </Text>
      ) : null}
      {found.length > 0 ? (
        <List label="Branches">
          {found.map((item) => (
            <ListItem key={item} title={item} current={item === chosen} disabled={!enabled} onPress={() => chooseRef(item)} />
          ))}
        </List>
      ) : null}
    </Stack>
  )
}
