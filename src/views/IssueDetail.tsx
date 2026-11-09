import {
  Button, Callout, Heading, IconButton, KeyValue, Markdown, RelativeTime, Row, Separator, Skeleton, Stack, Text, atom, read, set, shell
} from 'orca'
import { links } from '../listState'
import { call, refreshTick, server, view } from '../state'
import { openWorkspace, start } from './IssueRowActions'
import type { IssueDetail as Detail } from '../protocol'

type Status = 'idle' | 'loading' | 'ok' | 'error'

const detail = atom<Detail | null>(null)
const status = atom<Status>('idle')
const failure = atom('')
/** The server and issue (`alias|id`) the atoms above belong to; null when nothing is loaded. */
const loadedFor = atom<string | null>(null)

let seq = 0
let seenTick = 0

async function load(id: string): Promise<void> {
  const current = read(server)
  if (!current) return
  const mine = ++seq
  seenTick = read(refreshTick)
  set(loadedFor, `${current}|${id}`)
  set(status, 'loading')
  const answer = await call('yt.issue.get', { server: current, id })
  if (mine !== seq) return
  if (answer.ok) {
    set(detail, answer.data)
    set(failure, '')
    set(status, 'ok')
  } else {
    set(failure, answer.message)
    set(status, 'error')
  }
}

let queued: string | null = null

/** Called while rendering (state cannot change there, so loading is queued): loads when the issue changed, and reloads when the header's refresh was pressed. */
function sync(id: string): void {
  const tick = read(refreshTick)
  const stale = read(loadedFor) !== `${read(server)}|${id}`
  if (!stale && tick === seenTick) return
  if (queued === id) return
  queued = id
  queueMicrotask(() => {
    queued = null
    void load(id)
  })
}

/** Back to the list: rows, query and selection live in the list atoms and stay. */
function back(): void {
  seq++
  set(loadedFor, null)
  set(detail, null)
  set(view, { kind: 'list' })
}

const BackButton = () => (
  <Button variant="ghost" size="sm" onPress={back}>
    ← Back
  </Button>
)

function OpenInBrowser({ url }: { url: string }) {
  return <IconButton icon="open-external" label="Open in browser" variant="ghost" onPress={() => void shell.openExternal(url)} />
}

function Body({ issue }: { issue: Detail }) {
  const workspaceId = read(links)[issue.id]
  const items = [
    issue.state ? { label: 'State', value: issue.state.name } : null,
    issue.assignee ? { label: 'Assignee', value: issue.assignee.fullName || issue.assignee.login } : null,
    issue.priority ? { label: 'Priority', value: issue.priority.name } : null,
    issue.type ? { label: 'Type', value: issue.type.name } : null
  ].filter((item) => item !== null)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center" justify="between">
        <Text weight="semibold">{issue.id}</Text>
        <Row gap="xs">
          <OpenInBrowser url={issue.url} />
          {workspaceId ? (
            <Button size="sm" onPress={() => void openWorkspace(workspaceId)}>
              Open →
            </Button>
          ) : (
            <Button size="sm" onPress={() => start(issue.id)}>
              Start →
            </Button>
          )}
        </Row>
      </Row>
      <Heading level={2}>{issue.summary}</Heading>
      {issue.truncated || issue.commentsOmitted ? (
        <Callout tone="neutral">
          <Stack gap="xs">
            <Text>This issue is too long to show in full. Open it in the browser to see everything.</Text>
            <Button variant="outline" size="sm" onPress={() => void shell.openExternal(issue.url)}>
              Open in browser
            </Button>
          </Stack>
        </Callout>
      ) : null}
      {items.length > 0 ? <KeyValue label="Fields" items={items} /> : null}
      {issue.descriptionMd ? <Markdown content={issue.descriptionMd} /> : null}
      <Separator />
      <Heading level={3}>Comments</Heading>
      {issue.comments.length === 0 ? (
        <Text muted>No comments</Text>
      ) : (
        issue.comments.map((comment) => (
          <Stack key={comment.id} gap="xs">
            <Row gap="xs" align="center">
              <Text weight="medium">{comment.author.fullName || comment.author.login}</Text>
              <RelativeTime at={comment.created} format="short" muted />
            </Row>
            <Markdown content={comment.textMd} />
            {comment.truncated ? (
              <Text muted size="sm">
                This comment is cut short.
              </Text>
            ) : null}
          </Stack>
        ))
      )}
    </Stack>
  )
}

export function IssueDetail({ id }: { id: string }) {
  sync(id)
  const state = read(loadedFor) === `${read(server)}|${id}` ? read(status) : 'loading'
  const issue = read(detail)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <BackButton />
      </Row>
      {state === 'error' ? (
        <Callout tone="danger">
          <Stack gap="xs">
            <Text>{read(failure)}</Text>
            <Button variant="ghost" onPress={() => void load(id)}>
              Retry
            </Button>
          </Stack>
        </Callout>
      ) : state === 'ok' && issue && issue.id === id ? (
        <Body issue={issue} />
      ) : (
        <Skeleton shape="text" lines={6} label="Loading issue" />
      )}
    </Stack>
  )
}
