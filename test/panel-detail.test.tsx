import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`,
  summary: `Issue ${n}`,
  state: { name: 'Open' },
  priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' },
  created: 1_690_000_000_000 + n,
  updated: 1_700_000_000_000 + n,
  resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`
})
const detail = (n: number, over: Record<string, unknown> = {}) => ({
  ...issue(n),
  project: { shortName: 'DEMO', name: 'Demo' },
  type: { name: 'Bug' },
  fields: [
    { name: 'Priority', value: 'Major' },
    { name: 'State', value: 'Open' },
    { name: 'Assignee', value: 'Jane Doe' },
    { name: 'Subsystem', value: 'No Subsystem' },
    { name: 'Estimation', value: '2h 30m' }
  ],
  descriptionMd: `Description of **issue ${n}**`,
  comments: [{ id: 'c1', author: { login: 'bob', fullName: 'Bob Roe' }, created: 1_700_000_100_000, textMd: 'First *comment*' }],
  ...over
})
const env = ok({
  cli: { found: true },
  orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
  server: 'main',
  query: 'for: me #Unresolved',
  defaultQuery: 'for: me #Unresolved'
})
function requests(over: Record<string, unknown> = {}) {
  return {
    'yt.env': env,
    'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: true, total: 7 }),
    'yt.savedQueries': ok([]),
    'yt.links': ok({}),
    'yt.setQuery': ok({}),
    'yt.workspace.open': ok({}),
    'yt.issue.get': (i: any) => ok(detail(Number(i.id.split('-')[1]))),
    ...over
  }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const table = { type: 'Table' }
const open = async (host: any, id = 'DEMO-1') => {
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), id)
  return view
}
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
}

test('back keeps query and loaded rows', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.deepEqual(calls(host, 'yt.issue.get')[0].input, { server: 'main', id: 'DEMO-1' })
  assert.equal(view.find(table), null)
  const searches = calls(host, 'yt.issues.search').length
  await view.press({ role: 'button', text: '← Back' })
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  assert.equal(view.find({ type: 'Input', label: 'Query' }).props.value, 'for: me #Unresolved')
  assert.ok(view.find({ text: '7 issues' }))
  assert.equal(calls(host, 'yt.issues.search').length, searches)
  clean(view)
  await view.unmount()
})

test('back keeps the selected row', async () => {
  const host = mockHost({ requests: requests() })
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-2'])
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.press({ role: 'button', text: '← Back' })
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  assert.deepEqual(Array.from(view.find(table).props.selected), ['DEMO-2'])
  await view.unmount()
})

test('renders fields read-only', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.ok(view.find({ text: 'DEMO-1' }))
  assert.ok(view.find({ text: 'Issue 1' }))
  assert.equal(view.find({ type: 'Select', label: 'State' }), null)
  assert.equal(view.find({ type: 'Select', label: 'Priority' }), null)
  assert.equal(view.find({ type: 'Select', label: 'Assignee' }), null)
  assert.equal(view.find({ type: 'Select', label: 'Type' }), null)
  assert.equal(view.find({ type: 'Input' }), null)
  const items = view.find({ type: 'KeyValue' }).props.items
  assert.deepEqual(items.map((i: any) => [i.label, i.value]), [
    ['Priority', 'Major'], ['State', 'Open'], ['Assignee', 'Jane Doe'], ['Subsystem', 'No Subsystem'], ['Estimation', '2h 30m']
  ])
  assert.equal(view.find({ type: 'Markdown' }).props.content, 'Description of **issue 1**')
  clean(view)
  await view.unmount()
})

test('an issue without fields shows no field list', async () => {
  const bare = { ...detail(1), fields: [] }
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok(bare) }) })
  const view = await open(host)
  assert.equal(view.find({ type: 'KeyValue' }), null)
  await view.unmount()
})

test('comments show author, time and text', async () => {
  const host = mockHost({
    requests: requests({
      'yt.issue.get': ok(detail(1, { comments: [
        { id: 'c1', author: { login: 'bob', fullName: 'Bob Roe' }, created: 1_700_000_100_000, textMd: 'First' },
        { id: 'c2', author: { login: 'amy', fullName: '' }, created: 1_700_000_200_000, textMd: 'Second' }
      ] }))
    })
  })
  const view = await open(host)
  assert.ok(view.find({ text: 'Bob Roe' }))
  assert.ok(view.find({ text: 'amy' }))
  assert.equal(view.find({ type: 'RelativeTime', at: 1_700_000_100_000 })?.props.at, 1_700_000_100_000)
  assert.ok(view.find({ type: 'Markdown', content: 'Second' }))
  assert.equal(view.find({ text: 'No comments' }), null)
  clean(view)
  await view.unmount()
})

