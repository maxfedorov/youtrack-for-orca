import { test, assert } from 'orca/testing'
import { registerHandlers } from '../worker/handlers.mjs'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { createStateStore } from '../worker/state.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca } from './helpers.mjs'

const SERVERS = [
  { alias: 'one', url: 'https://one.youtrack.cloud/', status: 'authenticated', active: false },
  { alias: 'two', url: 'https://two.youtrack.cloud', status: 'authenticated', active: true },
]
const rawIssue = (id) => ({
  idReadable: id, summary: `Fix ${id}`, updated: 5, resolved: null,
  project: { shortName: 'DEMO', name: 'Demo' }, description: 'Body', customFields: [],
})
const WS = [
  { id: 'identity:main', kind: 'worktree', name: 'main', project: 'demo-repo', path: '/p/demo-repo', branch: 'main', hostId: 'local' },
  { id: 'identity:feat', kind: 'worktree', name: 'feat', project: 'demo-repo', path: '/w/demo-repo/feat', branch: 'refs/heads/feat', hostId: 'local' },
  { id: 'identity:dir', kind: 'folder', name: 'notes', project: null, path: '/n', branch: null, hostId: null },
]

function fakeYt(over = {}) {
  const calls = []
  const rec = (name, fn) => async (...a) => (calls.push({ name, a }), fn(...a))
  return {
    calls,
    version: rec('version', () => ok('1.2.3')),
    instances: rec('instances', () => ok(SERVERS)),
    listIssues: rec('listIssues', (s, q, off, lim) => ok(Array.from({ length: lim }, (_, i) => rawIssue(`DEMO-${off + i + 1}`)))),
    countIssues: rec('countIssues', () => ok(42)),
    viewIssue: rec('viewIssue', (s, id) => ok(rawIssue(id))),
    listComments: rec('listComments', () => ok([])),
    savedSearches: rec('savedSearches', () => ok([{ id: '0-1', name: 'Mine', query: 'for: me', extra: 1 }])),
    createSavedSearch: rec('createSavedSearch', (s, name, query) => ok({ id: '0-9', name, query })),
    loginWeb: rec('loginWeb', async (url, onAuth) => (onAuth('https://auth.example/x'), ok({}))),
    ...over,
  }
}

function fakeCli(over = {}) {
  const calls = []
  return {
    calls,
    repos: async () => ok([{ id: 'r1', name: 'demo-repo', path: '/p/demo-repo' }]),
    searchRefs: async (repoId, q) => (calls.push({ name: 'searchRefs', repoId, q }), ok(['main'])),
    createWorktree: async (a) => (calls.push({ name: 'createWorktree', a }), ok({ workspaceId: 'identity:new', name: a.name, branch: 'b' })),
    ...over,
  }
}

function setup({ yt = fakeYt(), cli = fakeCli(), host = {}, settings = {}, platform = 'darwin', agents } = {}) {
  const orca = fakeOrca({
    host: { 'workspace.list': { workspaces: WS, truncated: false }, 'workspace.readContext': { branch: 'feat', displayName: 'feat', terminals: [] }, ...host },
    settings: { defaultQuery: 'for: me', branchTemplate: '{{id_lower}}-{{summary_slug}}', promptTemplate: 'Do {{id}}', defaultAgent: 'claude', ...settings },
  })
  const links = createLinkStore(orca.storage)
  const launches = createLaunchTracker(orca.storage)
  const state = createStateStore(orca.storage)
  registerHandlers(orca, {
    youtrack: yt, orcaCli: cli, links, launches, state, platform,
    detectAgents: () => agents ?? { installed: ['claude'], other: ['codex'] },
    now: () => 1000,
  })
  const call = (name, input) => orca.handlers.get(name)(input)
  return { orca, yt, cli, call, links, launches, state }
}

async function posted(orca, name) {
  for (let i = 0; i < 200 && !orca.posts.some((p) => p.name === name); i++) await new Promise((r) => setImmediate(r))
  assert.ok(orca.posts.some((p) => p.name === name), `no ${name} event`)
}
const strict = (v) => assert.deepEqual(JSON.parse(JSON.stringify(v)), v)

