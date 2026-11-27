import { Button, Callout, Heading, IconButton, Link, List, ListItem, Markdown, Row, Select, Separator, Skeleton, Stack, Text, atom, read, set } from 'orca'
import { openArticle } from '../articleState'
import { call, goBack, refreshTick, section, server, view } from '../state'
import { openInBrowser, openLinked } from './IssueRowActions'
import { CommentBox } from './CommentBox'
import { when } from './IssueDetail'
import type { Agent, ArticleDetail as Detail } from '../protocol'

type Status = 'idle' | 'loading' | 'ok' | 'error'

const detail = atom<Detail | null>(null)
const status = atom<Status>('idle')
const failure = atom('')
/** The loaded article is too large to draw; its link is offered instead. */
const tooLarge = atom<string | null>(null)
/** The server and article (`alias|id`) the atoms above belong to; null when nothing is loaded. */
const loadedFor = atom<string | null>(null)

/** Orca refuses a render above about 512 KiB and draws Markdown above 64 KiB as a placeholder. */
const MAX_DRAWN = 450_000
const MAX_MARKDOWN = 60 * 1024
const drawable = (article: Detail) =>
  JSON.stringify(article).length <= MAX_DRAWN &&
  article.contentMd.length <= MAX_MARKDOWN &&
  article.comments.every((comment) => comment.textMd.length <= MAX_MARKDOWN)

/** Agents of the focused workspace for Send to agent, the chosen one, and what the last send did. */
const agents = atom<Agent[]>([])
const agentsError = atom('')
const agentChoice = atom<string | null>(null)
const sending = atom(false)
const sendNote = atom('')
const sendError = atom('')

/** Reads the agents of the focused workspace again (the article opened, or the workspace changed). */
export async function loadAgents(): Promise<void> {
  const answer = await call('yt.agents', {})
  if (answer.ok) {
    set(agents, answer.data.agents)
    set(agentsError, '')
    if (!answer.data.agents.some((a) => a.terminalId === read(agentChoice))) set(agentChoice, answer.data.agents[0]?.terminalId ?? null)
  } else {
    set(agents, [])
    set(agentChoice, null)
    set(agentsError, answer.message)
  }
}

const agentName = (a: Agent) => a.title || a.agent || 'the agent'

async function sendToAgent(id: string): Promise<void> {
  const alias = read(server)
  const terminalId = read(agentChoice)
  const agent = read(agents).find((a) => a.terminalId === terminalId)
  if (!alias || !agent || read(sending)) return
  set(sending, true)
  set(sendNote, '')
  set(sendError, '')
  const answer = await call('yt.article.send', { server: alias, id, terminalId: agent.terminalId })
  set(sending, false)
  if (answer.ok && answer.data.accepted) set(sendNote, `Sent to ${agentName(agent)}. Press Enter there to send it.`)
  else if (answer.ok) set(sendError, `${agentName(agent)} did not take the text.`)
  else {
    set(sendError, answer.message)
    if (answer.code === 'NOT_FOUND') void loadAgents()
  }
}

let seq = 0
let seenTick = 0
let queued: string | null = null

