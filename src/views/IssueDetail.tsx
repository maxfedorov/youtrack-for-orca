import {
  Button, Callout, Heading, IconButton, KeyValue, Markdown, RelativeTime, Row, Separator, Skeleton, Stack, Text, atom, read, set
} from 'orca'
import { links, loadLinks } from '../listState'
import { call, refreshTick, server, view } from '../state'
import { openInBrowser, openWorkspace, start } from './IssueRowActions'
import type { IssueComments, IssueDetail as Detail } from '../protocol'

type Status = 'idle' | 'loading' | 'ok' | 'error'

const detail = atom<Detail | null>(null)
const status = atom<Status>('idle')
const failure = atom('')
/** The loaded issue is too large to draw; its link is offered instead. */
const tooLarge = atom<string | null>(null)

/** Orca refuses a render above about 512 KiB and draws Markdown above 64 KiB as a placeholder. */
const MAX_DRAWN = 450_000
const MAX_MARKDOWN = 60 * 1024
const drawable = (issue: Detail) =>
  JSON.stringify(issue).length <= MAX_DRAWN &&
  issue.descriptionMd.length <= MAX_MARKDOWN &&
  issue.comments.every((comment) => comment.textMd.length <= MAX_MARKDOWN)
/** The server and issue (`alias|id`) the atoms above belong to; null when nothing is loaded. */
const loadedFor = atom<string | null>(null)

let seq = 0
let seenTick = 0
/** Comments are being loaded again after they failed. */
const commentsBusy = atom(false)

/** The comments merged into the loaded issue; the oldest are left out until it can be drawn. */
function withComments(issue: Detail, loaded: IssueComments): Detail {
  const { commentsError: _dropped, ...rest } = issue
  let comments = loaded.comments
  let omitted = loaded.commentsOmitted ?? 0
  let next: Detail = { ...rest, comments }
  while (!drawable(next) && comments.length > 0) {
    comments = comments.slice(1)
    omitted++
    next = { ...rest, comments }
  }
  if (omitted > 0) next.commentsOmitted = omitted
  else delete next.commentsOmitted
  if (loaded.truncated || omitted > 0) next.truncated = true
  return next
}

/** Loads only the comments of the shown issue again; the rest of the card stays as it is. */
async function reloadComments(id: string): Promise<void> {
  const current = read(server)
  if (!current || read(commentsBusy)) return
  const mine = seq
  set(commentsBusy, true)
  const answer = await call('yt.issue.comments', { server: current, id })
  set(commentsBusy, false)
  const issue = read(detail)
  if (mine !== seq || !issue || issue.id !== id) return
  set(detail, answer.ok ? withComments(issue, answer.data) : { ...issue, commentsError: answer.message })
}

async function load(id: string): Promise<void> {
  const current = read(server)
  if (!current) return
  const mine = ++seq
  seenTick = read(refreshTick)
  set(loadedFor, `${current}|${id}`)
  set(status, 'loading')
  const answer = await call('yt.issue.get', { server: current, id })
  if (mine !== seq) return
  if (answer.ok && !drawable(answer.data)) {
    set(tooLarge, answer.data.url)
    set(failure, 'This issue is too large to show here. Open it in the browser.')
    set(status, 'error')
  } else if (answer.ok) {
    set(detail, answer.data)
    set(failure, '')
    set(tooLarge, null)
    set(status, 'ok')
  } else {
    set(tooLarge, null)
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
  const refreshed = !stale
  queueMicrotask(() => {
    queued = null
    void load(id)
    if (refreshed) void loadLinks()
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
  return <IconButton icon="open-external" label="Open in browser" variant="ghost" onPress={() => void openInBrowser(url)} />
}

/** Comment keys, unique even when the CLI repeats or leaves out an id. */
function commentKeys(issue: Detail): string[] {
  const seen = new Set<string>()
  return issue.comments.map((comment, index) => {
    const key = comment.id && !seen.has(comment.id) ? comment.id : `${comment.id}#${index}`
    seen.add(key)
    return key
  })
}

function Body({ issue }: { issue: Detail }) {
  const workspaceId = read(links)[issue.id]
  const items = issue.fields.map((field) => ({ label: field.name, value: field.value }))
  const keys = commentKeys(issue)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center" justify="between">
        <Text weight="semibold">{issue.id}</Text>
        <Row gap="xs">
          <OpenInBrowser url={issue.url} />
          {workspaceId ? (
            <Button variant="solid" tone="accent" size="sm" onPress={() => void openWorkspace(workspaceId)}>
              Open →
            </Button>
          ) : (
            <Button variant="outline" size="sm" onPress={() => start(issue.id)}>
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
            <Button variant="outline" size="sm" onPress={() => void openInBrowser(issue.url)}>
              Open in browser
            </Button>
          </Stack>
        </Callout>
      ) : null}
      {items.length > 0 ? <KeyValue label="Fields" items={items} /> : null}
      {issue.descriptionMd ? <Markdown content={issue.descriptionMd} /> : <Text muted>No description</Text>}
      <Separator />
      <Heading level={3}>Comments</Heading>
      {issue.commentsError ? (
        <Stack gap="xs">
          <Text muted>{issue.commentsError}</Text>
          <Row gap="xs">
            <Button variant="ghost" size="sm" disabled={read(commentsBusy)} onPress={() => void reloadComments(issue.id)}>
              Retry
            </Button>
          </Row>
        </Stack>
      ) : issue.comments.length === 0 ? (
        <Text muted>No comments</Text>
      ) : (
        issue.comments.map((comment, index) => (
          <Stack key={keys[index]} gap="xs">
            <Row gap="xs" align="center">
              <Text weight="medium">{comment.author.fullName || comment.author.login || 'Unknown author'}</Text>
              {comment.created > 0 ? <RelativeTime at={comment.created} format="short" muted /> : null}
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
            {read(tooLarge) ? (
              <Button variant="outline" size="sm" onPress={() => void openInBrowser(read(tooLarge) ?? '')}>
                Open in browser
              </Button>
            ) : (
              <Button variant="ghost" onPress={() => void load(id)}>
                Retry
              </Button>
            )}
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
