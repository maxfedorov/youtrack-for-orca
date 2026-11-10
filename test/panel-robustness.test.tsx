import { assert, hostError, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'
import { optionsOf } from './combo'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, state: { name: 'Open' }, priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' }, created: 1_690_000_000_000 + n, updated: 1_700_000_000_000 + n, resolved: false,
  url: `https://main.example.com/issue/DEMO-${n}`
})
const detail = (n: number) => ({ ...issue(n), project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Text', comments: [] })
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: 'for: me #Unresolved', defaultQuery: 'for: me #Unresolved'
})
const prepare = {
  repos: [{ id: 'r1', name: 'alpha' }], orcaCli: true, defaultRepoId: 'r1', name: 'demo-1', agents: { installed: ['claude'], other: [] },
  defaultAgent: 'claude', launchMode: 'worktree', includeDescription: false, templates: [{ id: 't', name: 'T', body: 'Do {{id}}' }], defaultTemplateId: 't', vars: { id: 'DEMO-1' },
  workspaces: [{ id: 'w1', name: 'main' }], defaultWorkspaceId: 'w1'
}
const healthy: Record<string, unknown> = {
  'yt.env': env,
  'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: false, total: 2 }),
  'yt.savedQueries': ok([]),
  'yt.links': ok({}),
  'yt.setQuery': ok({}),
  'yt.setServer': ok({}),
  'yt.issue.get': ok(detail(1)),
  'yt.start.prepare': ok(prepare),
  'yt.refs.search': ok({ refs: ['main'] }),
  'yt.start.run': ok({ workspaceId: 'w9' }),
  'yt.runInExisting': ok({}),
  'yt.workspace.open': ok({}),
  'yt.servers.add': ok({ started: true }),
  'yt.savedQueries.create': ok({ id: 's1', name: 'Mine', query: 'q' })
}
/** Requests answered by `answer(name)` while `broken` is set, else healthy. */
function switchable(answer: (name: string) => unknown) {
  const state = { broken: true }
  const requests = Object.fromEntries(
    Object.keys(healthy).map((name) => [name, () => (state.broken ? answer(name) : healthy[name])])
  )
  return { state, requests }
}
const table = { type: 'Table' }
const danger = (view: any) => view.findAll({ type: 'Callout' }).filter((c: any) => c.props.tone === 'danger')
const clean = (view: any) => {
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
}
const throwing = (code: string) => () => {
  throw hostError(code)
}

for (const code of ['unavailable', 'timeout', 'action_failed']) {
  test(`every request rejecting ${code}: an error with Retry, and Retry recovers`, async () => {
    const { state, requests } = switchable(() => throwing(code)())
    const view = await mount(panel, { host: mockHost({ requests }) })
    clean(view)
    assert.equal(danger(view).length, 1)
    assert.ok(view.find({ role: 'button', text: 'Retry' }))
    state.broken = false
    await view.press({ role: 'button', text: 'Retry' })
    clean(view)
    assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
    assert.equal(danger(view).length, 0)
    await view.unmount()
  })
}

test('the worker going away after the list loaded: each screen shows an error with Retry or Back', async () => {
  const { state, requests } = switchable(() => throwing('unavailable')())
  state.broken = false
  const view = await mount(panel, { host: mockHost({ requests }) })
  state.broken = true
  await view.press({ role: 'button', label: 'Refresh' })
  clean(view)
  assert.ok(view.find({ role: 'button', text: 'Retry' }))

  state.broken = false
  await view.press({ role: 'button', text: 'Retry' })
  state.broken = true
  await view.activateRow(view.find(table), 'DEMO-1')
  clean(view)
  assert.equal(danger(view).length, 1)
  assert.ok(view.find({ role: 'button', text: 'Retry' }))
  state.broken = false
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))

  state.broken = true
  await view.press({ role: 'button', text: 'Start →' })
  clean(view)
  assert.ok(view.find({ role: 'button', text: 'Retry' }))
  await view.press({ role: 'button', text: '← Back' })
  clean(view)
  assert.ok(view.find(table))
  await view.unmount()
})

