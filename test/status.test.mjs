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
  const bar = createStatusBar({
    host: orca.host, youtrack: yt, state, settings: orca.settings,
    now: () => new Date(2026, 0, 1, 9, 5).getTime(),
  })
  const updates = () => orca.hostCalls.filter((c) => c.method === 'statusBar.update').map((c) => c.params)
  return { bar, updates, counted, orca, state }
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
    assert.equal(u.tooltip, code === 'AUTH_FAILED' ? 'Signed out of two. Open the panel to sign in again.' : 'No YouTrack server. Open the panel to add one.')
  }
})

test('an invalid default query shows YT: ? and says why', async () => {
  const { bar, updates } = setup({ count: fail('QUERY_INVALID', "HTTP 400: Can't parse search query\nmore") })
  await bar.refresh()
  assert.deepEqual(updates().at(-1), {
    id: 'count', text: 'YT: ?', tone: 'warning', visible: true,
    tooltip: "The query two: for: me is not valid: HTTP 400: Can't parse search query"
  })
})

test('counts the query last run on the server, and the default query before any', async () => {
  const { bar, counted, state } = setup()
  await bar.refresh()
  assert.deepEqual(counted.at(-1), ['two', 'for: me'])
  await state.setQuery('one', 'other')
  await state.setQuery('two', 'state: Open')
  await bar.refresh()
  assert.deepEqual(counted.at(-1), ['two', 'state: Open'])
})

test('an unreachable server shows YT: – with the cause and when it last counted, without the old number', async () => {
  let n = 0
  const refused = 'Post "http://localhost:8088/api/issuesGetter/count?fields=count": dial tcp [::1]:8088: connect: connection refused'
  const s = setup({ youtrack: { instances: async () => ok(SERVERS), countIssues: async () => (n++ ? fail('NETWORK', refused) : ok(3)) } })
  await s.bar.refresh()
  await s.bar.refresh()
  assert.deepEqual(s.updates().at(-1), {
    id: 'count', text: 'YT: –', tone: 'warning', visible: true,
    tooltip: 'two is not reachable: connection refused. Last counted at 09:05.'
  })
  const slow = setup({ count: fail('TIMEOUT', 'slow') })
  await slow.bar.refresh()
  assert.deepEqual(slow.updates().at(-1), { id: 'count', text: 'YT: –', tone: 'warning', visible: true, tooltip: 'two is not reachable: no answer in time.' })
  const odd = setup({ count: fail('UNKNOWN', 'boom') })
  await odd.bar.refresh()
  assert.equal(odd.updates().at(-1).text, 'YT: –')
  assert.equal(odd.updates().at(-1).tooltip, 'The count could not be updated (two: for: me): boom.')
})

test('no CLI hides the item', async () => {
  const { bar, updates } = setup({ youtrack: null })
  await bar.refresh()
  assert.deepEqual(updates(), [{ id: 'count', visible: false }])
})

test('start counts once and nothing runs on a timer', async () => {
  const { bar, updates } = setup()
  const real = globalThis.setInterval
  let timers = 0
  globalThis.setInterval = (...a) => (timers++, real(...a))
  try {
    await bar.start()
  } finally {
    globalThis.setInterval = real
  }
  assert.equal(updates().length, 1)
  assert.equal(timers, 0)
  bar.stop()
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

function fakeTimers() {
  const timers = []
  return {
    timers,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false, unref() {} }
      timers.push(t)
      return t
    },
    clearTimeout: (t) => {
      if (t) t.cleared = true
    },
    pending: () => timers.filter((t) => !t.cleared),
    /** Let every pending timer run out, as if the agent stayed quiet. */
    async flush() {
      for (const t of timers.splice(0)) if (!t.cleared) await t.fn()
    }
  }
}

function notifier() {
  const orca = fakeOrca({ host: { 'notifications.show': { delivered: true } } })
  const store = createLaunchTracker(orca.storage)
  const clock = fakeTimers()
  const n = createFinishNotifier({
    host: orca.host, launches: store, post: orca.panels.post,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
  })
  /** The agent works, then stops and stays done. */
  const works = async (ev) => {
    await n.onAgentStatus({ ...ev, state: 'working', mainAgent: undefined })
    await n.onAgentStatus(ev)
    await clock.flush()
  }
  return { orca, store, n, clock, works, shown: () => orca.hostCalls.filter((c) => c.method === 'notifications.show').map((c) => c.params) }
}

test('notifies once per launch', async () => {
  const { store, n, shown, orca, works, clock } = notifier()
  await store.track({ terminalId: 'ws1', server: 'two', issueId: 'DEMO-1', workspaceId: 'ws1', at: 1 })
  const ev = { workspaceId: 'ws1', paneKey: 'p', state: 'done', receivedAt: 1 }
  await works(ev)
  await works(ev)
  await n.onAgentStatus(ev)
  await clock.flush()
  assert.deepEqual(shown(), [{ title: 'Agent finished DEMO-1', body: 'two' }])
  assert.deepEqual(orca.posts, [{ name: 'yt.agentFinished', payload: { server: 'two', issueId: 'DEMO-1', workspaceId: 'ws1' } }])
})

