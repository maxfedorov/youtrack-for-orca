import { List, ListItem, Stack, Text, read } from 'orca'
import { currentIssue } from '../listState'
import { openDetail } from './IssueRowActions'

/** The issue of the focused workspace, one press from its details; nothing when there is none. */
export function CurrentIssue() {
  const issue = read(currentIssue)
  if (!issue) return null
  return (
    <Stack gap="none">
      <Text muted size="xs" weight="medium">
        This workspace
      </Text>
      <List label="Issue of this workspace">
        <ListItem key={issue.id} title={`${issue.id} ${issue.summary}`.trim()} onPress={() => openDetail(issue.id)} />
      </List>
    </Stack>
  )
}
