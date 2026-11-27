/** Requests about knowledge base articles: the tree of a project, searches, one article, its comments. */
import { ok, fail, CODES } from '../result.mjs'
import { articleLine } from '../prompt.mjs'
import { toArticleDetail, toArticleNodes } from '../mapping.mjs'
import { ARTICLE_ID, MAX_NEW_COMMENT, MAX_QUERY, capDetail, hasId, invalid, safeHandle, token, unexpected } from './common.mjs'
import { PROJECT } from './youtrack.mjs'

/** Articles read by one scan of a project at most; a larger project shows a note. */
const MAX_ARTICLE_SCAN = 5000
/** Articles in one answer of the tree, and results of one search. */
const MAX_ARTICLE_NODES = 500
const MAX_ARTICLE_RESULTS = 200
/** Agents listed for Send to agent, and the longest title or agent name shown. */
const MAX_AGENTS = 20
const MAX_AGENT_TEXT = 100
const GONE = 'That agent is no longer open in this workspace.'

const checkProject = (project) => (typeof project === 'string' && PROJECT.test(project) ? null : 'Invalid project')
const checkArticle = (id) => (typeof id === 'string' && ARTICLE_ID.test(id) ? null : 'Invalid article id')

/** At most `max` nodes, with `cut` when more were left out. */
function capped(nodes, max, cut = false) {
  const data = { articles: nodes.slice(0, max) }
  if (cut || nodes.length > max) data.cut = true
  return data
}

export function registerArticleHandlers(ctx) {
  const { orca, state, resolveServer } = ctx
  const handle = (name, fn) => safeHandle(orca, name, fn)

  /** Articles of a project matching every condition in `also`, as tree nodes; `full`: the project has more than the cap. */
  async function scan(alias, project, also = []) {
    const query = [`project: {${project}}`, ...also].join(' and ')
    const r = await ctx.youtrack.scanArticles(alias, query, MAX_ARTICLE_SCAN)
    if (!r.ok) return r
    if (!Array.isArray(r.data)) return unexpected()
    return ok({ nodes: toArticleNodes(r.data.slice(0, MAX_ARTICLE_SCAN)), full: r.data.length > MAX_ARTICLE_SCAN })
  }

  // YouTrack has no query for top-level articles, so the roots come from a scan of the whole project.
  handle('yt.articles.roots', async ({ server, project }) => {
    const bad = checkProject(project)
    if (bad) return invalid(bad)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await scan(s.data.alias, project)
    if (!r.ok) return r
    return ok(capped(r.data.nodes.filter((n) => !n.parent), MAX_ARTICLE_NODES, r.data.full))
  })

  handle('yt.articles.children', async ({ server, id }) => {
    const bad = checkArticle(id)
    if (bad) return invalid(bad)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.childArticles(s.data.alias, id)
    if (!r.ok) return r
    if (!Array.isArray(r.data)) return unexpected()
    return ok(capped(toArticleNodes(r.data), MAX_ARTICLE_NODES))
  })

  handle('yt.articles.search', async ({ server, project, query, favorites }) => {
    const bad = checkProject(project)
    if (bad) return invalid(bad)
    if (typeof query !== 'string' || query.length > MAX_QUERY) return invalid('Invalid query')
    const s = await resolveServer(server)
    if (!s.ok) return s
    // The person's query is grouped, so an "or" in it cannot reach past the project.
    const also = [query.trim() ? `(${query.trim()})` : '', favorites === true ? 'has: star' : ''].filter(Boolean)
    const r = await scan(s.data.alias, project, also)
    if (!r.ok) return r
    return ok(capped(r.data.nodes, MAX_ARTICLE_RESULTS, r.data.full))
  })

  handle('yt.article.get', async ({ server, id }) => {
    const bad = checkArticle(id)
    if (bad) return invalid(bad)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.viewArticle(s.data.alias, id)
    if (!r.ok) return r
    if (!hasId(r.data)) return unexpected()
    // The content is cut like an issue description, so the card can be drawn.
    const { contentMd, ...rest } = toArticleDetail(r.data, s.data.url)
    const { descriptionMd, ...article } = capDetail({ ...rest, descriptionMd: contentMd })
    return ok({ ...article, contentMd: descriptionMd })
  })

  // An article write: runs only when Send is pressed.
  handle('yt.article.comment', async ({ server, id, text }) => {
    const bad = checkArticle(id)
    if (bad) return invalid(bad)
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return invalid('Enter a comment')
    if (body.length > MAX_NEW_COMMENT) return invalid(`A comment is at most ${MAX_NEW_COMMENT} characters`)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.addArticleComment(s.data.alias, id, body)
    return r.ok ? ok({}) : r
  })

  const host = (method, params) => orca.host.call(method, params)
  /** The agents of the focused workspace that Orca ties to a terminal. */
  async function agents() {
    const r = await host('agents.list', {})
    const list = Array.isArray(r?.agents) ? r.agents : []
    const clip = (v) => (typeof v === 'string' ? v.slice(0, MAX_AGENT_TEXT) : '')
    return list
      .filter((a) => a && typeof a.terminalId === 'string' && a.terminalId)
      .slice(0, MAX_AGENTS)
      .map((a) => ({ terminalId: a.terminalId, title: clip(a.title), agent: clip(a.agent) }))
  }

  handle('yt.agents', async () => ok({ agents: await agents() }))

  // Types one line into an agent's terminal, without Enter: runs only when Send to agent is pressed.
  handle('yt.article.send', async ({ server, id, terminalId }) => {
    const bad = checkArticle(id) ?? token(terminalId, 'agent')
    if (bad) return invalid(bad)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const text = articleLine({ server: s.data.alias, id })
    if (!text) return invalid('This server cannot be named in a command.')
    // The terminal must still belong to an agent of this workspace: the panel's list may be stale.
    if (!(await agents()).some((a) => a.terminalId === terminalId)) return fail(CODES.NOT_FOUND, GONE)
    const r = await host('terminal.sendText', { terminalId, text, enter: false })
    return ok({ accepted: r?.accepted === true })
  })

  handle('yt.articles.project', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const project = await state.articleProject(s.data.alias)
    return ok({ project: typeof project === 'string' && PROJECT.test(project) ? project : null })
  })

  handle('yt.articles.setProject', async ({ server, project }) => {
    const bad = checkProject(project)
    if (bad) return invalid(bad)
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setArticleProject(s.data.alias, project)
    return ok({})
  })
}