test('env reports CLI_NOT_FOUND when youtrack is null', async () => {
  const { call } = setup({ yt: null })
  const r = await call('yt.env')
  assert.equal(r.ok, true)
  assert.equal(r.data.cli.found, false)
  assert.equal(r.data.orcaCli.found, true)
  assert.deepEqual(r.data.servers, [])
  assert.equal(r.data.cli.installCommand, 'brew install jetbrains/utils/youtrack')
  assert.equal((await setup({ yt: null, platform: 'win32' }).call('yt.env')).data.cli.installCommand, 'winget install JetBrains.YouTrackCLI')
  assert.equal('installCommand' in (await setup({ yt: null, platform: 'plan9' }).call('yt.env')).data.cli, false)
  const s = await call('yt.issues.search', { server: 'one', query: '', offset: 0, limit: 10 })
  assert.equal(s.error.code, 'CLI_NOT_FOUND')
})

test('env lists servers, version and the stored query', async () => {
  const { call, state } = setup()
  await state.setQuery('two', 'project: DEMO')
  const r = await call('yt.env')
  assert.equal(r.data.cli.version, '1.2.3')
  assert.equal(r.data.server, 'two')
  assert.equal(r.data.query, 'project: DEMO')
  assert.equal(r.data.servers.length, 2)
  strict(r)
})

test('env also reports the default query setting', async () => {
  const withSetting = await setup({ settings: { defaultQuery: 'project: DEMO #Unresolved' } }).call('yt.env')
  assert.equal(withSetting.data.defaultQuery, 'project: DEMO #Unresolved')
  const { call, state } = setup({ settings: { defaultQuery: 'for: me' } })
  await state.setQuery('two', 'project: X')
  const r = await call('yt.env')
  assert.equal(r.data.query, 'project: X')
  assert.equal(r.data.defaultQuery, 'for: me')
})

test('falls back to active server when stored alias is gone', async () => {
  const { call, state } = setup()
  await state.setServer('removed')
  assert.equal((await call('yt.env')).data.server, 'two')
  await state.setServer('one')
  assert.equal((await call('yt.env')).data.server, 'one')
})

test('setServer and setQuery validate before saving', async () => {
  const { call, state } = setup()
  assert.equal((await call('yt.setServer', { server: 'nope' })).ok, false)
  assert.equal(await state.getServer(), null)
  assert.equal((await call('yt.setServer', { server: 'one' })).ok, true)
  assert.equal(await state.getServer(), 'one')
  assert.equal((await call('yt.setQuery', { server: 'one', query: 'x'.repeat(2001) })).ok, false)
  assert.equal((await call('yt.setQuery', { server: 'one', query: 'a b' })).ok, true)
  assert.equal(await state.getQuery('one', ''), 'a b')
})

test('search returns rows, hasMore and total only on the first page', async () => {
  const { call, yt } = setup({ yt: fakeYt({ listIssues: async (s, q, off, lim) => ok(Array.from({ length: Math.min(lim, 11) }, (_, i) => rawIssue(`DEMO-${i}`))) }) })
  const r = await call('yt.issues.search', { server: 'one', query: 'q', offset: 0, limit: 10 })
  assert.equal(r.data.issues.length, 10)
  assert.equal(r.data.hasMore, true)
  assert.equal(r.data.total, 42)
  assert.equal(r.data.issues[0].url, 'https://one.youtrack.cloud/issue/DEMO-0')
  const r2 = await call('yt.issues.search', { server: 'one', query: 'q', offset: 10, limit: 10 })
  assert.ok(!('total' in r2.data))
  assert.equal(yt.calls.filter((c) => c.name === 'countIssues').length, 1)
  strict(r)
})

