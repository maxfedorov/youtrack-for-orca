import { EventEmitter } from 'node:events'
import { test, assert } from 'orca/testing'
import { registerHandlers } from '../worker/handlers.mjs'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { createStateStore } from '../worker/state.mjs'
import { createYoutrackHolder } from '../worker/cli-holder.mjs'
import { createOrcaCli } from '../worker/orca-cli.mjs'
import { createStatusBar, createFinishNotifier } from '../worker/status.mjs'
import { createSerial } from '../worker/serial.mjs'
import { runProcess } from '../worker/exec.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca, fakeStorage } from './helpers.mjs'

const SERVERS = [{ alias: 'one', url: 'https://one.youtrack.cloud', status: 'authenticated', active: true }]
const WS = [{ id: 'identity:main', name: 'main', project: 'demo-repo', path: '/p/demo-repo', branch: 'main' }]
const rawIssue = (id) => ({ idReadable: id, summary: `Fix ${id}`, project: { shortName: 'DEMO', name: 'Demo' }, customFields: [] })

const fakeYt = (over = {}) => ({
  version: async () => ok('1.0.0'),
  instances: async () => ok(SERVERS),
  listIssues: async () => ok([rawIssue('DEMO-1')]),
  countIssues: async () => ok(1),
  viewIssue: async (s, id) => ok(rawIssue(id)),
  listComments: async () => ok([]),
  savedSearches: async () => ok([]),
  createSavedSearch: async (s, name, query) => ok({ id: '1', name, query }),
  loginWeb: async () => ok({}),
  ...over
})
const fakeCli = (over = {}) => ({
  repos: async () => ok([{ id: 'r1', name: 'demo-repo', path: '/p/demo-repo' }]),
  searchRefs: async () => ok(['main']),
  createWorktree: async () => ok({ workspaceId: 'identity:new', name: 'n', branch: 'b' }),
  launchAgent: async () => ok({ terminalId: 't9' }),
  ...over
})

function setup({ yt = fakeYt(), cli = fakeCli(), host = {}, storage = {}, orca: patch = {} } = {}) {
  const orca = fakeOrca({
    host: { 'workspace.list': { workspaces: WS, truncated: false }, 'workspace.readContext': { branch: 'main', displayName: 'main' }, ...host },
    settings: { defaultQuery: 'for: me' },
    storage
  })
  Object.assign(orca, patch)
  registerHandlers(orca, {
    youtrack: yt, orcaCli: cli,
    links: createLinkStore(orca.storage), launches: createLaunchTracker(orca.storage), state: createStateStore(orca.storage),
    platform: 'darwin', detectAgents: () => ({ installed: ['claude'], other: [] }), now: () => 1000
  })
  const call = (name, input) => orca.handlers.get(name)(input)
  return { orca, call }
}

/** Runs `fn` and lets pending callbacks settle; returns the unhandled rejections and uncaught exceptions seen meanwhile. */
async function stray(fn) {
  const seen = []
  const record = (e) => seen.push(e)
  process.on('unhandledRejection', record)
  process.on('uncaughtException', record)
  try {
    await fn()
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
  } finally {
    process.off('unhandledRejection', record)
    process.off('uncaughtException', record)
  }
  return seen
}

const isResult = (r) =>
  r !== null && typeof r === 'object' && (r.ok === true ? 'data' in r : r.ok === false && typeof r.error?.code === 'string' && typeof r.error?.message === 'string')

test('the youtrack CLI is still found when the path setting cannot be read', async () => {
  const holder = createYoutrackHolder({
    getSetting: async () => { throw new Error('settings unavailable') },
    env: { PATH: '/bin' }, platform: 'linux', homedir: '/home/demo',
    exists: (p) => p === '/bin/youtrack',
    create: ({ bin }) => ({ bin })
  })
  assert.deepEqual(await holder.refresh(), { bin: '/bin/youtrack' })
})

