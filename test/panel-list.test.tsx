import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number, over: Record<string, unknown> = {}) => ({
  id: `DEMO-${n}`,
  summary: `Issue ${n}`,
  state: { name: 'Open' },
  priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' },
  created: 1_690_000_000_000 + n,
  updated: 1_700_000_000_000 + n,
  resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`,
  ...over
})
const env = (over: Record<string, unknown> = {}) =>
  ok({
    cli: { found: true },
    orcaCli: { found: true },
    servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
    server: 'main',
    query: 'for: me #Unresolved',
    defaultQuery: 'for: me #Unresolved',
    ...over
  })
const page = (from: number, count: number, hasMore: boolean, total?: number) =>
  ok({ issues: Array.from({ length: count }, (_, i) => issue(from + i)), hasMore, ...(total === undefined ? {} : { total }) })

function requests(over: Record<string, unknown> = {}) {
  return {
    'yt.env': env(),
    'yt.issues.search': page(1, 2, false, 2),
    'yt.savedQueries': ok([]),
    'yt.links': ok({}),
    'yt.setQuery': ok({}),
    'yt.setServer': ok({}),
    'yt.workspace.open': ok({}),
    ...over
  }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const table = { type: 'Table' }

test('enter runs search and saves query', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  assert.deepEqual(calls(host, 'yt.issues.search')[0].input, { server: 'main', query: 'for: me #Unresolved', offset: 0, limit: 50 })
  await view.type({ label: 'Query' }, 'project: DEMO', { replace: true, submit: true })
  const search = calls(host, 'yt.issues.search')
  assert.deepEqual(search.at(-1).input, { server: 'main', query: 'project: DEMO', offset: 0, limit: 50 })
  assert.deepEqual(calls(host, 'yt.setQuery').at(-1).input, { server: 'main', query: 'project: DEMO' })
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  assert.ok(view.find({ text: '2 issues' }))
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('count text is singular for one issue', async () => {
  const host = mockHost({ requests: requests({ 'yt.issues.search': page(1, 1, false, 1) }) })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: '1 issue' }))
  await view.unmount()
})

test('invalid query is not saved and disables star', async () => {
  const host = mockHost({ requests: requests({ 'yt.issues.search': fail('QUERY_INVALID', "HTTP 400: Can't parse search query") }) })
  const view = await mount(panel, { host })
  assert.equal(calls(host, 'yt.setQuery').length, 0)
  assert.ok(view.find({ type: 'EmptyState', label: 'Query error' }))
  assert.ok(view.find({ text: "HTTP 400: Can't parse search query" }))
  assert.equal(view.find({ role: 'button', text: 'Edit query' }), null)
  assert.ok(view.find({ role: 'button', text: 'Reset to default' }))
  assert.equal(view.find({ type: 'Input', label: 'Query' }).props.invalid, true)
  assert.equal(view.find({ role: 'button', label: 'Save search' }).props.disabled, true)
  assert.equal(view.find(table), null)
  await view.unmount()
})

test('saved star is disabled while the matching query has an error', async () => {
  const host = mockHost({
    requests: requests({
      'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'for: me #Unresolved' }]),
      'yt.issues.search': fail('QUERY_INVALID', "HTTP 400: Can't parse search query")
    })
  })
  const view = await mount(panel, { host })
  const star = view.find({ role: 'button', label: 'Saved as Mine' })
  assert.equal(star.props.disabled, true)
  assert.equal(star.props.variant, 'solid')
  await view.unmount()
})

test('zero results shows empty state with reset', async () => {
  const host = mockHost({
    requests: requests({ 'yt.env': env({ query: 'project: NOPE' }), 'yt.issues.search': (i: any) => (i.query === 'project: NOPE' ? ok({ issues: [], hasMore: false, total: 0 }) : page(1, 2, false, 2)) })
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'EmptyState', label: 'No issues match this query' }))
  assert.equal(view.find({ role: 'button', text: 'Edit query' }), null)
  assert.equal(calls(host, 'yt.setQuery').length, 1)
  await view.press({ role: 'button', text: 'Reset to default' })
  assert.equal(calls(host, 'yt.issues.search').at(-1).input.query, 'for: me #Unresolved')
  assert.equal(view.valueOf({ label: 'Query' }), 'for: me #Unresolved')
  assert.equal(view.find({ type: 'EmptyState', label: 'No issues match this query' }), null)
  await view.unmount()
})

test('reset is hidden when the query already is the default', async () => {
  const host = mockHost({ requests: requests({ 'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }) }) })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'EmptyState', label: 'No issues match this query' }))
  assert.equal(view.find({ role: 'button', text: 'Reset to default' }), null)
  await view.unmount()
})

test('error never looks like zero issues', async () => {
  let n = 0
  const host = mockHost({ requests: requests({ 'yt.issues.search': () => (n++ === 0 ? fail('NETWORK', 'no route to host') : page(1, 2, false, 2)) }) })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'Callout', tone: 'danger' }))
  assert.ok(view.find({ text: 'no route to host' }))
  assert.equal(view.find({ type: 'EmptyState' }), null)
  assert.equal(view.find({ text: '0 issues' }), null)
  assert.equal(calls(host, 'yt.setQuery').length, 0)
  await view.press({ role: 'button', text: 'Retry' })
  assert.equal(view.find({ type: 'Callout', tone: 'danger' }), null)
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  await view.unmount()
})

test('created column is sortable and shows the creation time', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  const col = view.find(table).props.columns.find((c: any) => c.key === 'created')
  assert.equal(col.label, 'Created')
  assert.equal(col.sortable, true)
  assert.deepEqual(view.find(table).props.rows[0].cells.created, { type: 'relative', at: 1_690_000_000_001, format: 'short' })
  await view.sort(view.find(table), 'created')
  assert.match(calls(host, 'yt.issues.search').at(-1).input.query, /sort by: created asc$/)
  await view.unmount()
})

test('header click rewrites query', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  await view.sort(view.find(table), 'updated')
  assert.match(view.valueOf({ label: 'Query' }), /sort by: updated asc$/)
  assert.match(calls(host, 'yt.issues.search').at(-1).input.query, /sort by: updated asc$/)
  await view.sort(view.find(table), 'updated')
  assert.match(view.valueOf({ label: 'Query' }), /sort by: updated desc$/)
  assert.deepEqual(view.find(table).props.sort, { column: 'updated', direction: 'desc' })
  await view.unmount()
})

test('saved search selection fills query', async () => {
  const host = mockHost({ requests: requests({ 'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'assignee: me' }]) }) })
  const view = await mount(panel, { host })
  await view.select({ label: 'Saved searches' }, 's1')
  assert.equal(view.valueOf({ label: 'Query' }), 'assignee: me')
  assert.equal(calls(host, 'yt.issues.search').at(-1).input.query, 'assignee: me')
  assert.deepEqual(calls(host, 'yt.setQuery').at(-1).input, { server: 'main', query: 'assignee: me' })
  await view.unmount()
})

test('star creates saved search', async () => {
  const host = mockHost({
    requests: requests({ 'yt.savedQueries.create': ok({ id: 's9', name: 'My list', query: 'for: me #Unresolved' }) })
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Save search' })
  assert.equal(view.valueOf({ label: 'Search name' }), 'for: me #Unresolved')
  await view.type({ label: 'Search name' }, 'My list', { replace: true })
  await view.press({ role: 'button', text: 'Save' })
  assert.deepEqual(calls(host, 'yt.savedQueries.create')[0].input, { server: 'main', name: 'My list', query: 'for: me #Unresolved' })
  assert.equal(view.valueOf({ label: 'Saved searches' }), 's9')
  assert.equal(view.find({ label: 'Search name' }), null)
  assert.equal(view.find({ role: 'button', label: 'Save search' }), null)
  await view.unmount()
})

test('save name defaults to the query cut to 60 characters and errors stay visible', async () => {
  const long = `project: DEMO ${'x'.repeat(100)}`
  const host = mockHost({
    requests: requests({ 'yt.env': env({ query: long }), 'yt.savedQueries.create': fail('UNKNOWN', 'Name is already in use') })
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Save search' })
  assert.equal(view.valueOf({ label: 'Search name' }).length, 60)
  await view.press({ role: 'button', text: 'Save' })
  assert.ok(view.find({ text: 'Name is already in use' }))
  assert.ok(view.find({ label: 'Search name' }))
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(view.find({ label: 'Search name' }), null)
  await view.unmount()
})

test('star filled for existing saved query', async () => {
  const host = mockHost({
    requests: requests({ 'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'for: me #Unresolved' }]) })
  })
  const view = await mount(panel, { host })
  const star = view.find({ role: 'button', label: 'Saved as Mine' })
  assert.ok(star)
  assert.ok(!star.props.disabled)
  assert.equal(star.props.variant, 'solid')
  assert.equal(star.props.tone, 'accent')
  assert.equal(view.find({ role: 'button', label: 'Save search' }), null)
  await view.press({ role: 'button', label: 'Saved as Mine' })
  assert.equal(host.callsOf('plugin.request').filter((c: any) => c.name === 'yt.savedQueries.create').length, 0)
  await view.unmount()
})

test('empty saved searches show the hint', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Save the current query with ☆' }))
  await view.unmount()
})

test('open shown for linked issue', async () => {
  const host = mockHost({ requests: requests({ 'yt.links': ok({ 'DEMO-1': 'ws-1' }) }) })
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  assert.equal(view.find({ role: 'button', text: 'Start →' }), null)
  await view.press({ role: 'button', text: 'Open →' })
  assert.deepEqual(calls(host, 'yt.workspace.open')[0].input, { workspaceId: 'ws-1' })
  await view.selectRows(view.find(table), ['DEMO-2'])
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  assert.equal(view.find({ role: 'button', text: 'Open →' }), null)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('start action opens the start view', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-2'])
  await view.press({ role: 'button', text: 'Start →' })
  assert.equal(view.find(table), null)
  await view.unmount()
})

test('row actions are one row: open in browser, and a new workspace only when linked', async () => {
  const host = mockHost({ requests: requests({ 'yt.links': ok({ 'DEMO-1': 'ws-1' }) }) })
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-2'])
  assert.equal(view.find({ role: 'button', label: 'More actions' }), null)
  assert.equal(view.find({ role: 'button', text: 'Start new workspace' }), null)
  const browser = view.find({ role: 'button', label: 'Open in browser' })
  assert.equal(browser.props.icon, 'open-external')
  await view.press({ role: 'button', label: 'Open in browser' })
  assert.deepEqual(host.callsOf('shell.openExternal').at(-1), { url: 'https://main.example.youtrack.cloud/issue/DEMO-2' })
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.equal(view.find({ role: 'button', label: 'More actions' }), null)
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  assert.ok(view.find({ role: 'button', label: 'Open in browser' }))
  await view.press({ role: 'button', text: 'Start new workspace' })
  assert.equal(view.find(table), null)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('row activation opens the detail view', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  assert.equal(view.find(table), null)
  await view.unmount()
})

test('load more stops at 500', async () => {
  const host = mockHost({
    requests: requests({ 'yt.issues.search': (i: any) => page(i.offset + 1, 50, true, i.offset === 0 ? 900 : undefined) })
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: '900 issues' }))
  for (let n = 0; n < 12; n++) if (view.find(table).props.hasMore) await view.loadMore(view.find(table))
  assert.equal(view.rowsOf(view.find(table)).length, 500)
  assert.equal(view.find(table).props.hasMore, false)
  assert.ok(view.find({ text: 'Showing the first 500 issues. Refine the query.' }))
  const offsets = calls(host, 'yt.issues.search').map((c: any) => c.input.offset)
  assert.deepEqual(offsets, [0, 50, 100, 150, 200, 250, 300, 350, 400, 450])
  await view.unmount()
})

test('refresh reruns the search and the links', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  const searches = calls(host, 'yt.issues.search').length
  const links = calls(host, 'yt.links').length
  await view.press({ role: 'button', label: 'Refresh' })
  assert.equal(calls(host, 'yt.issues.search').length, searches + 1)
  assert.equal(calls(host, 'yt.links').length, links + 1)
  await view.unmount()
})

test('agent finished refreshes links', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  const links = calls(host, 'yt.links').length
  await view.post('yt.agentFinished', { server: 'main', issueId: 'DEMO-1', workspaceId: 'ws-1' })
  assert.equal(calls(host, 'yt.links').length, links + 1)
  await view.unmount()
})

test('switching server reloads the query, saved searches and links', async () => {
  const two = [
    { alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' },
    { alias: 'other', url: 'https://other.example.youtrack.cloud', active: false, status: 'authenticated' }
  ]
  let switched = false
  const host = mockHost({
    requests: requests({
      'yt.env': () => env({ servers: two, server: switched ? 'other' : 'main', query: switched ? 'project: OTHER' : 'for: me' }),
      'yt.setServer': () => {
        switched = true
        return ok({})
      }
    })
  })
  const view = await mount(panel, { host })
  await view.select({ label: 'Server' }, 'other')
  assert.equal(view.valueOf({ label: 'Query' }), 'project: OTHER')
  assert.deepEqual(calls(host, 'yt.issues.search').at(-1).input, { server: 'other', query: 'project: OTHER', offset: 0, limit: 50 })
  assert.equal(calls(host, 'yt.savedQueries').at(-1).input.server, 'other')
  assert.equal(calls(host, 'yt.links').at(-1).input.server, 'other')
  await view.unmount()
})

test('save button uses the star icon in both states', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  assert.equal(view.find({ role: 'button', label: 'Save search' }).props.icon, 'star')
  assert.equal(view.find({ role: 'button', label: 'Save search' }).props.variant, 'outline')
  assert.ok(!view.find({ role: 'button', label: 'Save search' }).props.disabled)
  await view.unmount()
  const saved = mockHost({ requests: requests({ 'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'for: me #Unresolved' }]) }) })
  const second = await mount(panel, { host: saved })
  assert.equal(second.find({ role: 'button', label: 'Saved as Mine' }).props.icon, 'star')
  await second.unmount()
})

test('failed env after a server switch clears the old server and retries the switch', async () => {
  const two = [
    { alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' },
    { alias: 'other', url: 'https://other.example.youtrack.cloud', active: false, status: 'authenticated' }
  ]
  let phase = 0
  const host = mockHost({
    requests: requests({
      'yt.env': () => {
        if (phase === 0) return env({ servers: two })
        if (phase === 1) return fail('NETWORK', 'env down')
        return env({ servers: two, server: 'other', query: 'project: OTHER' })
      },
      'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'x' }]),
      'yt.links': ok({ 'DEMO-1': 'ws-1' })
    })
  })
  const view = await mount(panel, { host })
  assert.equal(view.rowsOf(view.find(table)).length, 2)
  phase = 1
  const searches = calls(host, 'yt.issues.search').length
  await view.select({ label: 'Server' }, 'other')
  assert.ok(view.find({ type: 'Callout', tone: 'danger' }))
  assert.ok(view.find({ text: 'env down' }))
  assert.equal(view.find(table), null)
  assert.equal(view.find({ role: 'option', text: 'Mine' }), null)
  assert.equal(calls(host, 'yt.issues.search').length, searches)
  assert.ok(view.find({ text: 'Save the current query with ☆' }))
  phase = 2
  await view.press({ role: 'button', text: 'Retry' })
  assert.equal(view.valueOf({ label: 'Query' }), 'project: OTHER')
  assert.deepEqual(calls(host, 'yt.issues.search').at(-1).input.server, 'other')
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  await view.unmount()
})

test('count without a total shows a plus while more pages exist', async () => {
  const host = mockHost({ requests: requests({ 'yt.issues.search': (i: any) => page(i.offset + 1, 50, i.offset < 100) }) })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: '50+ issues' }))
  await view.loadMore(view.find(table))
  assert.ok(view.find({ text: '100+ issues' }))
  await view.loadMore(view.find(table))
  assert.ok(view.find({ text: '150 issues' }))
  await view.unmount()
})

test('500 cap note appears from a full last page when the total is unknown, not for exactly 500', async () => {
  const unknown = mockHost({ requests: requests({ 'yt.issues.search': (i: any) => page(i.offset + 1, 50, true) }) })
  const view = await mount(panel, { host: unknown })
  for (let n = 0; n < 12; n++) if (view.find(table).props.hasMore) await view.loadMore(view.find(table))
  assert.ok(view.find({ text: '500+ issues' }) || view.find({ text: '500 issues' }))
  assert.ok(view.find({ text: 'Showing the first 500 issues. Refine the query.' }))
  await view.unmount()
  const exact = mockHost({ requests: requests({ 'yt.issues.search': (i: any) => page(i.offset + 1, 50, i.offset < 450, i.offset === 0 ? 500 : undefined) }) })
  const second = await mount(panel, { host: exact })
  for (let n = 0; n < 12; n++) if (second.find(table).props.hasMore) await second.loadMore(second.find(table))
  assert.equal(second.rowsOf(second.find(table)).length, 500)
  assert.equal(second.find({ text: 'Showing the first 500 issues. Refine the query.' }), null)
  await second.unmount()
})