test('search caps offset+limit at 500', async () => {
  const { call, yt } = setup()
  const r = await call('yt.issues.search', { server: 'one', query: '', offset: 480, limit: 50 })
  const list = yt.calls.find((c) => c.name === 'listIssues')
  assert.equal(list.a[3], 20)
  assert.equal(r.data.issues.length, 20)
  assert.equal(r.data.hasMore, false)
  const past = await call('yt.issues.search', { server: 'one', query: '', offset: 500, limit: 50 })
  assert.deepEqual(past.data.issues, [])
  assert.equal(past.data.hasMore, false)
  assert.equal(yt.calls.filter((c) => c.name === 'listIssues').length, 1)
})

test('search clamps limit to 50 and rejects bad input', async () => {
  const { call, yt } = setup()
  const r = await call('yt.issues.search', { server: 'one', query: '', offset: 0, limit: 999 })
  assert.equal(r.data.issues.length, 50)
  assert.equal(r.data.hasMore, true)
  assert.equal(yt.calls.find((c) => c.name === 'listIssues').a[3], 51)
  assert.equal((await call('yt.issues.search', { server: 'one', query: 'x'.repeat(2001), offset: 0, limit: 10 })).ok, false)
  assert.equal((await call('yt.issues.search', { server: 'nope', query: '', offset: 0, limit: 10 })).ok, false)
  assert.equal((await call('yt.issues.search', { server: 'one', query: '', offset: -1, limit: 10 })).ok, false)
})

test('search passes a CLI failure through', async () => {
  const { call } = setup({ yt: fakeYt({ listIssues: async () => fail('QUERY_INVALID', 'bad') }) })
  const r = await call('yt.issues.search', { server: 'one', query: 'x', offset: 0, limit: 10 })
  assert.equal(r.error.code, 'QUERY_INVALID')
})

test('issue.get combines view and comments and validates the id', async () => {
  const { call } = setup({ yt: fakeYt({ listComments: async () => ok([{ id: 'c1', author: { login: 'a', fullName: 'A' }, created: 3, text: 'hi' }]) }) })
  const r = await call('yt.issue.get', { server: 'two', id: 'DEMO-7' })
  assert.equal(r.data.id, 'DEMO-7')
  assert.equal(r.data.comments[0].textMd, 'hi')
  assert.equal(r.data.descriptionMd, 'Body')
  for (const id of ['-h', '--server', 'DEMO', 'DEMO-1; ls', '']) {
    const bad = await call('yt.issue.get', { server: 'two', id })
    assert.deepEqual(bad, fail('UNKNOWN', 'Invalid issue id'))
  }
})

test('saved queries are listed and created', async () => {
  const { call } = setup()
  const l = await call('yt.savedQueries', { server: 'one' })
  assert.deepEqual(l.data, [{ id: '0-1', name: 'Mine', query: 'for: me' }])
  const c = await call('yt.savedQueries.create', { server: 'one', name: 'N', query: 'q' })
  assert.deepEqual(c.data, { id: '0-9', name: 'N', query: 'q' })
  assert.equal((await call('yt.savedQueries.create', { server: 'one', name: 'n'.repeat(61), query: 'q' })).ok, false)
  assert.equal((await call('yt.savedQueries.create', { server: 'one', name: '  ', query: 'q' })).ok, false)
})

test('start.prepare gathers repos, workspaces, agents, name and vars', async () => {
  const { call } = setup({ settings: { launchMode: undefined, defaultLaunchMode: 'current', includeDescription: true } })
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.equal(r.ok, true)
  const d = r.data
  assert.deepEqual(d.repos, [{ id: 'r1', name: 'demo-repo', path: '/p/demo-repo' }])
  assert.equal(d.orcaCli, true)
  assert.equal(d.defaultWorkspaceId, 'identity:feat')
  assert.equal(d.defaultRepoId, 'r1')
  assert.equal(d.name, 'demo-3-fix-demo-3')
  assert.deepEqual(d.agents, { installed: ['claude'], other: ['codex'] })
  assert.equal(d.defaultAgent, 'claude')
  assert.equal(d.launchMode, 'current')
  assert.equal(d.includeDescription, true)
  assert.equal(d.promptTemplate, 'Do {{id}}')
  assert.equal(d.vars.id, 'DEMO-3')
  assert.equal(d.vars.branch, '')
  assert.deepEqual(d.workspaces[2], { id: 'identity:dir', name: 'notes' })
  assert.deepEqual(d.workspaces[0], { id: 'identity:main', name: 'main', project: 'demo-repo', branch: 'main' })
  strict(r)
})

