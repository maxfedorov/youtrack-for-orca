/** Requests about servers, issues and saved queries (everything answered by the YouTrack CLI). */
import { ok, fail, CODES } from '../result.mjs'
import { toIssueRow, toIssueDetail, toComments, toLinks, toSavedQuery, toSavedQueries, toServers } from '../mapping.mjs'
import { safeHandle, safePost, shortMessage, unexpected, hasId, invalid, ISSUE_ID, MAX_QUERY, MAX_NAME, MAX_COMMAND, MAX_NEW_COMMENT, isPlainUrl, normalizeUrl, settingString, capDetail, attempt, fallback, readSetting, INSTALL } from './common.mjs'

const MAX_LIMIT = 50
const MAX_WINDOW = 500
const COMMENTS_FAILED = 'Comments could not be loaded.'
const TOKEN_KEPT = 'The server was removed, but its sign-in token may still be stored in the system keyring:'
const NOT_FORGOTTEN = 'The server was removed, but the plugin could not forget all of its saved searches, links and projects.'
/** Table rows need unique keys; the first row of an id wins. */
const unique = (rows) => rows.filter((r, i) => rows.findIndex((o) => o.idReadable === r.idReadable) === i)

const LINKS_FAILED = 'Linked issues could not be loaded.'
/** Linked issues shown at most; a summary is cut to a line. */
const MAX_LINKED = 100
const MAX_LINKED_SUMMARY = 200

function capLinks(links) {
  let room = MAX_LINKED
  const out = []
  for (const link of links) {
    if (room <= 0) break
    const issues = link.issues.slice(0, room).map((i) => ({ ...i, summary: i.summary.slice(0, MAX_LINKED_SUMMARY) }))
    room -= issues.length
    out.push({ ...link, issues })
  }
  return out
}

