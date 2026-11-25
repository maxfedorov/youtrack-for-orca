import { Box, IconButton, Row, Stack, Text, atom, read, set } from 'orca'
import { call, server } from '../state'
import { refreshIssue } from './CommandBar'
import type { IssueDetail } from '../protocol'

/** A tag being removed, or the last removal that failed, on which issue (`server|id`); null when none. */
const removing = atom<{ key: string; tag: string; busy: boolean; error: string } | null>(null)

async function remove(issue: IssueDetail, tag: string): Promise<void> {
  const alias = read(server)
  const key = `${alias ?? ''}|${issue.id}`
  if (!alias || read(removing)?.busy) return
  set(removing, { key, tag, busy: true, error: '' })
  const answer = await call('yt.issue.removeTag', { server: alias, id: issue.id, tag })
  if (read(removing)?.key !== key) return
  if (!answer.ok) {
    set(removing, { key, tag, busy: false, error: answer.code === 'FORBIDDEN' ? 'You cannot remove tags from this issue.' : answer.message })
    return
  }
  set(removing, null)
  await refreshIssue(alias, issue.id)
}

/**
 * The issue's tags, each a small chip with a cross that removes it. A Badge holds only text, so the chip
 * is a framed row of the name and Orca's smallest icon button, with no padding of the chip's own: the
 * button's square already leaves room around its cross.
 */
export function IssueTags({ issue }: { issue: IssueDetail }) {
  const r = read(removing)
  const mine = r?.key === `${read(server) ?? ''}|${issue.id}` ? r : null
  if (issue.tags.length === 0) return null
  return (
    <Stack gap="xs">
      <Row gap="xs" wrap>
        {issue.tags.map((tag, index) => (
          <Box key={`${tag}#${index}`} direction="row" align="center" border radius="sm" background="muted">
            <Box paddingX="xs">
              <Text key={`tag:${tag}`} size="xs">
                {tag}
              </Text>
            </Box>
            <IconButton icon="close" label={`Remove tag ${tag}`} variant="ghost" size="xs" disabled={mine?.busy} onPress={() => void remove(issue, tag)} />
          </Box>
        ))}
      </Row>
      {mine?.error ? (
        <Text tone="danger" size="sm">
          {mine.error}
        </Text>
      ) : null}
    </Stack>
  )
}