test('a rejected panel post does not leave an unhandled rejection after an agent finished', async () => {
  const storage = fakeStorage({ launches: [{ terminalId: 't1', server: 'one', issueId: 'DEMO-1', workspaceId: 'w1', at: 1 }] })
  const notifier = createFinishNotifier({
    host: { call: async () => ({}) },
    launches: createLaunchTracker(storage),
    post: () => Promise.reject(new Error('no panel'))
  })
  const seen = await stray(() => notifier.onAgentStatus({ workspaceId: 'w1', terminalId: 't1', state: 'done' }))
  assert.deepEqual(seen, [])
})

test('a rejected sign-in link post does not leave an unhandled rejection', async () => {
  const yt = fakeYt({ loginWeb: async (url, onAuthUrl) => (onAuthUrl('https://auth.example/x'), ok({})) })
  const { orca, call } = setup({ yt })
  orca.panels.post = () => Promise.reject(new Error('no panel'))
  const seen = await stray(async () => {
    const r = await call('yt.servers.add', { url: 'https://new.youtrack.cloud' })
    assert.equal(r.ok, true)
  })
  assert.deepEqual(seen, [])
})

/** A child process stand-in whose stderr and stdin are event emitters. */
function fakeChild({ stderrChunks = [], stdinError = false } = {}) {
  return (file, args, opts, cb) => {
    const stderr = new EventEmitter()
    stderr.setEncoding = () => {}
    const stdin = new EventEmitter()
    stdin.end = () => {
      if (stdinError) process.nextTick(() => stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))
    }
    setImmediate(() => {
      for (const c of stderrChunks) stderr.emit('data', c)
      stderr.emit('end')
      setImmediate(() => cb(null, 'out', stderrChunks.join('')))
    })
    return { stderr, stdin }
  }
}

test('a throwing stderr line callback does not crash the worker', async () => {
  let r
  const seen = await stray(async () => {
    r = await runProcess('x', [], { timeoutMs: 1000, onStderrLine: () => { throw new Error('bad line') } }, fakeChild({ stderrChunks: ['a\n', 'b'] }))
  })
  assert.deepEqual(seen, [])
  assert.equal(r.exitCode, 0)
})

test('a stdin write error does not crash the worker', async () => {
  let r
  const seen = await stray(async () => {
    r = await runProcess('x', [], { timeoutMs: 1000, input: 'data' }, fakeChild({ stdinError: true }))
  })
  assert.deepEqual(seen, [])
  assert.equal(r.exitCode, 0)
})

test('corrupt link and launch storage does not break links, starting or notifications', async () => {
  const storage = {
    links: { 'one|DEMO-1': [null, 5, 'x', { workspaceId: 'identity:main', createdAt: 1 }], 'one|DEMO-2': 'oops' },
    launches: [null, 7, 'x', { terminalId: 't1', server: 'one', issueId: 'DEMO-1', workspaceId: 'identity:main', at: 1 }]
  }
  const { call, orca } = setup({ storage })
  assert.deepEqual(await call('yt.links', { server: 'one' }), ok({ 'DEMO-1': 'identity:main' }))
  const run = await call('yt.start.run', { server: 'one', id: 'DEMO-3', repoId: 'r1', name: 'n', agent: 'claude', prompt: 'p' })
  assert.deepEqual(run, ok({ workspaceId: 'identity:new' }))
  const notifier = createFinishNotifier({ host: { call: async () => ({}) }, launches: createLaunchTracker(orca.storage) })
  await notifier.onAgentStatus({ workspaceId: 'identity:main', terminalId: 't1', state: 'done' })
  assert.equal((await orca.storage.get('launches')).some((e) => e?.terminalId === 't1'), false)
})

test('odd workspace list entries do not break preparing a start', async () => {
  const { call } = setup({ host: { 'workspace.list': { workspaces: [null, 7, { name: 'no id' }, ...WS] } } })
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data.workspaces, [{ id: 'identity:main', name: 'main', project: 'demo-repo', branch: 'main' }])
  assert.equal(r.data.defaultWorkspaceId, 'identity:main')
})