test('matches by terminal id first and honours mainAgent.state', async () => {
  const { store, n, shown, clock } = notifier()
  await store.track({ terminalId: 't9', server: 'one', issueId: 'DEMO-2', workspaceId: 'ws2', at: 1 })
  await n.onAgentStatus({ workspaceId: 'ws2', terminalId: 't9', paneKey: 'p', state: 'working', receivedAt: 1, mainAgent: { state: 'working', stateStartedAt: 1 } })
  await clock.flush()
  assert.equal(shown().length, 0)
  await n.onAgentStatus({ workspaceId: 'ws2', terminalId: 't9', paneKey: 'p', state: 'working', receivedAt: 1, mainAgent: { state: 'done', stateStartedAt: 1 } })
  await clock.flush()
  assert.deepEqual(shown(), [{ title: 'Agent finished DEMO-2', body: 'one' }])
})

test('ignores agents not launched by plugin', async () => {
  const { shown, orca, works } = notifier()
  await works({ workspaceId: null, paneKey: 'p', terminalId: 'zz', state: 'done', receivedAt: 1 })
  assert.equal(shown().length, 0)
  assert.equal(orca.posts.length, 0)
})

test('matches a launch by pane key or by workspace when the terminal differs', async () => {
  const { store, shown, works } = notifier()
  await store.track({ terminalId: 'term_1', paneKey: 'tab:pane', server: 'one', issueId: 'DEMO-3', workspaceId: 'identity:w3', at: 1 })
  await store.track({ terminalId: 'term_2', server: 'one', issueId: 'DEMO-4', workspaceId: 'identity:w4', at: 1 })
  await works({ workspaceId: null, paneKey: 'tab:pane', state: 'done', receivedAt: 1 })
  await works({ workspaceId: 'identity:w4', terminalId: 'other', state: 'done', receivedAt: 1 })
  assert.deepEqual(shown().map((s) => s.title), ['Agent finished DEMO-3', 'Agent finished DEMO-4'])
})

test('a launch is matched by its terminal handle before its workspace', async () => {
  const { store, shown, works } = notifier()
  await store.track({ terminalId: 'term_a', server: 'one', issueId: 'DEMO-5', workspaceId: 'identity:w', at: 1 })
  await store.track({ terminalId: 'term_b', server: 'one', issueId: 'DEMO-6', workspaceId: 'identity:w', at: 2 })
  await works({ workspaceId: 'identity:w', terminalId: 'term_b', state: 'done', receivedAt: 1 })
  assert.deepEqual(shown().map((s) => s.title), ['Agent finished DEMO-6'])
})

// An agent started with a prompt reports, within a fraction of a second: done (session start),
// working, done again, working (its prompt), and only then done when its turn is over.
test('an agent that is starting up is not reported as finished', async () => {
  const { store, n, shown, clock } = notifier()
  await store.track({ terminalId: 'term_s', paneKey: 'tab:s', server: 'one', issueId: 'DEMO-7', workspaceId: 'identity:s', at: 1 })
  const ev = (state, at) => ({ workspaceId: 'identity:s', paneKey: 'tab:s', terminalId: 'term_s', state, receivedAt: at, mainAgent: { state, stateStartedAt: at } })
  await n.onAgentStatus(ev('done', 1000))
  assert.equal(clock.pending().length, 0, 'a done before any work does not count')
  await n.onAgentStatus(ev('working', 1038))
  await n.onAgentStatus(ev('done', 1117))
  await n.onAgentStatus(ev('working', 1182))
  await clock.flush()
  assert.equal(shown().length, 0, 'a done the agent leaves at once does not count')
  await n.onAgentStatus(ev('working', 4000))
  await n.onAgentStatus(ev('done', 10600))
  await n.onAgentStatus(ev('done', 11900))
  assert.equal(shown().length, 0, 'the finish waits until the agent stays done')
  assert.deepEqual(clock.pending().map((t) => t.ms), [3000])
  await clock.flush()
  assert.deepEqual(shown(), [{ title: 'Agent finished DEMO-7', body: 'one' }])
})

test('an agent that never worked keeps its launch for a later finish', async () => {
  const { store, n, shown, clock, works } = notifier()
  await store.track({ terminalId: 'term_i', server: 'one', issueId: 'DEMO-8', workspaceId: 'identity:i', at: 1 })
  const idle = { workspaceId: 'identity:i', terminalId: 'term_i', paneKey: 'tab:i', state: 'done', receivedAt: 1 }
  await n.onAgentStatus(idle)
  await n.onAgentStatus(idle)
  await clock.flush()
  assert.equal(shown().length, 0)
  await works(idle)
  assert.deepEqual(shown().map((s) => s.title), ['Agent finished DEMO-8'])
})

test('a wait for the person cancels a pending finish', async () => {
  const { store, n, shown, clock } = notifier()
  await store.track({ terminalId: 'term_w', server: 'one', issueId: 'DEMO-9', workspaceId: 'identity:w9', at: 1 })
  const ev = (state) => ({ workspaceId: 'identity:w9', terminalId: 'term_w', paneKey: 'tab:w', state, receivedAt: 1 })
  await n.onAgentStatus(ev('working'))
  await n.onAgentStatus(ev('done'))
  await n.onAgentStatus(ev('waiting'))
  await clock.flush()
  assert.equal(shown().length, 0)
})

test('stop cancels pending finishes', async () => {
  const { store, n, shown, clock } = notifier()
  await store.track({ terminalId: 'term_x', server: 'one', issueId: 'DEMO-10', workspaceId: 'identity:x', at: 1 })
  const ev = (state) => ({ workspaceId: 'identity:x', terminalId: 'term_x', paneKey: 'tab:x', state, receivedAt: 1 })
  await n.onAgentStatus(ev('working'))
  await n.onAgentStatus(ev('done'))
  n.stop()
  assert.equal(clock.pending().length, 0)
  await clock.flush()
  assert.equal(shown().length, 0)
})
