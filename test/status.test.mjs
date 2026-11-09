import { test, assert } from 'orca/testing'
import { createStatusBar, createFinishNotifier, refreshAfter } from '../worker/status.mjs'
import { createStateStore } from '../worker/state.mjs'
import { createLaunchTracker } from '../worker/links.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca, fakeStorage } from './helpers.mjs'

const SERVERS = [
  { alias: 'one', url: 'https://one.youtrack.cloud', status: 'authenticated', active: false },
  { alias: 'two', url: 'https://two.youtrack.cloud', status: 'authenticated', active: true },
]

function setup({ count = ok(7), instances = ok(SERVERS), youtrack, stored } = {}) {
  const orca = fakeOrca({ host: { 'statusBar.update': { ok: true } }, settings: { defaultQuery: 'for: me' } })
  const state = createStateStore(fakeStorage(stored ? { server: stored } : {}))
  const counted = []
  const yt = youtrack === null ? null : youtrack ?? {
    instances: async () => instances,
    countIssues: async (s, q) => (counted.push([s, q]), count),
  }
  const timers = []
  const cleared = []
  const bar = createStatusBar({
    host: orca.host, youtrack: yt, state, settings: orca.settings,
    setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearInterval: (id) => cleared.push(id),
  })
  const updates = () => orca.hostCalls.filter((c) => c.method === 'statusBar.update').map((c) => c.params)
  return { bar, updates, counted, timers, cleared, orca }
}

test('shows count', async () => {
  const { bar, updates, counted } = setup()
  await bar.refresh()
  assert.deepEqual(counted, [['two', 'for: me']])
  assert.deepEqual(updates(), [{ id: 'count', text: 'YT: 7', tooltip: 'two: for: me', tone: 'neutral', visible: true }])
})

test('uses the stored server', async () => {
  const { bar, counted } = setup({ stored: 'one' })
  await bar.refresh()
  assert.equal(counted[0][0], 'one')
})

test('auth error shows YT: !', async () => {
  for (const code of ['AUTH_FAILED', 'NO_SERVERS']) {
    const { bar, updates } = setup({ count: fail(code, 'x'), instances: code === 'NO_SERVERS' ? fail(code, 'x') : ok(SERVERS) })
    await bar.refresh()
    const u = updates().at(-1)
    assert.equal(u.text, 'YT: !')
    assert.equal(u.tone, 'warning')
  }
})

test('network error keeps the last text', async () => {
  const s = setup()
  await s.bar.refresh()
  const yt = { instances: async () => ok(SERVERS), countIssues: async () => fail('NETWORK', 'down') }
  const s2 = setup({ youtrack: yt })
  await s2.bar.refresh()
  assert.equal('text' in s2.updates().at(-1), false)
  assert.equal(s2.updates().at(-1).tone, 'warning')
  let n = 0
  const flaky = setup({ youtrack: { instances: async () => ok(SERVERS), countIssues: async () => (n++ ? fail('TIMEOUT', 'slow') : ok(3)) } })
  await flaky.bar.refresh()
  await flaky.bar.refresh()
  const u = flaky.updates().at(-1)
  assert.equal(u.text, 'YT: 3')
  assert.equal(u.tone, 'warning')
})

test('no CLI hides the item', async () => {
  const { bar, updates } = setup({ youtrack: null })
  await bar.refresh()
  assert.deepEqual(updates(), [{ id: 'count', visible: false }])
})

test('start refreshes and polls, stop clears the timer', async () => {
  const { bar, updates, timers, cleared } = setup()
  await bar.start()
  assert.equal(updates().length, 1)
  assert.equal(timers[0].ms, 300000)
  await timers[0].fn()
  assert.equal(updates().length, 2)
  bar.stop()
  assert.deepEqual(cleared, [1])
})