test('unexpected Orca CLI shapes become clean repo and branch lists', async () => {
  const answer = (result) => async () => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, result }), stderr: '', timedOut: false })
  assert.deepEqual(await createOrcaCli({ run: answer({ refs: { a: 1 } }) }).searchRefs('r1', ''), ok([]))
  assert.deepEqual(await createOrcaCli({ run: answer({ refs: ['main', 5, null, 'dev'] }) }).searchRefs('r1', ''), ok(['main', 'dev']))
  assert.deepEqual(await createOrcaCli({ run: answer({ repos: { a: 1 } }) }).repos(), ok([]))
  assert.deepEqual(
    await createOrcaCli({ run: answer({ repos: [null, 5, { id: 7 }, { id: 'r1', displayName: 3 }] }) }).repos(),
    ok([{ id: 'r1', name: 'r1' }])
  )
  assert.equal((await createOrcaCli({ run: answer(null) }).repos()).ok, true)
})

test('an issue answer that is not an issue is reported, not shown as a blank issue', async () => {
  for (const data of [null, 'text', 42, [], {}]) {
    const { call } = setup({ yt: fakeYt({ viewIssue: async () => ok(data) }) })
    const r = await call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
    assert.deepEqual(r, fail('UNKNOWN', 'The youtrack CLI returned an unexpected answer.'), JSON.stringify(data))
    const p = await call('yt.start.prepare', { server: 'one', id: 'DEMO-1' })
    assert.deepEqual(p, fail('UNKNOWN', 'The youtrack CLI returned an unexpected answer.'), JSON.stringify(data))
  }
})

test('search drops rows without an id and treats a non-list answer as unexpected', async () => {
  const rows = setup({ yt: fakeYt({ listIssues: async () => ok([null, { summary: 'x' }, rawIssue('DEMO-1')]) }) })
  const r = await rows.call('yt.issues.search', { server: 'one', query: '', offset: 0, limit: 10 })
  assert.deepEqual(r.data.issues.map((i) => i.id), ['DEMO-1'])
  const odd = setup({ yt: fakeYt({ listIssues: async () => ok({ issues: [] }) }) })
  const o = await odd.call('yt.issues.search', { server: 'one', query: '', offset: 0, limit: 10 })
  assert.deepEqual(o, fail('UNKNOWN', 'The youtrack CLI returned an unexpected answer.'))
})

test('the status bar flags a server list that is not a list', async () => {
  const orca = fakeOrca({ host: { 'statusBar.update': {} } })
  const bar = createStatusBar({
    host: orca.host, youtrack: { instances: async () => ok({ odd: true }), countIssues: async () => ok(1) },
    state: createStateStore(fakeStorage()), settings: orca.settings, setInterval: () => 1, clearInterval: () => {}
  })
  await bar.refresh()
  assert.deepEqual(orca.hostCalls.map((c) => c.params), [{ id: 'count', text: 'YT: !', tone: 'warning', visible: true }])
})

test('a failed task does not block later tasks of the same queue', async () => {
  const serial = createSerial()
  await assert.rejects(serial(async () => { throw new Error('first') }))
  assert.equal(await serial(async () => 2), 2)
  const store = createLinkStore({ get: async () => { throw new Error('read failed') }, set: async () => {} })
  await assert.rejects(store.add('s', 'A-1', 'w', 1))
})

test('a thrown error is logged by request name without its message', async () => {
  const logs = []
  const { call } = setup({
    yt: fakeYt({ instances: async () => { throw new Error('secret issue text') } }),
    orca: { log: (m) => logs.push(m) }
  })
  const r = await call('yt.savedQueries', { server: 'one' })
  assert.equal(r.ok, false)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /yt\.savedQueries/)
  assert.doesNotMatch(logs[0], /secret/)
})

test('answers that JSON cannot carry become failures', async () => {
  const cyclic = {}
  cyclic.self = cyclic
  for (const refs of [[cyclic], [10n], ['x'.repeat(2_000_000)]]) {
    const { call } = setup({ cli: fakeCli({ searchRefs: async () => ok(refs) }) })
    const r = await call('yt.refs.search', { repoId: 'r1', query: '' })
    assert.ok(isResult(r))
    assert.equal(r.ok, false)
  }
})