test('no comments shows "No comments"', async () => {
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok(detail(1, { comments: [] })) }) })
  const view = await open(host)
  assert.ok(view.find({ text: 'No comments' }))
  await view.unmount()
})

test('open in browser uses the issue url', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await view.press({ role: 'button', label: 'Open in browser' })
  assert.deepEqual(host.callsOf('shell.openExternal').at(-1), { url: 'https://main.example.youtrack.cloud/issue/DEMO-1' })
  clean(view)
  await view.unmount()
})

test('start and open actions follow the workspace link', async () => {
  const host = mockHost({ requests: requests({ 'yt.links': ok({ 'DEMO-2': 'ws-2' }) }) })
  const view = await open(host, 'DEMO-1')
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  await view.press({ role: 'button', text: '← Back' })
  await view.activateRow(view.find(table), 'DEMO-2')
  assert.equal(view.find({ role: 'button', text: 'Start →' }), null)
  await view.press({ role: 'button', text: 'Open →' })
  assert.deepEqual(calls(host, 'yt.workspace.open')[0].input, { workspaceId: 'ws-2' })
  await view.unmount()
})

test('start leaves the detail view for the start view', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await view.press({ role: 'button', text: 'Start →' })
  assert.ok(view.find({ text: 'Start DEMO-1' }))
  await view.unmount()
})

test('long issues offer the browser', async () => {
  const notice = 'This issue is too long to show in full. Open it in the browser to see everything.'
  for (const over of [{ truncated: true }, { commentsOmitted: 12 }]) {
    const host = mockHost({ requests: requests({ 'yt.issue.get': ok(detail(1, over)) }) })
    const view = await open(host)
    assert.equal(view.find({ type: 'Callout' }).props.tone, 'neutral')
    assert.ok(view.find({ text: notice }))
    await view.unmount()
  }
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.equal(view.find({ type: 'Callout' }), null)
  await view.unmount()
})

test('loading shows a skeleton, an error shows Retry and Back', async () => {
  let n = 0
  const host = mockHost({
    requests: requests({ 'yt.issue.get': () => (n++ === 0 ? fail('NETWORK', 'Cannot reach the server') : ok(detail(1))) })
  })
  const view = await open(host)
  const callout = view.find({ type: 'Callout' })
  assert.equal(callout.props.tone, 'danger')
  assert.ok(view.find({ text: 'Cannot reach the server' }))
  assert.ok(view.find({ role: 'button', text: '← Back' }))
  await view.press({ role: 'button', text: 'Retry' })
  assert.equal(calls(host, 'yt.issue.get').length, 2)
  assert.ok(view.find({ type: 'Markdown' }))
  await view.unmount()
})

test('skeleton while the issue loads', async () => {
  let release: (v: unknown) => void = () => {}
  const gate = new Promise((r) => (release = r))
  const host = mockHost({ requests: requests({ 'yt.issue.get': async () => (await gate, ok(detail(1))) }) })
  const view = await mount(panel, { host })
  void view.activateRow(view.find(table), 'DEMO-1')
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(view.find({ type: 'Skeleton' }))
  release(null)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(view.find({ type: 'Skeleton' }), null)
  await view.unmount()
})

test('refresh reloads the issue', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await view.press({ role: 'button', label: 'Refresh' })
  assert.equal(calls(host, 'yt.issue.get').length, 2)
  await view.unmount()
})

test('opening another issue loads it', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host, 'DEMO-1')
  await view.press({ role: 'button', text: '← Back' })
  await view.activateRow(view.find(table), 'DEMO-2')
  assert.deepEqual(calls(host, 'yt.issue.get').map((c: any) => c.input.id), ['DEMO-1', 'DEMO-2'])
  assert.equal(view.find({ type: 'Markdown' }).props.content, 'Description of **issue 2**')
  await view.unmount()
})