test('start.prepare without orcaCli or a matching workspace', async () => {
  const { call } = setup({ cli: null, host: { 'workspace.readContext': null }, settings: { defaultAgent: '' } })
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.deepEqual(r.data.repos, [])
  assert.equal(r.data.orcaCli, false)
  assert.equal(r.data.defaultWorkspaceId, null)
  assert.equal(r.data.defaultRepoId, null)
  assert.equal(r.data.defaultAgent, '')
  assert.equal(r.data.launchMode, 'worktree')
})

test('refs.search forwards to the Orca CLI', async () => {
  const { call, cli } = setup()
  const r = await call('yt.refs.search', { repoId: 'r1', query: 'ma' })
  assert.deepEqual(r.data, { refs: ['main'] })
  assert.deepEqual(cli.calls[0], { name: 'searchRefs', repoId: 'r1', q: 'ma' })
  assert.equal((await setup({ cli: null }).call('yt.refs.search', { repoId: 'r1', query: '' })).error.code, 'ORCA_CLI_NOT_FOUND')
})

const RUN = { server: 'one', id: 'DEMO-1', repoId: 'r1', name: 'demo-1-x', agent: 'claude', prompt: 'Go' }

test('start.run stores link and launch', async () => {
  const { call, cli, links, launches, orca } = setup()
  const r = await call('yt.start.run', { ...RUN, baseBranch: 'origin/dev' })
  assert.deepEqual(r, ok({ workspaceId: 'identity:new' }))
  assert.deepEqual(cli.calls[0].a, {
    repoId: 'r1', name: 'demo-1-x', baseBranch: 'origin/dev', agent: 'claude', prompt: 'Go',
    issueId: 'DEMO-1', issueUrl: 'https://one.youtrack.cloud/issue/DEMO-1',
  })
  assert.deepEqual(await links.forServer('one', new Set(['identity:new'])), { 'DEMO-1': 'identity:new' })
  assert.deepEqual(orca.storage.data().launches, [{ terminalId: 'identity:new', server: 'one', issueId: 'DEMO-1', workspaceId: 'identity:new', at: 1000 }])
})

test('start.run without agent links but does not track a launch', async () => {
  const { call, cli, orca } = setup()
  const r = await call('yt.start.run', { ...RUN, agent: '', prompt: 'ignored' })
  assert.equal(r.ok, true)
  assert.equal(cli.calls[0].a.agent, undefined)
  assert.equal(cli.calls[0].a.prompt, undefined)
  assert.equal(orca.storage.data().launches, undefined)
  assert.equal(orca.storage.data().links['one|DEMO-1'].length, 1)
})

test('start.run failure stores nothing', async () => {
  const { call, orca } = setup({ cli: fakeCli({ createWorktree: async () => fail('ORCA_CLI_FAILED', 'boom') }) })
  const r = await call('yt.start.run', RUN)
  assert.equal(r.error.message, 'boom')
  assert.deepEqual(orca.storage.data(), {})
})

test('start.run with null orcaCli → ORCA_CLI_NOT_FOUND', async () => {
  const r = await setup({ cli: null }).call('yt.start.run', RUN)
  assert.equal(r.error.code, 'ORCA_CLI_NOT_FOUND')
})

test('start.run validates input before touching the CLI', async () => {
  const { call, cli } = setup()
  const bad = [
    { id: '--x-1' }, { server: 'nope' }, { repoId: '' }, { repoId: '-r' }, { name: '' }, { name: '-n' },
    { baseBranch: '--x' }, { agent: 'rm -rf' }, { agent: '-x' }, { name: '  -n ' }, { prompt: 5 },
  ]
  for (const b of bad) assert.equal((await call('yt.start.run', { ...RUN, ...b })).ok, false, JSON.stringify(b))
  assert.equal(cli.calls.length, 0)
})

