/** Requests about servers, issues and saved queries (everything answered by the youtrack CLI). */
import { ok, fail, CODES } from '../result.mjs'
import { toIssueRow, toIssueDetail, toSavedQuery, toServer } from '../mapping.mjs'
import { guard, invalid, ISSUE_ID, MAX_QUERY, MAX_NAME, isPlainUrl, normalizeUrl, settingString, capDetail, INSTALL } from './common.mjs'

const MAX_LIMIT = 50
const MAX_WINDOW = 500

export function registerYoutrackHandlers(ctx) {
  const { orca, youtrack, orcaCli, state, resolveServer } = ctx
  const handle = (name, fn) => orca.panels.handle(name, guard(fn))

  handle('yt.env', async () => {
    const defaultQuery = settingString(await orca.settings.get('defaultQuery'), '')
    const base = { orcaCli: { found: orcaCli != null }, query: defaultQuery }
    const installCommand = INSTALL[ctx.platform]
    const withInstall = (cli) => (installCommand ? { ...cli, installCommand } : cli)
    if (!youtrack) return ok({ cli: withInstall({ found: false }), servers: [], server: null, ...base })
    const [version, inst] = await Promise.all([youtrack.version(), youtrack.instances()])
    if (!inst.ok) return inst
    const servers = inst.data.map(toServer)
    const stored = await state.getServer()
    const chosen = servers.find((s) => s.alias === stored) ?? servers.find((s) => s.active) ?? servers[0]
    const cli = withInstall({ found: true })
    if (version.ok) cli.version = version.data
    const server = chosen ? chosen.alias : null
    return ok({ ...base, cli, servers, server, query: server ? await state.getQuery(server, defaultQuery) : defaultQuery })
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
    const [list, count] = await Promise.all([
      youtrack.listIssues(s.data.alias, query, offset, Math.min(size + 1, room)),
      offset === 0 ? youtrack.countIssues(s.data.alias, query) : Promise.resolve(null)
    ])
    if (!list.ok) return list
    const data = {
      issues: list.data.slice(0, size).map((r) => toIssueRow(r, s.data.url)),
      hasMore: list.data.length > size
    }
    if (count?.ok) data.total = count.data
    return ok(data)
  })

  handle('yt.issue.get', async ({ server, id }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const [view, comments] = await Promise.all([youtrack.viewIssue(s.data.alias, id), youtrack.listComments(s.data.alias, id)])
    if (!view.ok) return view
    return ok(capDetail(toIssueDetail(view.data, comments.ok ? comments.data : null, s.data.url)))
  })

  handle('yt.savedQueries', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await youtrack.savedSearches(s.data.alias)
    return r.ok ? ok(r.data.map(toSavedQuery)) : r
  })

  handle('yt.savedQueries.create', async ({ server, name, query }) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n || n.length > MAX_NAME) return invalid(`Name must be 1 to ${MAX_NAME} characters`)
    if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY) return invalid('Invalid query')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await youtrack.createSavedSearch(s.data.alias, n, query)
    return r.ok ? ok(toSavedQuery(r.data)) : r
  })

  handle('yt.servers.add', async ({ url }) => {
    if (!isPlainUrl(url)) return invalid('Enter a server address like https://example.youtrack.cloud')
    if (!youtrack) return fail(CODES.CLI_NOT_FOUND, 'The youtrack CLI was not found.')
    login(url)
      .catch((e) => fail(CODES.UNKNOWN, e instanceof Error ? e.message : String(e)))
      .then((result) => orca.panels.post('yt.servers.added', result))
      .catch(() => {})
    return ok({ started: true })
  })

  /** Sign in through the browser, then find the alias the CLI gave the new server. */
  async function login(url) {
    const r = await youtrack.loginWeb(url, (authUrl) => orca.panels.post('yt.servers.authUrl', { url: authUrl }))
    if (!r.ok) return r
    const inst = await youtrack.instances()
    if (!inst.ok) return inst
    const found = inst.data.find((i) => normalizeUrl(i.url) === normalizeUrl(url))
    return found ? ok({ alias: found.alias }) : fail(CODES.UNKNOWN, 'The server was added, but it is missing from the CLI list.')
  }
}