export function registerYoutrackHandlers(ctx) {
  const { orca, orcaCli, state, links, launches, resolveServer } = ctx
  const handle = (name, fn) => safeHandle(orca, name, fn)

  handle('yt.env', async () => {
    const defaultQuery = settingString(await readSetting(orca, 'defaultQuery'), '')
    const base = { orcaCli: { found: orcaCli != null }, query: defaultQuery, defaultQuery }
    const installCommand = INSTALL[ctx.platform]
    const withInstall = (cli) => (installCommand ? { ...cli, installCommand } : cli)
    const notFound = () => ok({ cli: withInstall({ found: false }), servers: [], server: null, ...base })
    await ctx.refreshYoutrack()
    const youtrack = ctx.youtrack
    if (!youtrack) return notFound()
    // Version, server list and stored choices are separate parts: only the server list is required.
    const [version, inst] = await Promise.all([attempt(() => youtrack.version()), attempt(() => youtrack.instances())])
    if (!inst.ok) {
      if (inst.error.code === CODES.CLI_NOT_FOUND) {
        await ctx.refreshYoutrack()
        return notFound()
      }
      return ok({ ...base, cli: withInstall({ found: true }), servers: [], server: null, error: shortMessage(inst.error.message) })
    }
    const servers = toServers(inst.data)
    const stored = await fallback(() => state.getServer(), null)
    const chosen = servers.find((s) => s.alias === stored) ?? servers.find((s) => s.active) ?? servers[0]
    const cli = withInstall({ found: true })
    if (version.ok) cli.version = version.data
    const server = chosen ? chosen.alias : null
    return ok({ ...base, cli, servers, server, query: server ? await fallback(() => state.getQuery(server, defaultQuery), defaultQuery) : defaultQuery })
  })

  handle('yt.setServer', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setServer(s.data.alias)
    return ok({})
  })

  handle('yt.setQuery', async ({ server, query }) => {
    if (typeof query !== 'string' || query.length > MAX_QUERY) return invalid('Invalid query')
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setQuery(s.data.alias, query)
    return ok({})
  })

  handle('yt.issues.search', async ({ server, query, offset, limit }) => {
    if (typeof query !== 'string' || query.length > MAX_QUERY) return invalid('Invalid query')
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return invalid('Invalid paging')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const room = MAX_WINDOW - offset
    if (room <= 0) return ok({ issues: [], hasMore: false })
    const size = Math.min(limit, MAX_LIMIT, room)
    // The count is optional: without it the panel shows "N+ issues".
    const [list, count] = await Promise.all([
      ctx.youtrack.listIssues(s.data.alias, query, offset, Math.min(size + 1, room)),
      offset === 0 ? attempt(() => ctx.youtrack.countIssues(s.data.alias, query)) : Promise.resolve(null)
    ])
    if (!list.ok) return list
    if (!Array.isArray(list.data)) return unexpected()
    const data = {
      issues: unique(list.data.slice(0, size).filter(hasId)).map((r) => toIssueRow(r, s.data.url)),
      hasMore: list.data.length > size
    }
    if (count?.ok) data.total = count.data
    return ok(data)
  })

  handle('yt.issue.get', async ({ server, id }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const [view, comments, links] = await Promise.all([
      attempt(() => ctx.youtrack.viewIssue(s.data.alias, id)),
      attempt(() => ctx.youtrack.listComments(s.data.alias, id)),
      attempt(() => ctx.youtrack.listLinks(s.data.alias, id))
    ])
    if (!view.ok) return view
    if (!hasId(view.data)) return unexpected()
    // The issue is shown without its comments or links when only they fail; the panel can load comments again.
    const loaded = comments.ok && Array.isArray(comments.data)
    const issue = toIssueDetail(view.data, loaded ? comments.data : null, s.data.url)
    if (links.ok && Array.isArray(links.data)) issue.links = capLinks(toLinks(links.data))
    else issue.linksError = LINKS_FAILED
    const detail = capDetail(issue)
    return ok(loaded ? detail : { ...detail, commentsError: COMMENTS_FAILED })
  })

  handle('yt.issue.comments', async ({ server, id }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await attempt(() => ctx.youtrack.listComments(s.data.alias, id))
    if (!r.ok) return r
    if (!Array.isArray(r.data)) return unexpected()
    const capped = capDetail({ descriptionMd: '', comments: toComments(r.data) })
    const data = { comments: capped.comments }
    if (capped.commentsOmitted) data.commentsOmitted = capped.commentsOmitted
    if (capped.truncated) data.truncated = true
    return ok(data)
  })

  // Issue writes: run only when the person presses Apply or Send.
  handle('yt.issue.command', async ({ server, id, command }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const text = typeof command === 'string' ? command.trim() : ''
    if (!text) return invalid('Enter a command')
    if (text.length > MAX_COMMAND) return invalid(`A command is at most ${MAX_COMMAND} characters`)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.applyCommand(s.data.alias, id, text)
    return r.ok ? ok({}) : r
  })

  handle('yt.issue.comment', async ({ server, id, text }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return invalid('Enter a comment')
    if (body.length > MAX_NEW_COMMENT) return invalid(`A comment is at most ${MAX_NEW_COMMENT} characters`)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.addComment(s.data.alias, id, body)
    return r.ok ? ok({}) : r
  })

  handle('yt.savedQueries', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.savedSearches(s.data.alias)
    return r.ok ? ok(toSavedQueries(r.data)) : r
  })

  handle('yt.savedQueries.create', async ({ server, name, query }) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n || n.length > MAX_NAME) return invalid(`Name must be 1 to ${MAX_NAME} characters`)
    if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY) return invalid('Invalid query')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.createSavedSearch(s.data.alias, n, query)
    return r.ok ? ok(toSavedQuery(r.data) ?? { id: '', name: n, query }) : r
  })

  handle('yt.servers.add', async ({ url }) => {
    if (!isPlainUrl(url)) return invalid('Enter a server address like https://youtrack.example.com')
    if (!ctx.youtrack) return fail(CODES.CLI_NOT_FOUND, 'The YouTrack CLI was not found.')
    login(url)
      .catch((e) => fail(CODES.UNKNOWN, e instanceof Error ? e.message : String(e)))
      .then((result) => safePost(orca, 'yt.servers.added', result))
    return ok({ started: true })
  })

  // Signs the CLI out of the server: run only after the person confirmed it in the panel.
  handle('yt.servers.remove', async ({ server }) => {
    if (typeof server !== 'string' || !server) return invalid('Unknown server')
    if (!ctx.youtrack) return fail(CODES.CLI_NOT_FOUND, 'The YouTrack CLI was not found.')
    const inst = await ctx.youtrack.instances()
    if (!inst.ok) return inst
    const warnings = []
    // A server the CLI no longer lists was removed already (say, a removal that timed out after the
    // CLI finished): only what the plugin saved for it is left to forget.
    if (toServers(inst.data).some((s) => s.alias === server)) {
      const r = await ctx.youtrack.deleteInstance(server)
      if (!r.ok) return r
      if (typeof r.data?.warning === 'string' && r.data.warning) warnings.push(`${TOKEN_KEPT} ${r.data.warning}`)
    }
    // Each store is cleared on its own; a failure only warns.
    const cleared = await Promise.all(
      [() => state.forgetServer(server), () => links?.dropServer(server), () => launches?.dropServer(server)].map((fn) =>
        fallback(async () => (await fn(), true), false)
      )
    )
    if (!cleared.every(Boolean)) warnings.push(NOT_FORGOTTEN)
    return ok(warnings.length ? { warning: shortMessage(warnings.join(' ')) } : {})
  })

  /** Sign in through the browser, then find the alias the CLI gave the new server. */
  async function login(url) {
    const r = await ctx.youtrack.loginWeb(url, (authUrl) => safePost(orca, 'yt.servers.authUrl', { url: authUrl }))
    if (!r.ok) return r
    const inst = await ctx.youtrack.instances()
    if (!inst.ok) return inst
    const found = toServers(inst.data).find((i) => normalizeUrl(i.url) === normalizeUrl(url))
    return found ? ok({ alias: found.alias }) : fail(CODES.UNKNOWN, 'The server was added, but it is missing from the CLI list.')
  }
}