async function load(id: string): Promise<void> {
  const current = read(server)
  if (!current) return
  const mine = ++seq
  seenTick = read(refreshTick)
  set(loadedFor, `${current}|${id}`)
  set(status, 'loading')
  set(sendNote, '')
  set(sendError, '')
  void loadAgents()
  const answer = await call('yt.article.get', { server: current, id })
  if (mine !== seq) return
  if (answer.ok && !drawable(answer.data)) {
    set(tooLarge, answer.data.url)
    set(failure, 'This article is too large to show here. Open it in the browser.')
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

/** Called while rendering: loads when the article or server changed, and when refresh was pressed. */
function sync(id: string): void {
  const stale = read(loadedFor) !== `${read(server)}|${id}`
  if ((!stale && read(refreshTick) === seenTick) || queued === id) return
  queued = id
  queueMicrotask(() => {
    queued = null
    void load(id)
  })
}

/** Back to the screen the article was opened from; `toList` goes straight to the article list. */
function back(toList = false): void {
  seq++
  set(loadedFor, null)
  set(detail, null)
  if (toList) {
    set(section, 'articles')
    set(view, { kind: 'list' })
  } else goBack()
}

function Comments({ article }: { article: Detail }) {
  const seen = new Set<string>()
  return (
    <Stack gap="sm">
      <Separator />
      <Heading level={3}>Comments</Heading>
      {article.comments.length === 0 ? (
        <Text muted>No comments</Text>
      ) : (
        article.comments.map((comment, index) => {
          const key = comment.id && !seen.has(comment.id) ? comment.id : `${comment.id}#${index}`
          seen.add(key)
          return (
            <Stack key={key} gap="xs">
              <Row gap="xs" align="center">
                <Text weight="medium">{comment.author.fullName || comment.author.login || 'Unknown author'}</Text>
                {comment.created > 0 ? (
                  <Text muted size="sm">
                    {when(comment.created)}
                  </Text>
                ) : null}
              </Row>
              <Markdown content={comment.textMd} />
              {comment.truncated ? (
                <Text muted size="sm">
                  This comment is cut short.
                </Text>
              ) : null}
            </Stack>
          )
        })
      )}
      <CommentBox id={article.id} request="yt.article.comment" onPosted={load} />
    </Stack>
  )
}

/** A titled list of articles or issues, left out when empty. */
function Section({ title, children }: { title: string; children: unknown[] }) {
  if (children.length === 0) return null
  return (
    <Stack gap="xs">
      <Separator />
      <Heading level={3}>{title}</Heading>
      <List label={title}>{children}</List>
    </Stack>
  )
}

/** Send to agent: asks an agent of this workspace to read the article with the YouTrack CLI. */
function SendToAgent({ id }: { id: string }) {
  const list = read(agents)
  const none = list.length === 0
  return (
    <Stack gap="xs">
      <Row gap="xs" align="end" wrap>
        {list.length > 1 ? (
          <Select
            label="Agent"
            value={read(agentChoice) ?? undefined}
            options={list.map((a) => ({ value: a.terminalId, label: agentName(a) }))}
            onChange={(value) => set(agentChoice, value)}
          />
        ) : null}
        <Button variant="outline" size="sm" icon="agent" disabled={none || read(sending)} onPress={() => void sendToAgent(id)}>
          Send to agent
        </Button>
      </Row>
      {none ? (
        <Text muted size="sm">
          {read(agentsError) || 'No agent is open in this workspace.'}
        </Text>
      ) : read(sendError) ? (
        <Text tone="danger" size="sm">
          {read(sendError)}
        </Text>
      ) : read(sendNote) ? (
        <Text muted size="sm">
          {read(sendNote)}
        </Text>
      ) : list.length === 1 ? (
        <Text muted size="sm">
          {`Asks ${agentName(list[0])} to read this article with the YouTrack CLI.`}
        </Text>
      ) : null}
    </Stack>
  )
}

function Body({ article }: { article: Detail }) {
  const changed = [article.updatedBy ? `Updated by ${article.updatedBy.fullName || article.updatedBy.login}` : 'Updated', article.updated > 0 ? when(article.updated) : '']
  return (
    <Stack gap="sm">
      {article.path.length > 0 ? (
        <Row gap="xs" align="center" wrap>
          {article.path.flatMap((parent, index) => [
            index > 0 ? (
              <Text key={`sep${index}`} muted size="sm">
                ›
              </Text>
            ) : null,
            <Link key={parent.id} onPress={() => openArticle(parent.id)}>
              {parent.summary || parent.id}
            </Link>
          ])}
        </Row>
      ) : null}
      <Row gap="xs" align="center" justify="between">
        <Text weight="semibold">{article.id}</Text>
        <IconButton icon="open-external" label="Open in browser" variant="ghost" onPress={() => void openInBrowser(article.url)} />
      </Row>
      <Heading level={1}>{article.summary}</Heading>
      {article.updated > 0 || article.updatedBy ? (
        <Text muted size="sm">
          {changed.filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {article.truncated || article.commentsOmitted ? (
        <Callout tone="neutral">
          <Stack gap="xs">
            <Text>This article is too long to show in full. Open it in the browser to see everything.</Text>
            <Row gap="xs">
              <Button variant="outline" size="sm" onPress={() => void openInBrowser(article.url)}>
                Open in browser
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
      <SendToAgent id={article.id} />
      {article.contentMd ? <Markdown content={article.contentMd} /> : <Text muted>No content</Text>}
      <Section title="Sub-articles">
        {article.children.map((child) => (
          <ListItem key={`child:${child.id}`} title={child.summary || child.id} description={child.id} onPress={() => openArticle(child.id)} />
        ))}
      </Section>
      <Section title="Mentioned articles">
        {article.mentionedArticles.map((other) => (
          <ListItem key={`article:${other.id}`} title={other.summary || other.id} description={other.id} onPress={() => openArticle(other.id)} />
        ))}
      </Section>
      <Section title="Mentioned issues">
        {article.mentionedIssues.map((issue) => (
          <ListItem
            key={`issue:${issue.id}`}
            title={`${issue.id} ${issue.summary}`}
            description={issue.resolved ? 'Resolved' : undefined}
            onPress={() => openLinked(issue.id)}
          />
        ))}
      </Section>
      {article.attachments.length > 0 ? (
        <Stack gap="xs">
          <Separator />
          <Heading level={3}>Attachments</Heading>
          {article.attachments.map((name, index) => (
            <Text key={`${name}#${index}`} muted size="sm">
              {name}
            </Text>
          ))}
        </Stack>
      ) : null}
      <Comments article={article} />
    </Stack>
  )
}

export function ArticleDetail({ id }: { id: string }) {
  sync(id)
  const state = read(loadedFor) === `${read(server)}|${id}` ? read(status) : 'loading'
  const article = read(detail)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Button variant="ghost" size="sm" onPress={() => back()}>
          ← Back
        </Button>
        {read(view).back && read(view).back?.kind !== 'list' ? (
          <Button variant="ghost" size="sm" onPress={() => back(true)}>
            Article list
          </Button>
        ) : null}
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
      ) : state === 'ok' && article && article.id === id ? (
        <Body article={article} />
      ) : (
        <Skeleton shape="text" lines={6} label="Loading article" />
      )}
    </Stack>
  )
}
