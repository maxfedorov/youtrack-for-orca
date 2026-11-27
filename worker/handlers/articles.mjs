/** Requests about knowledge base articles: the tree of a project, searches, one article, its comments. */
import { ok } from '../result.mjs'
import { toArticleDetail, toArticleNodes } from '../mapping.mjs'
import { ARTICLE_ID, MAX_NEW_COMMENT, MAX_QUERY, capDetail, hasId, invalid, safeHandle, unexpected } from './common.mjs'
import { PROJECT } from './youtrack.mjs'

/** Articles read by one scan of a project at most; a larger project shows a note. */
const MAX_ARTICLE_SCAN = 5000
/** Articles in one answer of the tree, and results of one search. */
const MAX_ARTICLE_NODES = 500
const MAX_ARTICLE_RESULTS = 200

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

  /** Every article of a project matching `extra`, as tree nodes; `full`: the scan reached its cap. */
  async function scan(alias, project, extra) {
    const r = await ctx.youtrack.scanArticles(alias, `project: {${project}}${extra ? ` ${extra}` : ''}`)
    if (!r.ok) return r
    if (!Array.isArray(r.data)) return unexpected()
    return ok({ nodes: toArticleNodes(r.data.slice(0, MAX_ARTICLE_SCAN)), full: r.data.length >= MAX_ARTICLE_SCAN })
  }

  // YouTrack has no query for top-level articles, so the roots come from a scan of the whole project.
  handle('yt.articles.roots', async ({ server, project }) => {
    const bad = checkProject(project)
    if (bad) return invalid(bad)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await scan(s.data.alias, project, '')
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
    const text = [query.trim(), favorites === true ? 'has: star' : ''].filter(Boolean).join(' ')
    const r = await scan(s.data.alias, project, text)
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