test('refreshAfter refreshes only after a successful answer', async () => {
  const orca = fakeOrca()
  let refreshed = 0
  const wrapped = refreshAfter(orca, ['yt.a', 'yt.b'], async () => void refreshed++)
  wrapped.panels.handle('yt.a', async () => ok({}))
  wrapped.panels.handle('yt.b', async () => fail('UNKNOWN', 'no'))
  wrapped.panels.handle('yt.c', async () => ok({}))
  const a = await orca.handlers.get('yt.a')({})
  await orca.handlers.get('yt.b')({})
  await orca.handlers.get('yt.c')({})
  assert.equal(a.ok, true)
  assert.equal(refreshed, 1)
  assert.equal(wrapped.settings, orca.settings)
})

function notifier(launches = []) {
  const orca = fakeOrca({ host: { 'notifications.show': { delivered: true } } })
  const store = createLaunchTracker(orca.storage)
  const n = createFinishNotifier({ host: orca.host, launches: store, post: orca.panels.post })
  return { orca, store, n, launches, shown: () => orca.hostCalls.filter((c) => c.method === 'notifications.show').map((c) => c.params) }
}

test('notifies once per launch', async () => {
  const { store, n, shown, orca } = notifier()
  await store.track({ terminalId: 'ws1', server: 'two', issueId: 'DEMO-1', workspaceId: 'ws1', at: 1 })
  const ev = { workspaceId: 'ws1', paneKey: 'p', state: 'done', receivedAt: 1 }
  await n.onAgentStatus(ev)
  await n.onAgentStatus(ev)
  assert.deepEqual(shown(), [{ title: 'Agent finished DEMO-1', body: 'two' }])
  assert.deepEqual(orca.posts, [{ name: 'yt.agentFinished', payload: { server: 'two', issueId: 'DEMO-1', workspaceId: 'ws1' } }])
})

test('matches by terminal id first and honours mainAgent.state', async () => {
  const { store, n, shown } = notifier()
  await store.track({ terminalId: 't9', server: 'one', issueId: 'DEMO-2', workspaceId: 'ws2', at: 1 })
  await n.onAgentStatus({ workspaceId: 'ws2', terminalId: 't9', paneKey: 'p', state: 'working', receivedAt: 1, mainAgent: { state: 'working', stateStartedAt: 1 } })
  assert.equal(shown().length, 0)
  await n.onAgentStatus({ workspaceId: 'ws2', terminalId: 't9', paneKey: 'p', state: 'working', receivedAt: 1, mainAgent: { state: 'done', stateStartedAt: 1 } })
  assert.deepEqual(shown(), [{ title: 'Agent finished DEMO-2', body: 'one' }])
})

test('ignores agents not launched by plugin', async () => {
  const { n, shown, orca } = notifier()
  await n.onAgentStatus({ workspaceId: null, paneKey: 'p', terminalId: 'zz', state: 'done', receivedAt: 1 })
  assert.equal(shown().length, 0)
  assert.equal(orca.posts.length, 0)
})

test('matches a launch by pane key or by workspace when the terminal differs', async () => {
  const { store, n, shown } = notifier()
  await store.track({ terminalId: 'term_1', paneKey: 'tab:pane', server: 'one', issueId: 'DEMO-3', workspaceId: 'identity:w3', at: 1 })
  await store.track({ terminalId: 'term_2', server: 'one', issueId: 'DEMO-4', workspaceId: 'identity:w4', at: 1 })
  await n.onAgentStatus({ workspaceId: null, paneKey: 'tab:pane', state: 'done', receivedAt: 1 })
  await n.onAgentStatus({ workspaceId: 'identity:w4', terminalId: 'other', state: 'done', receivedAt: 1 })
  assert.deepEqual(shown().map((s) => s.title), ['Agent finished DEMO-3', 'Agent finished DEMO-4'])
})

test('a launch is matched by its terminal handle before its workspace', async () => {
  const { store, n, shown } = notifier()
  await store.track({ terminalId: 'term_a', server: 'one', issueId: 'DEMO-5', workspaceId: 'identity:w', at: 1 })
  await store.track({ terminalId: 'term_b', server: 'one', issueId: 'DEMO-6', workspaceId: 'identity:w', at: 2 })
  await n.onAgentStatus({ workspaceId: 'identity:w', terminalId: 'term_b', state: 'done', receivedAt: 1 })
  assert.deepEqual(shown().map((s) => s.title), ['Agent finished DEMO-6'])
})
