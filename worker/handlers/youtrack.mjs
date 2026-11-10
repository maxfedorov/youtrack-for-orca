/** Requests about servers, issues and saved queries (everything answered by the youtrack CLI). */
import { ok, fail, CODES } from '../result.mjs'
import { toIssueRow, toIssueDetail, toComments, toSavedQuery, toSavedQueries, toServers } from '../mapping.mjs'
import { safeHandle, safePost, shortMessage, unexpected, hasId, invalid, ISSUE_ID, MAX_QUERY, MAX_NAME, MAX_COMMAND, isPlainUrl, normalizeUrl, settingString, capDetail, attempt, fallback, readSetting, INSTALL } from './common.mjs'

const MAX_LIMIT = 50
const MAX_WINDOW = 500
const COMMENTS_FAILED = 'Comments could not be loaded.'
const NOT_FORGOTTEN = 'The server was removed, but the plugin could not forget all of its saved searches, links and projects.'
/** Table rows need unique keys; the first row of an id wins. */
const unique = (rows) => rows.filter((r, i) => rows.findIndex((o) => o.idReadable === r.idReadable) === i)

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
    const [view, comments] = await Promise.all([
      attempt(() => ctx.youtrack.viewIssue(s.data.alias, id)),
      attempt(() => ctx.youtrack.listComments(s.data.alias, id))
    ])
    if (!view.ok) return view
    if (!hasId(view.data)) return unexpected()
    // The issue is shown without its comments when only they fail; the panel can load them again.
    const loaded = comments.ok && Array.isArray(comments.data)
    const detail = capDetail(toIssueDetail(view.data, loaded ? comments.data : null, s.data.url))
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

  // The one issue write: run only when the person presses Apply.
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
    if (!isPlainUrl(url)) return invalid('Enter a server address like https://example.youtrack.cloud')
    if (!ctx.youtrack) return fail(CODES.CLI_NOT_FOUND, 'The youtrack CLI was not found.')
    login(url)
      .catch((e) => fail(CODES.UNKNOWN, e instanceof Error ? e.message : String(e)))
      .then((result) => safePost(orca, 'yt.servers.added', result))
    return ok({ started: true })
  })

  // Signs the CLI out of the server: run only after the person confirmed it in the panel.
  handle('yt.servers.remove', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const alias = s.data.alias
    const r = await ctx.youtrack.deleteInstance(alias)
    if (!r.ok) return r
    // The server is gone either way; each store is cleared on its own, a failure only warns.
    const cleared = await Promise.all(
      [() => state.forgetServer(alias), () => links?.dropServer(alias), () => launches?.dropServer(alias)].map((fn) =>
        fallback(async () => (await fn(), true), false)
      )
    )
    return ok(cleared.every(Boolean) ? {} : { warning: NOT_FORGOTTEN })
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
