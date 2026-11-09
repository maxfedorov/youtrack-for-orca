import { Button, IconButton, Row, Stack, Text, atom, read, set, shell } from 'orca'
import { call, panelError, view } from '../state'
import type { IssueRow } from '../protocol'

/** Issue whose ⋯ row is open. The catalog has no menu component, so ⋯ toggles an inline row of actions. */
const menuFor = atom<string | null>(null)

const start = (id: string) => set(view, { kind: 'start', issueId: id })

async function openWorkspace(workspaceId: string): Promise<void> {
  const answer = await call('yt.workspace.open', { workspaceId })
  if (!answer.ok) set(panelError, answer.message)
}

/** Actions of the selected row (table cells cannot hold buttons). */
export function IssueRowActions({ issue, workspaceId }: { issue: IssueRow; workspaceId?: string }) {
  const open = read(menuFor) === issue.id
  return (
    <Stack gap="xs">
      <Row gap="xs" align="center" justify="between">
        <Text weight="medium">{issue.id}</Text>
        <Row gap="xs">
          {workspaceId ? (
            <Button size="sm" onPress={() => void openWorkspace(workspaceId)}>
              Open →
            </Button>
          ) : (
            <Button size="sm" onPress={() => start(issue.id)}>
              Start →
            </Button>
          )}
          <IconButton icon="more" label="More actions" variant="ghost" onPress={() => set(menuFor, open ? null : issue.id)} />
        </Row>
      </Row>
      {open ? (
        <Row gap="xs" wrap>
          <Button variant="outline" size="sm" onPress={() => void shell.openExternal(issue.url)}>
            Open in browser
          </Button>
          {workspaceId ? (
            <Button variant="outline" size="sm" onPress={() => start(issue.id)}>
              Start new workspace
            </Button>
          ) : null}
        </Row>
      ) : null}
    </Stack>
  )
}