test('prompt over 4096 → invalid', async () => {
  const { call, cli } = setup()
  const long = 'x'.repeat(4097)
  assert.deepEqual(await call('yt.start.run', { ...RUN, prompt: long }), fail('PROMPT_TOO_LONG', 'Prompt is longer than 4096 characters'))
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'claude', prompt: long })
  assert.equal(r.error.code, 'PROMPT_TOO_LONG')
  assert.equal(cli.calls.length, 0)
  assert.equal((await call('yt.start.run', { ...RUN, prompt: 'x'.repeat(4096) })).ok, true)
})

test('runInExisting tracks launch but not link', async () => {
  const { call, orca } = setup({ host: { 'agent.launch': { terminalId: 't9' } } })
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'claude', prompt: 'Go' })
  assert.deepEqual(r, ok({ terminalId: 't9' }))
  const launch = orca.hostCalls.find((c) => c.method === 'agent.launch')
  assert.deepEqual(launch.params, { workspaceId: 'identity:main', agent: 'claude', prompt: 'Go' })
  const data = orca.storage.data()
  assert.deepEqual(data.launches, [{ terminalId: 't9', server: 'one', issueId: 'DEMO-1', workspaceId: 'identity:main', at: 1000 }])
  assert.equal(data.links, undefined)
})