const GARBAGE: [string, unknown][] = [
  ['null', null],
  ['a string', 'nope'],
  ['an array', []],
  ['ok without data', { ok: true }],
  ['ok with null data', { ok: true, data: null }],
  ['ok with wrong data', { ok: true, data: { issues: 'x', refs: 5, servers: {}, cli: null, repos: [null], fields: 1 } }],
  ['ok with a list of nulls', { ok: true, data: [null, 1] }],
  ['a failure without error', { ok: false }],
  ['a failure with an odd error', { ok: false, error: { code: 5, message: {} } }]
]

for (const [label, answer] of GARBAGE) {
  test(`yt.env answering ${label}: an error with Retry`, async () => {
    const view = await mount(panel, { host: mockHost({ requests: { ...healthy, 'yt.env': answer } }) })
    clean(view)
    assert.equal(danger(view).length, 1)
    assert.ok(view.find({ role: 'button', text: 'Retry' }))
    await view.unmount()
  })

  test(`every list request answering ${label}: no crash, Retry shown`, async () => {
    const requests = { ...healthy, 'yt.issues.search': answer, 'yt.savedQueries': answer, 'yt.links': answer, 'yt.setQuery': answer }
    const view = await mount(panel, { host: mockHost({ requests }) })
    clean(view)
    assert.ok(view.find({ role: 'button', text: 'Retry' }))
    await view.press({ role: 'button', label: 'Refresh' })
    clean(view)
    await view.unmount()
  })

  test(`issue detail answering ${label}: an error with Retry and Back`, async () => {
    const view = await mount(panel, { host: mockHost({ requests: { ...healthy, 'yt.issue.get': answer } }) })
    await view.activateRow(view.find(table), 'DEMO-1')
    clean(view)
    assert.equal(danger(view).length, 1)
    assert.ok(view.find({ role: 'button', text: 'Retry' }))
    await view.press({ role: 'button', text: '← Back' })
    assert.ok(view.find(table))
    clean(view)
    await view.unmount()
  })

  test(`start answering ${label}: no crash, an error is shown`, async () => {
    const requests = { ...healthy, 'yt.start.prepare': answer }
    const view = await mount(panel, { host: mockHost({ requests }) })
    await view.activateRow(view.find(table), 'DEMO-1')
    await view.press({ role: 'button', text: 'Start →' })
    clean(view)
    assert.ok(view.find({ role: 'button', text: 'Retry' }))
    await view.unmount()

    const later = { ...healthy, 'yt.refs.search': answer, 'yt.start.run': answer }
    const start = await mount(panel, { host: mockHost({ requests: later }) })
    await start.activateRow(start.find(table), 'DEMO-1')
    await start.press({ role: 'button', text: 'Start →' })
    await start.press({ testId: 'Create from:toggle' })
    await start.type({ type: 'Input', label: 'Filter Create from' }, 'ma')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await start.settled()
    clean(start)
    await start.press({ role: 'button', text: 'Start' })
    clean(start)
    assert.equal(danger(start).length, 1)
    assert.ok(start.find({ role: 'button', text: 'Start' }))
    await start.unmount()
  })

  test(`saving a search answering ${label}: an error next to the form`, async () => {
    const view = await mount(panel, { host: mockHost({ requests: { ...healthy, 'yt.savedQueries.create': answer } }) })
    await view.press({ role: 'button', label: 'Save search' })
    await view.press({ role: 'button', text: 'Save' })
    clean(view)
    assert.ok(view.find({ type: 'Input', label: 'Search name' }))
    assert.ok(view.findAll({ type: 'Text' }).some((t: any) => t.props.tone === 'danger'), 'no error text next to the form')
    await view.unmount()
  })
}

test('worker events of an unexpected shape are ignored', async () => {
  const view = await mount(panel, { host: mockHost({ requests: healthy }) })
  await view.press({ role: 'button', label: 'Add server' })
  for (const payload of [null, 'x', 5, [], {}, { url: 5 }, { ok: false }, { ok: true }, { ok: false, error: null }, { ok: true, data: null }]) {
    await view.post('yt.servers.authUrl', payload as never)
    await view.post('yt.servers.added', payload as never)
    await view.post('yt.agentFinished', payload as never)
  }
  clean(view)
  await view.unmount()
})

