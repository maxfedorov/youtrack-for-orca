import { Callout, Progress, Stack, Text } from 'orca'
import type { IssueDetail } from '../protocol'

type Linked = { id: string; summary: string; resolved: boolean }

/** YouTrack's standard link names: an issue "depends on" its blockers and is "parent for" its subtasks. */
const BLOCKED_BY = 'depends on'
const PARENT_FOR = 'parent for'

const ofType = (issue: IssueDetail, type: string): Linked[] =>
  (issue.links ?? []).filter((link) => link.type.toLowerCase() === type).flatMap((link) => link.issues)

/** The unresolved issues this one waits for, and how many of its subtasks are done (null without subtasks). */
export function relations(issue: IssueDetail): { blockers: Linked[]; subtasks: { done: number; total: number } | null } {
  const blockers = ofType(issue, BLOCKED_BY).filter((linked) => !linked.resolved)
  const subtasks = ofType(issue, PARENT_FOR)
  return {
    blockers,
    subtasks: subtasks.length > 0 ? { done: subtasks.filter((linked) => linked.resolved).length, total: subtasks.length } : null
  }
}

/** What holds the issue up and how far its subtasks are; nothing when it has neither. */
export function IssueRelations({ issue }: { issue: IssueDetail }) {
  const { blockers, subtasks } = relations(issue)
  if (blockers.length === 0 && !subtasks) return null
  return (
    <Stack gap="xs">
      {blockers.length > 0 ? (
        <Callout tone="warning">
          <Text>{`Blocked by ${blockers.map((linked) => linked.id).join(', ')}`}</Text>
        </Callout>
      ) : null}
      {subtasks ? (
        <Stack gap="xs">
          <Text size="sm" muted>{`Subtasks ${subtasks.done}/${subtasks.total} done`}</Text>
          <Progress label="Subtasks done" labelHidden value={Math.round((subtasks.done / subtasks.total) * 100)} />
        </Stack>
      ) : null}
    </Stack>
  )
}
