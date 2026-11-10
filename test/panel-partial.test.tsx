import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, state: { name: 'Open' }, priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' }, created: 1_690_000_000_000 + n, updated: 1_700_000_000_000 + n, resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`
})
const COMMENT = { id: 'c1', author: { login: 'bob', fullName: 'Bob Roe' }, created: 1_700_000_100_000, textMd: 'First comment' }
const detail = (n: number, over: Record<string, unknown> = {}) => ({
  ...issue(n),
  project: { shortName: 'DEMO', name: 'Demo' },
  fields: [{ name: 'State', value: 'Open' }, { name: 'Estimation', value: '2h' }],
  descriptionMd: `Description of issue ${n}`,
  comments: [COMMENT],
  ...over
})
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
  server: 'main', query: 'for: me', defaultQuery: 'for: me'
})
const prepare = (over: Record<string, unknown> = {}) => ({
  repos: [{ id: 'r1', name: 'alpha' }], orcaCli: true, defaultRepoId: 'r1', name: 'demo-1', agents: { installed: ['claude'], other: ['codex'] },
  defaultAgent: 'claude', launchMode: 'worktree', includeDescription: false, promptTemplate: 'Do {{id}}', vars: { id: 'DEMO-1' },
  workspaces: [{ id: 'w1', name: 'main' }], defaultWorkspaceId: 'w1', ...over
})
function requests(over: Record<string, unknown> = {}) {
  return {
    'yt.env': env,
    'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: false, total: 2 }),
    'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'for: me' }]),
    'yt.links': ok({}),
    'yt.setQuery': ok({}),
    'yt.issue.get': ok(detail(1)),
    'yt.issue.comments': ok({ comments: [COMMENT] }),
    'yt.start.prepare': ok(prepare()),
    'yt.refs.search': ok({ refs: ['main'] }),
    'yt.start.run': ok({ workspaceId: 'w9' }),
    'yt.runInExisting': ok({}),
    ...over
  }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const table = { type: 'Table' }
const danger = (view: any) => view.findAll({ type: 'Callout' }).filter((c: any) => c.props.tone === 'danger')
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
}
const openIssue = async (host: any, id = 'DEMO-1') => {
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), id)
  return view
}

test('an issue whose comments failed shows the issue, a comments note and a Retry for the comments only', async () => {
  let n = 0
  const host = mockHost({
    requests: requests({
      'yt.issue.get': ok(detail(1, { comments: [], commentsError: 'Comments could not be loaded.' })),
      'yt.issue.comments': () => (n++ === 0 ? fail('NETWORK', 'Cannot reach the server') : ok({ comments: [COMMENT] }))
    })
  })
  const view = await openIssue(host)
  clean(view)
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.equal(view.find({ type: 'Markdown' }).props.content, 'Description of issue 1')
  assert.ok(view.find({ type: 'KeyValue' }))
  assert.equal(danger(view).length, 0)
  assert.ok(view.find({ text: 'Comments could not be loaded.' }))
  assert.equal(view.find({ text: 'No comments' }), null)
  await view.press({ role: 'button', text: 'Retry' })
  assert.deepEqual(calls(host, 'yt.issue.comments')[0].input, { server: 'main', id: 'DEMO-1' })
  assert.equal(calls(host, 'yt.issue.get').length, 1)
  assert.ok(view.find({ text: 'Cannot reach the server' }))
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  assert.equal(view.find({ text: 'Comments could not be loaded.' }), null)
  assert.equal(calls(host, 'yt.issue.get').length, 1)
  clean(view)
  await view.unmount()
})

test('a field of an unexpected shape is n/a and the rest of the issue is shown', async () => {
  const fields = [{ name: 'State', value: 'Open' }, { name: 'Odd', value: { x: 1 } }, { value: 'no name' }, null, { name: 'Estimation', value: '2h' }]
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok(detail(1, { fields })) }) })
  const view = await openIssue(host)
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual(view.find({ type: 'KeyValue' }).props.items.map((i: any) => [i.label, i.value]), [
    ['State', 'Open'], ['Odd', 'n/a'], ['Estimation', '2h']
  ])
  assert.ok(view.find({ type: 'Markdown', content: 'Description of issue 1' }))
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  await view.unmount()
})

test('fields, description or comments of an unexpected shape do not hide the issue', async () => {
  const odd = { id: 'c2', author: null, created: 'yesterday', textMd: 'Odd comment' }
  const host = mockHost({
    requests: requests({ 'yt.issue.get': ok(detail(1, { fields: 'x', descriptionMd: 5, comments: [COMMENT, null, { id: 'c3' }, odd] })) })
  })
  const view = await openIssue(host)
  clean(view)
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.equal(view.find({ type: 'KeyValue' }), null)
  assert.ok(view.find({ text: 'No description' }))
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  assert.ok(view.find({ type: 'Markdown', content: 'Odd comment' }))
  assert.ok(view.find({ text: 'Unknown author' }))
  await view.unmount()
})

test('comments that are not a list are reported as not loaded, with Retry', async () => {
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok(detail(1, { comments: 'x' })) }) })
  const view = await openIssue(host)
  clean(view)
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.ok(view.find({ text: 'Comments could not be loaded.' }))
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  await view.unmount()
})

test('an issue answer without an id is still a whole-card error', async () => {
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok({ ...detail(1), id: 5 }) }) })
  const view = await openIssue(host)
  clean(view)
  assert.equal(danger(view).length, 1)
  assert.ok(view.find({ role: 'button', text: 'Retry' }))
  await view.unmount()
})

test('a malformed issue row is skipped or shown with n/a cells, the rest of the page is shown', async () => {
  const rows = [
    issue(1),
    null,
    { summary: 'no id' },
    { ...issue(3), summary: 7, state: 'Open', assignee: { name: 'x' }, created: 'soon' },
    issue(4)
  ]
  const host = mockHost({
    requests: requests({ 'yt.issues.search': ok({ issues: rows, hasMore: false, total: 'many' }), 'yt.issue.get': ok(detail(4)) })
  })
  const view = await mount(panel, { host })
  clean(view)
  assert.equal(danger(view).length, 0)
  const grid = view.find(table)
  assert.deepEqual(view.rowsOf(grid), ['DEMO-1', 'DEMO-3', 'DEMO-4'])
  const odd = grid.props.rows.find((r: any) => r.key === 'DEMO-3').cells
  assert.equal(odd.summary, 'n/a')
  assert.equal(odd.state, 'n/a')
  assert.equal(odd.assignee, 'n/a')
  assert.equal(odd.created, 'n/a')
  assert.equal(odd.priority, 'Major')
  assert.ok(view.find({ text: '3 issues' }))
  await view.activateRow(grid, 'DEMO-4')
  assert.ok(view.find({ type: 'Heading', text: 'Issue 4' }))
  await view.unmount()
})