// Hostile inputs and hostile dependencies: every request must still answer with a Result.
const INPUTS = [
  null, undefined, {}, [], 'x', 42, true,
  { server: 5, id: {}, query: [], offset: 'a', limit: NaN, url: 7, name: null, repoId: {}, workspaceId: [], agent: 3, prompt: {}, command: {} },
  { server: 'one', id: 'DEMO-1', query: 'q', offset: -1, limit: 1e9, url: 'https://x.youtrack.cloud', name: 'n', repoId: 'r1', workspaceId: 'w', agent: 'claude', prompt: 'p', command: 'login' },
  { server: '__proto__', id: 'A-1', query: 'x'.repeat(5000), offset: 0, limit: 10, command: 'install' }
]
const GARBAGE = [null, undefined, 'text', 42, [], {}, [null], { a: { b: null } }]
const thrower = () => async () => { throw new Error('boom') }
const garbageYt = (g) =>
  Object.fromEntries(Object.keys(fakeYt()).map((k) => [k, async (...a) => (k === 'loginWeb' && typeof a[1] === 'function' && a[1](g), ok(g))]))
const garbageCli = (g) => Object.fromEntries(Object.keys(fakeCli()).map((k) => [k, async () => ok(g)]))
const garbageHost = (g) => ({ 'workspace.list': g, 'workspace.readContext': g, 'workspace.open': g, 'terminal.create': g, 'agent.launch': g })

function worlds() {
  const out = [
    { name: 'healthy', o: {} },
    { name: 'no CLIs', o: { yt: null, cli: null } },
    { name: 'everything throws', o: {
      yt: Object.fromEntries(Object.keys(fakeYt()).map((k) => [k, thrower()])),
      cli: Object.fromEntries(Object.keys(fakeCli()).map((k) => [k, thrower()])),
      host: Object.fromEntries(Object.keys(garbageHost(0)).map((k) => [k, () => { throw Object.assign(new Error('gone'), { code: 'unavailable' }) }])),
      storage: { links: 'x', launches: { a: 1 }, queries: [], server: 5 }
    } },
    { name: 'CLI answers are failures without detail', o: { yt: Object.fromEntries(Object.keys(fakeYt()).map((k) => [k, async () => ({ ok: false, error: {} })])) } }
  ]
  for (const g of GARBAGE) out.push({ name: `garbage ${JSON.stringify(g)}`, o: { yt: garbageYt(g), cli: garbageCli(g), host: garbageHost(g) } })
  return out
}

test('every request answers hostile inputs and hostile dependencies with a Result', async () => {
  const seen = await stray(async () => {
    for (const world of worlds()) {
      const { orca } = setup(world.o)
      for (const [name, fn] of orca.handlers) {
        for (const input of INPUTS) {
          const r = await fn(input)
          const where = `${world.name} / ${name} / ${JSON.stringify(input)}`
          assert.ok(isResult(r), `${where}: ${JSON.stringify(r)}`)
          assert.deepEqual(JSON.parse(JSON.stringify(r)), r, where)
        }
      }
    }
  })
  assert.deepEqual(seen.map(String), [])
})

test('a started workspace or agent is reported as started even when saving the link fails', async () => {
  const logs = []
  const { call, orca } = setup({ host: { 'agent.launch': { terminalId: 't9' } }, orca: { log: (m) => logs.push(m) } })
  orca.storage.set = async () => { throw new Error('disk full') }
  const run = await call('yt.start.run', { server: 'one', id: 'DEMO-1', repoId: 'r1', name: 'n', agent: 'claude', prompt: 'p' })
  assert.equal(run.ok, true)
  assert.equal(run.data.workspaceId, 'identity:new')
  assert.equal(typeof run.data.warning, 'string')
  const existing = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'claude', prompt: 'p' })
  assert.equal(existing.ok, true)
  assert.equal(existing.data.terminalId, 't9')
  assert.equal(typeof existing.data.warning, 'string')
  assert.ok(logs.length >= 2)
  assert.ok(logs.every((m) => !/disk full/.test(m)))
})

test('search answers each issue once', async () => {
  const { call } = setup({ yt: fakeYt({ listIssues: async () => ok([rawIssue('DEMO-1'), rawIssue('DEMO-1'), rawIssue('DEMO-2')]) }) })
  const r = await call('yt.issues.search', { server: 'one', query: '', offset: 0, limit: 10 })
  assert.deepEqual(r.data.issues.map((i) => i.id), ['DEMO-1', 'DEMO-2'])
})