test('runInExisting needs a known agent and omits a blank prompt', async () => {
  const { call, orca } = setup({ host: { 'agent.launch': { terminalId: 't9' } } })
  const base = { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main' }
  assert.equal((await call('yt.runInExisting', { ...base, agent: '', prompt: 'x' })).ok, false)
  assert.equal((await call('yt.runInExisting', { ...base, agent: 'a b', prompt: 'x' })).ok, false)
  await call('yt.runInExisting', { ...base, agent: 'codex', prompt: '  ' })
  assert.deepEqual(orca.hostCalls.find((c) => c.method === 'agent.launch').params, { workspaceId: 'identity:main', agent: 'codex' })
})

test('host errors become UNKNOWN results', async () => {
  const { call } = setup({ host: { 'agent.launch': () => { throw new Error('workspace gone') } } })
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:x', agent: 'claude', prompt: 'x' })
  assert.deepEqual(r, fail('UNKNOWN', 'workspace gone'))
})

test('links prunes dead workspaces and maps issues to live ones', async () => {
  const { call, links, orca } = setup()
  await links.add('one', 'DEMO-1', 'identity:feat', 1)
  await links.add('one', 'DEMO-2', 'identity:gone', 2)
  await links.add('two', 'DEMO-3', 'identity:main', 3)
  const r = await call('yt.links', { server: 'one' })
  assert.deepEqual(r, ok({ 'DEMO-1': 'identity:feat' }))
  assert.equal(orca.storage.data().links['one|DEMO-2'], undefined)
  assert.ok(orca.storage.data().links['two|DEMO-3'])
})

test('links does not prune when the workspace list is truncated', async () => {
  const { call, links, orca } = setup({ host: { 'workspace.list': { workspaces: [WS[1]], truncated: true } } })
  await links.add('one', 'DEMO-2', 'identity:gone', 2)
  await call('yt.links', { server: 'one' })
  assert.ok(orca.storage.data().links['one|DEMO-2'])
})

test('workspace.open calls the host', async () => {
  const { call, orca } = setup({ host: { 'workspace.open': { opened: true } } })
  assert.deepEqual(await call('yt.workspace.open', { workspaceId: 'identity:feat' }), ok({}))
  assert.deepEqual(orca.hostCalls.at(-1), { method: 'workspace.open', params: { workspaceId: 'identity:feat' } })
})

test('install command matches platform', async () => {
  const cases = { darwin: 'brew install jetbrains/utils/youtrack', linux: 'brew install jetbrains/utils/youtrack', win32: 'winget install JetBrains.YouTrackCLI' }
  for (const [platform, command] of Object.entries(cases)) {
    const { call, orca } = setup({ platform, host: { 'terminal.create': { terminalId: 't' } } })
    const r = await call('yt.terminal.run', { command: 'install' })
    assert.equal(r.ok, true)
    const t = orca.hostCalls.find((c) => c.method === 'terminal.create')
    assert.equal(t.params.command, command)
    assert.equal(t.params.workspaceId, 'identity:feat')
  }
  assert.equal((await setup({ platform: 'plan9' }).call('yt.terminal.run', { command: 'install' })).ok, false)
})

test('login command is built only from a plain http(s) url', async () => {
  const { call, orca } = setup({ host: { 'terminal.create': { terminalId: 't' } } })
  assert.equal((await call('yt.terminal.run', { command: 'login', url: 'https://example.youtrack.cloud' })).ok, true)
  assert.equal(orca.hostCalls.at(-1).params.command, 'youtrack auth login https://example.youtrack.cloud')
  for (const url of ['https://x.io; rm -rf ~', 'file:///etc/passwd', "https://x.io/'$(id)", '--web', undefined]) {
    assert.equal((await call('yt.terminal.run', { command: 'login', url })).ok, false, String(url))
  }
  assert.equal((await call('yt.terminal.run', { command: 'other' })).ok, false)
})

test('terminal.run needs an active workspace', async () => {
  const { call } = setup({ host: { 'workspace.readContext': null, 'terminal.create': { terminalId: 't' } } })
  assert.equal((await call('yt.terminal.run', { command: 'install' })).ok, false)
})

test('servers.add streams the auth url and posts the alias when done', async () => {
  const { call, orca } = setup({ yt: fakeYt({ instances: async () => ok([{ alias: 'new', url: 'https://new.youtrack.cloud/', status: 'authenticated', active: false }]) }) })
  const r = await call('yt.servers.add', { url: 'https://new.youtrack.cloud' })
  assert.deepEqual(r, ok({ started: true }))
  await posted(orca, 'yt.servers.added')
  assert.deepEqual(orca.posts[0], { name: 'yt.servers.authUrl', payload: { url: 'https://auth.example/x' } })
  assert.deepEqual(orca.posts[1], { name: 'yt.servers.added', payload: ok({ alias: 'new' }) })
  assert.equal((await call('yt.servers.add', { url: 'ftp://x' })).ok, false)
})

test('servers.add posts a failure result', async () => {
  const { call, orca } = setup({ yt: fakeYt({ loginWeb: async () => fail('AUTH_FAILED', 'denied') }) })
  await call('yt.servers.add', { url: 'https://new.youtrack.cloud' })
  await posted(orca, 'yt.servers.added')
  assert.deepEqual(orca.posts.at(-1), { name: 'yt.servers.added', payload: fail('AUTH_FAILED', 'denied') })
})

test('unexpected exceptions become UNKNOWN', async () => {
  const { call } = setup({ yt: fakeYt({ instances: async () => { throw new Error('kaboom') } }) })
  assert.deepEqual(await call('yt.env'), fail('UNKNOWN', 'kaboom'))
})

test('any well-formed agent id is accepted, even if not detected', async () => {
  const { call, cli } = setup({ host: { 'agent.launch': { terminalId: 't' } } })
  assert.equal((await call('yt.start.run', { ...RUN, agent: 'my-agent2' })).ok, true)
  assert.equal(cli.calls[0].a.agent, 'my-agent2')
  assert.equal((await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'my-agent2', prompt: '' })).ok, true)
})

test('start.prepare keeps the default agent setting even when not detected', async () => {
  const a = await setup({ settings: { defaultAgent: 'zzz-agent' } }).call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.equal(a.data.defaultAgent, 'zzz-agent')
  const b = await setup({ settings: { defaultAgent: '' } }).call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.equal(b.data.defaultAgent, '')
})

test('runInExisting without a terminal id still succeeds and tracks the workspace', async () => {
  const { call, orca } = setup({ host: { 'agent.launch': {} } })
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'claude', prompt: 'x' })
  assert.deepEqual(r, ok({}))
  assert.equal(orca.storage.data().launches[0].terminalId, 'identity:main')
})