test('an issue too large to draw shows an error with Open in browser instead of loading forever', async () => {
  const comments = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, author: { login: 'a', fullName: 'A' }, created: i, textMd: 'x'.repeat(50_000) }))
  const huge = { ...detail(1), descriptionMd: 'y'.repeat(70_000), comments }
  const view = await mount(panel, { host: mockHost({ requests: { ...healthy, 'yt.issue.get': ok(huge) } }) })
  await view.activateRow(view.find(table), 'DEMO-1')
  clean(view)
  assert.ok(view.find({ text: 'This issue is too large to show here. Open it in the browser.' }))
  assert.ok(view.find({ role: 'button', text: 'Open in browser' }))
  assert.ok(view.find({ role: 'button', text: '← Back' }))
  await view.unmount()
})

test('long error texts are shortened so the screen can still be drawn', async () => {
  const long = { ok: false, error: { code: 'ORCA_CLI_FAILED', message: 'e'.repeat(40_000) } }
  const view = await mount(panel, { host: mockHost({ requests: { ...healthy, 'yt.issues.search': long } }) })
  clean(view)
  const text = view.findAll({ type: 'Text' }).map((t: any) => t.props.children ?? t.text).find((t: any) => typeof t === 'string' && t.startsWith('eee'))
  assert.ok(text && text.length <= 2001)
  await view.unmount()
})

test('duplicate issue and comment ids are drawn once each without a refused render', async () => {
  const rows = [issue(1), issue(1), issue(2)]
  const comment = (id: string, n: number) => ({ id, author: { login: 'a', fullName: 'A' }, created: n, textMd: `Comment ${n}` })
  const withComments = { ...detail(1), comments: [comment('c1', 1), comment('c1', 2), comment('', 3), comment('', 4)] }
  const view = await mount(panel, {
    host: mockHost({ requests: { ...healthy, 'yt.issues.search': ok({ issues: rows, hasMore: false, total: 3 }), 'yt.issue.get': ok(withComments) } })
  })
  clean(view)
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  await view.activateRow(view.find(table), 'DEMO-1')
  clean(view)
  for (const n of [1, 2, 3, 4]) assert.ok(view.find({ type: 'Markdown', content: `Comment ${n}` }) ?? view.find({ text: `Comment ${n}` }), `comment ${n}`)
  await view.unmount()
})

test('saved searches without an id or name are not offered', async () => {
  const saved = ok([{ id: '', name: 'blank id', query: 'a' }, { id: 's2', name: '', query: 'b' }, { id: 's3', name: 'Mine', query: 'c' }])
  const view = await mount(panel, { host: mockHost({ requests: { ...healthy, 'yt.savedQueries': saved } }) })
  clean(view)
  assert.deepEqual((await optionsOf(view, 'Saved searches')).map((o: any) => o.value), ['s3'])
  await view.unmount()
})

test('a saved search answered without an id reloads the list instead of adding a blank entry', async () => {
  let n = 0
  const requests = {
    ...healthy,
    'yt.savedQueries.create': ok({ id: '', name: 'Mine', query: 'for: me #Unresolved' }),
    'yt.savedQueries': () => ok(n++ === 0 ? [] : [{ id: 's9', name: 'Mine', query: 'for: me #Unresolved' }])
  }
  const view = await mount(panel, { host: mockHost({ requests }) })
  await view.press({ role: 'button', label: 'Save search' })
  await view.press({ role: 'button', text: 'Save' })
  clean(view)
  assert.deepEqual((await optionsOf(view, 'Saved searches')).map((o: any) => o.value), ['s9'])
  await view.unmount()
})

test('the start form loads again for the same issue on another server', async () => {
  const two = ok({ ...env.data, servers: [...env.data.servers, { alias: 'other', url: 'https://other.example.com', active: false, status: 'authenticated' }] })
  let chosen = 'main'
  const host = mockHost({
    requests: {
      ...healthy,
      'yt.env': () => ok({ ...two.data, server: chosen }),
      'yt.setServer': (i: any) => ((chosen = i.server), ok({}))
    }
  })
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  await view.select({ type: 'Select', label: 'Server' }, 'other')
  assert.ok(view.find(table))
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  const prepares = host.callsOf('plugin.request').filter((c: any) => c.name === 'yt.start.prepare').map((c: any) => c.input.server)
  assert.deepEqual(prepares, ['main', 'other'])
  clean(view)
  await view.unmount()
})
