import { Button, IconButton, Row, Stack, Text, set, shell } from 'orca'
import { call, panelError, view } from '../state'
import type { IssueRow } from '../protocol'

export const openDetail = (id: string) => set(view, { kind: 'detail', issueId: id })

export const start = (id: string) => set(view, { kind: 'start', issueId: id })

/** Opens a link in the browser; a failure is shown in the panel's error callout. */
export async function openInBrowser(url: string): Promise<void> {
  try {
    await shell.openExternal(url)
  } catch {
    set(panelError, 'Could not open the browser. Try again.')
  }
}

export async function openWorkspace(workspaceId: string): Promise<void> {
  const answer = await call('yt.workspace.open', { workspaceId })
  if (!answer.ok) set(panelError, answer.message)
}

/** Actions of the selected row (table cells cannot hold buttons). */
export function IssueRowActions({ issue, workspaceId }: { issue: IssueRow; workspaceId?: string }) {
  return (
    <Stack gap="xs">
      <Text weight="medium">{issue.id}</Text>
      <Row gap="xs" align="center" wrap>
        {workspaceId ? (
          <Button size="sm" onPress={() => void openWorkspace(workspaceId)}>
            Open →
          </Button>
        ) : (
          <Button size="sm" onPress={() => start(issue.id)}>
            Start →
          </Button>
        )}
        {workspaceId ? (
          <Button variant="outline" size="sm" onPress={() => start(issue.id)}>
            Start new workspace
          </Button>
        ) : null}
        <IconButton icon="file-text" label="Open issue details" variant="outline" onPress={() => openDetail(issue.id)} />
        <IconButton icon="open-external" label="Open in browser" variant="outline" onPress={() => void openInBrowser(issue.url)} />
      </Row>
    </Stack>
  )
}