const bigYt = () => fakeYt({
  viewIssue: async (s, id) => ok({ ...rawIssue(id), description: 'd'.repeat(100_001) }),
  listComments: async () => ok(Array.from({ length: 205 }, (_, i) => ({
    id: `c${i}`, author: { login: 'a', fullName: 'A' }, created: i, text: i === 204 ? 'y'.repeat(20_001) : 'ok',
  }))),
})

test('issue.get caps description, comment text and comment count', async () => {
  const r = await setup({ yt: bigYt() }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.data.descriptionMd.length, 100_000)
  assert.equal(r.data.comments.length, 200)
  assert.equal(r.data.comments[0].id, 'c5')
  assert.equal(r.data.comments[199].textMd.length, 20_000)
  assert.equal(r.data.comments[199].truncated, true)
  assert.ok(!('truncated' in r.data.comments[0]))
  assert.equal(r.data.truncated, true)
  assert.ok(JSON.stringify(r).length < 1024 * 1024)
  strict(r)
})

test('small issues carry no truncated flag; prepare caps the description in vars', async () => {
  const small = await setup().call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.ok(!('truncated' in small.data))
  const p = await setup({ yt: bigYt() }).call('yt.start.prepare', { server: 'one', id: 'DEMO-1' })
  assert.equal(p.data.vars.description.length, 100_000)
})

test('servers.add survives an error thrown while finishing sign-in', async () => {
  const { call, orca } = setup({ yt: fakeYt({ instances: async () => { throw new Error('late') } }) })
  await call('yt.servers.add', { url: 'https://new.youtrack.cloud' })
  await posted(orca, 'yt.servers.added')
  assert.equal(orca.posts.at(-1).payload.ok, false)
})

test('issue answers stay within the byte budget for multibyte text', async () => {
  const yt = fakeYt({
    viewIssue: async (s, id) => ok({ ...rawIssue(id), description: 'ж'.repeat(100_000) }),
    listComments: async () => ok(Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`, author: { login: 'a', fullName: 'A' }, created: i, text: 'ж'.repeat(20_000),
    }))),
  })
  const r = await setup({ yt }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') <= 900_000)
  assert.ok(r.data.commentsOmitted > 0)
  assert.equal(r.data.truncated, true)
  assert.equal(r.data.comments.at(-1).id, 'c199')
  assert.equal(r.data.comments.length + r.data.commentsOmitted, 200)
})

test('cuts do not split surrogate pairs', async () => {
  const yt = fakeYt({ viewIssue: async (s, id) => ok({ ...rawIssue(id), description: '😀'.repeat(60_000) }) })
  const r = await setup({ yt }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  const d = r.data.descriptionMd
  assert.equal(d.length, 100_000)
  assert.ok(!/[\ud800-\udbff]$/.test(d))
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(d))
})

test('env keeps cli and orcaCli when the youtrack CLI vanished', async () => {
  const yt = fakeYt({ instances: async () => fail('CLI_NOT_FOUND', 'The youtrack CLI was not found.') })
  const { call } = setup({ yt })
  const r = await call('yt.env')
  assert.equal(r.ok, true)
  assert.equal(r.data.cli.found, false)
  assert.equal(r.data.orcaCli.found, true)
  assert.deepEqual(r.data.servers, [])
  strict(r)
})

test('env keeps cli and orcaCli with the error when the instance list fails', async () => {
  const yt = fakeYt({ instances: async () => fail('UNKNOWN', 'broken config') })
  const { call } = setup({ yt })
  const r = await call('yt.env')
  assert.equal(r.ok, true)
  assert.equal(r.data.cli.found, true)
  assert.equal(r.data.orcaCli.found, true)
  assert.equal(r.data.error, 'broken config')
  assert.deepEqual(r.data.servers, [])
  strict(r)
})

test('env re-resolves the youtrack CLI on every call', async () => {
  const yt = fakeYt()
  let current = null
  const orca = fakeOrca({ host: {}, settings: {} })
  registerHandlers(orca, {
    getYoutrack: () => current, refreshYoutrack: async () => { current = yt },
    orcaCli: null, links: createLinkStore(orca.storage), launches: createLaunchTracker(orca.storage),
    state: createStateStore(orca.storage), detectAgents: () => ({ installed: [], other: [] }), now: () => 1, platform: 'darwin',
  })
  const r = await orca.handlers.get('yt.env')({})
  assert.equal(r.data.cli.found, true)
  assert.equal(r.data.servers.length, 2)
})

test('a request that finds the CLI gone refreshes the resolved CLI', async () => {
  let refreshed = 0
  let current = fakeYt({ instances: async () => fail('CLI_NOT_FOUND', 'The youtrack CLI was not found.') })
  const orca = fakeOrca({ host: {}, settings: {} })
  registerHandlers(orca, {
    getYoutrack: () => current, refreshYoutrack: async () => { refreshed++; current = null },
    orcaCli: null, links: createLinkStore(orca.storage), launches: createLaunchTracker(orca.storage),
    state: createStateStore(orca.storage), detectAgents: () => ({ installed: [], other: [] }), now: () => 1, platform: 'darwin',
  })
  const r = await orca.handlers.get('yt.issues.search')({ server: 'one', query: '', offset: 0, limit: 5 })
  assert.equal(r.error.code, 'CLI_NOT_FOUND')
  assert.equal(refreshed, 1)
  const again = await orca.handlers.get('yt.issues.search')({ server: 'one', query: '', offset: 0, limit: 5 })
  assert.equal(again.error.code, 'CLI_NOT_FOUND')
})

test('links keeps a link created after the workspace list was read', async () => {
  const { call, links, orca } = setup({ host: { 'workspace.list': async () => {
    await links_add_during_list()
    return { workspaces: WS, truncated: false }
  } } })
  async function links_add_during_list() { await links.add('one', 'DEMO-9', 'identity:fresh', 1000) }
  await call('yt.links', { server: 'one' })
  assert.deepEqual(Object.keys(orca.storage.data().links), ['one|DEMO-9'])
})

test('start.run tracks the launch by terminal handle and keeps the workspace id', async () => {
  const cli = fakeCli({ createWorktree: async (a) => ok({ workspaceId: 'identity:new', name: a.name, branch: 'b', terminalId: 'term_1', paneKey: 'tab:pane' }) })
  const { call, orca } = setup({ cli })
  await call('yt.start.run', RUN)
  assert.deepEqual(orca.storage.data().launches, [
    { terminalId: 'term_1', paneKey: 'tab:pane', server: 'one', issueId: 'DEMO-1', workspaceId: 'identity:new', at: 1000 },
  ])
})

test('odd records from the CLI do not break env or saved searches', async () => {
  const yt = fakeYt({
    instances: async () => ok([{ alias: 'solo' }, { url: 'x' }]),
    savedSearches: async () => ok([{ id: '1', name: 'no query' }, { id: '2', name: 'ok', query: 'q' }]),
  })
  const { call } = setup({ yt })
  const env = await call('yt.env')
  assert.deepEqual(env.data.servers, [{ alias: 'solo', url: '', active: false, status: 'unknown' }])
  strict(env)
  const saved = await call('yt.savedQueries', { server: 'solo' })
  assert.deepEqual(saved.data, [{ id: '2', name: 'ok', query: 'q' }])
  strict(saved)
})

test('many large custom fields still fit the answer budget', async () => {
  const customFields = Array.from({ length: 300 }, (_, i) => ({
    name: `Field ${i}`, $type: 'TextIssueCustomField', value: { text: 'ж'.repeat(50_000) },
  }))
  const yt = fakeYt({ viewIssue: async (s, id) => ok({ ...rawIssue(id), description: 'ж'.repeat(100_000), customFields }) })
  const r = await setup({ yt }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') <= 900_000)
  assert.ok(r.data.fields.length > 0)
  assert.ok(r.data.fields.every((f) => f.value.length <= 1000))
})
