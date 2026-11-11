import { test, assert } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { registerHandlers } from '../worker/handlers.mjs'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { createStateStore } from '../worker/state.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca } from './helpers.mjs'

const SERVERS = [
  { alias: 'one', url: 'https://one.example.com/', status: 'authenticated', active: false },
  { alias: 'two', url: 'https://two.example.com', status: 'authenticated', active: true },
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
    applyCommand: rec('applyCommand', () => ok({})),
    addComment: rec('addComment', () => ok({})),
    listLinks: rec('listLinks', () => ok([])),
    deleteInstance: rec('deleteInstance', () => ok({})),
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
    launchAgent: async (a) => (calls.push({ name: 'launchAgent', a }), ok({ terminalId: 't9', paneKey: 'tab:pane' })),
    ...over,
  }
}

function setup({ yt = fakeYt(), cli = fakeCli(), host = {}, settings = {}, platform = 'darwin', agents } = {}) {
  const orca = fakeOrca({
    host: { 'workspace.list': { workspaces: WS, truncated: false }, 'workspace.readContext': { branch: 'feat', displayName: 'feat', terminals: [] }, ...host },
    settings: { defaultQuery: 'for: me', branchTemplate: '{{id_lower}}-{{summary_slug}}', defaultAgent: 'claude', ...settings },
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
  assert.equal(r.data.issues[0].url, 'https://one.example.com/issue/DEMO-0')
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

test('issue.command applies the trimmed command to the issue on the chosen server', async () => {
  const { call, yt } = setup()
  assert.deepEqual(await call('yt.issue.command', { server: 'one', id: 'DEMO-1', command: '  State Done ' }), ok({}))
  assert.deepEqual(yt.calls.at(-1), { name: 'applyCommand', a: ['one', 'DEMO-1', 'State Done'] })
})

test('issue.command checks the id, the command and the server before running anything', async () => {
  const { call, yt } = setup()
  assert.deepEqual(await call('yt.issue.command', { server: 'one', id: '-DEMO-1', command: 'State Done' }), fail('UNKNOWN', 'Invalid issue id'))
  assert.deepEqual(await call('yt.issue.command', { server: 'one', id: 'DEMO-1', command: '   ' }), fail('UNKNOWN', 'Enter a command'))
  assert.deepEqual(await call('yt.issue.command', { server: 'one', id: 'DEMO-1', command: 7 }), fail('UNKNOWN', 'Enter a command'))
  assert.deepEqual(
    await call('yt.issue.command', { server: 'one', id: 'DEMO-1', command: 'x'.repeat(501) }),
    fail('UNKNOWN', 'A command is at most 500 characters')
  )
  assert.equal((await call('yt.issue.command', { server: 'nope', id: 'DEMO-1', command: 'State Done' })).ok, false)
  assert.equal(yt.calls.filter((c) => c.name === 'applyCommand').length, 0)
  assert.deepEqual(await call('yt.issue.command', { server: 'one', id: 'DEMO-1', command: 'x'.repeat(500) }), ok({}))
})

test('issue.command answers the CLI failure', async () => {
  const { call } = setup({ yt: fakeYt({ applyCommand: async () => fail('UNKNOWN', 'HTTP 400: Unknown command') }) })
  assert.deepEqual(await call('yt.issue.command', { server: 'one', id: 'DEMO-1', command: 'Stat' }), fail('UNKNOWN', 'HTTP 400: Unknown command'))
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
  assert.equal(d.vars.id, 'DEMO-3')
  assert.equal(d.vars.branch, '')
  assert.deepEqual(d.workspaces[2], { id: 'identity:dir', name: 'notes', project: 'n', path: '/n' })
  assert.deepEqual(d.workspaces[0], { id: 'identity:main', name: 'main', project: 'demo-repo', branch: 'main', path: '/p/demo-repo' })
  strict(r)
})

test('start.prepare names a workspace without a listed project by the repository holding it', async () => {
  const ws = [{ id: 'identity:main', kind: 'worktree', name: 'main', path: '/p/demo-repo', branch: 'main', hostId: 'local' }]
  const { call } = setup({ host: { 'workspace.list': { workspaces: ws, truncated: false } } })
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.deepEqual(r.data.workspaces, [{ id: 'identity:main', name: 'main', project: 'demo-repo', branch: 'main', path: '/p/demo-repo' }])
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
    issueId: 'DEMO-1', issueUrl: 'https://one.example.com/issue/DEMO-1',
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

test('runInExisting launches through the Orca CLI with the prompt and tracks the launch but not a link', async () => {
  const { call, orca, cli } = setup()
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'claude', prompt: 'Go' })
  assert.deepEqual(r, ok({ terminalId: 't9' }))
  assert.deepEqual(cli.calls, [{ name: 'launchAgent', a: { workspaceId: 'identity:main', agent: 'claude', prompt: 'Go' } }])
  // The host launch hands the prompt over separately and loses it while the agent starts.
  assert.equal(orca.hostCalls.some((c) => c.method === 'agent.launch'), false)
  const data = orca.storage.data()
  // Other agents may run in this workspace, so the launch is known by its terminal and pane only.
  assert.deepEqual(data.launches, [{ terminalId: 't9', paneKey: 'tab:pane', server: 'one', issueId: 'DEMO-1', workspaceId: 'identity:main', at: 1000, shared: true }])
  assert.equal(data.links, undefined)
})

test('runInExisting needs a known agent and omits a blank prompt', async () => {
  const { call, cli } = setup()
  const base = { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main' }
  assert.equal((await call('yt.runInExisting', { ...base, agent: '', prompt: 'x' })).ok, false)
  assert.equal((await call('yt.runInExisting', { ...base, agent: 'a b', prompt: 'x' })).ok, false)
  await call('yt.runInExisting', { ...base, agent: 'codex', prompt: '  ' })
  assert.deepEqual(cli.calls, [{ name: 'launchAgent', a: { workspaceId: 'identity:main', agent: 'codex' } }])
})

test('runInExisting returns a failed CLI launch and tracks nothing', async () => {
  const { call, orca } = setup({ cli: fakeCli({ launchAgent: async () => fail('ORCA_CLI_FAILED', 'no such worktree') }) })
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:x', agent: 'claude', prompt: 'x' })
  assert.deepEqual(r, fail('ORCA_CLI_FAILED', 'no such worktree'))
  assert.equal(orca.storage.data().launches, undefined)
})

test('runInExisting falls back to the host launch without the Orca CLI', async () => {
  const { call, orca } = setup({ cli: null, host: { 'agent.launch': { terminalId: 't7' } } })
  const r = await call('yt.runInExisting', { server: 'one', id: 'DEMO-1', workspaceId: 'identity:main', agent: 'claude', prompt: 'Go' })
  assert.deepEqual(r, ok({ terminalId: 't7' }))
  assert.deepEqual(orca.hostCalls.find((c) => c.method === 'agent.launch').params, { workspaceId: 'identity:main', agent: 'claude', prompt: 'Go' })
  assert.equal(orca.storage.data().launches[0].terminalId, 't7')
})

test('host errors become UNKNOWN results', async () => {
  const { call } = setup({ cli: null, host: { 'agent.launch': () => { throw new Error('workspace gone') } } })
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

test('opening a workspace that no longer exists drops its links', async () => {
  const { call, links, orca } = setup({ host: { 'workspace.open': () => { throw new Error('no workspace has this id') } } })
  await links.add('one', 'DEMO-2', 'identity:gone', 2)
  await links.add('one', 'DEMO-1', 'identity:feat', 1)
  const r = await call('yt.workspace.open', { workspaceId: 'identity:gone' })
  assert.deepEqual(r, fail('NOT_FOUND', 'That workspace no longer exists.'))
  assert.deepEqual(Object.keys(orca.storage.data().links), ['one|DEMO-1'])
})

test('a failed open of a listed workspace keeps its links and reports the error', async () => {
  const { call, links, orca } = setup({ host: { 'workspace.open': () => { throw new Error('busy') } } })
  await links.add('one', 'DEMO-1', 'identity:feat', 1)
  assert.deepEqual(await call('yt.workspace.open', { workspaceId: 'identity:feat' }), fail('UNKNOWN', 'busy'))
  assert.ok(orca.storage.data().links['one|DEMO-1'])
})

test('a failed open keeps links when the workspace list is truncated', async () => {
  const { call, links, orca } = setup({
    host: { 'workspace.open': () => { throw new Error('busy') }, 'workspace.list': { workspaces: [], truncated: true } }
  })
  await links.add('one', 'DEMO-2', 'identity:gone', 2)
  assert.deepEqual(await call('yt.workspace.open', { workspaceId: 'identity:gone' }), fail('UNKNOWN', 'busy'))
  assert.ok(orca.storage.data().links['one|DEMO-2'])
})

test('no handler opens terminals: sign-in and install are run by the person', async () => {
  const { orca } = setup()
  assert.equal(orca.handlers.has('yt.terminal.run'), false)
})

test('servers.add streams the auth url and posts the alias when done', async () => {
  const { call, orca } = setup({ yt: fakeYt({ instances: async () => ok([{ alias: 'new', url: 'https://new.example.com/', status: 'authenticated', active: false }]) }) })
  const r = await call('yt.servers.add', { url: 'https://new.example.com' })
  assert.deepEqual(r, ok({ started: true }))
  await posted(orca, 'yt.servers.added')
  assert.deepEqual(orca.posts[0], { name: 'yt.servers.authUrl', payload: { url: 'https://auth.example/x' } })
  assert.deepEqual(orca.posts[1], { name: 'yt.servers.added', payload: ok({ alias: 'new' }) })
  assert.equal((await call('yt.servers.add', { url: 'ftp://x' })).ok, false)
})

test('servers.add posts a failure result', async () => {
  const { call, orca } = setup({ yt: fakeYt({ loginWeb: async () => fail('AUTH_FAILED', 'denied') }) })
  await call('yt.servers.add', { url: 'https://new.example.com' })
  await posted(orca, 'yt.servers.added')
  assert.deepEqual(orca.posts.at(-1), { name: 'yt.servers.added', payload: fail('AUTH_FAILED', 'denied') })
})

test('unexpected exceptions become UNKNOWN', async () => {
  const { call } = setup({ yt: fakeYt({ instances: async () => { throw new Error('kaboom') } }) })
  assert.deepEqual(await call('yt.issues.search', { server: 'one', query: 'x', offset: 0, limit: 1 }), fail('UNKNOWN', 'kaboom'))
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
  const { call, orca } = setup({ cli: fakeCli({ launchAgent: async () => ok({}) }) })
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
  assert.equal(r.data.descriptionMd.length, 60_000)
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
  assert.equal(p.data.vars.description.length, 60_000)
})

test('servers.add survives an error thrown while finishing sign-in', async () => {
  const { call, orca } = setup({ yt: fakeYt({ instances: async () => { throw new Error('late') } }) })
  await call('yt.servers.add', { url: 'https://new.example.com' })
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
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') <= 400_000)
  assert.ok(Buffer.byteLength(r.data.descriptionMd, 'utf8') <= 60_000)
  assert.ok(r.data.comments.every((c) => Buffer.byteLength(c.textMd, 'utf8') <= 60_000))
  assert.ok(r.data.commentsOmitted > 0)
  assert.equal(r.data.truncated, true)
  assert.equal(r.data.comments.at(-1).id, 'c199')
  assert.equal(r.data.comments.length + r.data.commentsOmitted, 200)
})

test('cuts do not split surrogate pairs', async () => {
  const yt = fakeYt({ viewIssue: async (s, id) => ok({ ...rawIssue(id), description: '😀'.repeat(60_000) }) })
  const r = await setup({ yt }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  const d = r.data.descriptionMd
  assert.ok(Buffer.byteLength(d, 'utf8') <= 60_000 && Buffer.byteLength(d, 'utf8') > 59_990)
  assert.ok(!/[\ud800-\udbff]$/.test(d))
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(d))
})

test('env keeps cli and orcaCli when the YouTrack CLI vanished', async () => {
  const yt = fakeYt({ instances: async () => fail('CLI_NOT_FOUND', 'The YouTrack CLI was not found.') })
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

test('env re-resolves the YouTrack CLI on every call', async () => {
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
  let current = fakeYt({ instances: async () => fail('CLI_NOT_FOUND', 'The YouTrack CLI was not found.') })
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
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') <= 400_000)
  assert.ok(r.data.fields.length > 0)
  assert.ok(r.data.fields.every((f) => f.value.length <= 1000))
})

test('servers.remove deletes the server in the CLI and forgets what the plugin kept for it', async () => {
  const { call, yt, orca, state, links, launches } = setup()
  await state.setServer('one')
  await state.setQuery('one', 'q1')
  await state.setQuery('two', 'q2')
  await state.rememberProjectRepo('one', 'DEMO', 'r1')
  await state.setServerRepo('one', 'r1')
  await links.add('one', 'DEMO-1', 'identity:main', 1)
  await links.add('two', 'DEMO-2', 'identity:main', 1)
  await launches.track({ terminalId: 't1', server: 'one', issueId: 'DEMO-1', workspaceId: 'identity:main', at: 1 })
  const r = await call('yt.servers.remove', { server: 'one' })
  assert.deepEqual(r, { ok: true, data: {} })
  assert.deepEqual(yt.calls.find((c) => c.name === 'deleteInstance').a, ['one'])
  const data = orca.storage.data()
  assert.equal(data.server, null)
  assert.deepEqual(data.queries, { two: 'q2' })
  assert.deepEqual(Object.keys(data.links), ['two|DEMO-2'])
  assert.deepEqual(data.launches, [])
  assert.equal(await state.projectRepo('one', 'DEMO'), null)
  assert.deepEqual(await state.serverRepos(), {})
})

test('servers.remove refuses a bad server name and runs nothing', async () => {
  const { call, yt } = setup()
  for (const server of ['', 5, undefined]) {
    const r = await call('yt.servers.remove', { server })
    assert.equal(r.ok, false, String(server))
  }
  assert.equal(yt.calls.some((c) => c.name === 'deleteInstance'), false)
})

test('servers.remove of a server the CLI no longer lists only forgets its saved data', async () => {
  // A retry after a removal that timed out once the CLI had already deleted it.
  const { call, yt, state, links } = setup()
  await state.setQuery('gone', 'q')
  await links.add('gone', 'DEMO-1', 'identity:main', 1)
  assert.deepEqual(await call('yt.servers.remove', { server: 'gone' }), { ok: true, data: {} })
  assert.equal(yt.calls.some((c) => c.name === 'deleteInstance'), false)
  assert.equal(await state.getQuery('gone', 'd'), 'd')
  assert.deepEqual(await links.forServer('gone', new Set(['identity:main'])), {})
})

test('servers.remove passes on the CLI warning about the stored token', async () => {
  const yt = fakeYt({ deleteInstance: async () => ok({ warning: 'remove keyring token: access denied' }) })
  const r = await setup({ yt }).call('yt.servers.remove', { server: 'one' })
  assert.equal(r.ok, true)
  assert.match(r.data.warning, /sign-in token may still be stored.*access denied/s)
})

test('servers.remove passes a CLI failure through and keeps the stored data', async () => {
  const yt = fakeYt({ deleteInstance: async () => fail('UNKNOWN', 'config is locked') })
  const { call, state } = setup({ yt })
  await state.setQuery('one', 'q1')
  const r = await call('yt.servers.remove', { server: 'one' })
  assert.deepEqual(r, { ok: false, error: { code: 'UNKNOWN', message: 'config is locked' } })
  assert.equal(await state.getQuery('one', 'd'), 'q1')
})

test('servers.remove still succeeds with a warning when the stored data cannot be cleared', async () => {
  const { call, orca } = setup()
  orca.storage.set = async () => {
    throw new Error('storage full')
  }
  const r = await call('yt.servers.remove', { server: 'one' })
  assert.equal(r.ok, true)
  assert.match(r.data.warning, /removed/i)
})

const REPOS = [
  { id: 'r1', name: 'demo-repo', path: '/p/demo-repo' },
  { id: 'r2', name: 'other-repo', path: '/p/other-repo' },
  { id: 'r3', name: 'third-repo', path: '/p/third-repo' },
]
const threeRepos = () => fakeCli({ repos: async () => ok(REPOS) })

test('start.prepare offers the templates with the default one as the prompt', async () => {
  const { call } = setup()
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.deepEqual(r.data.templates.map((t) => t.id), ['implement', 'bugfix', 'tests', 'plan', 'refactor'])
  assert.equal(r.data.defaultTemplateId, 'implement')
  strict(r)
})

test('start.prepare still answers with the built-ins when the templates cannot be read', async () => {
  const { call, orca } = setup()
  const get = orca.storage.get
  orca.storage.get = async (key) => {
    if (key === 'templates') throw new Error('broken')
    return get(key)
  }
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.equal(r.ok, true)
  assert.equal(r.data.defaultTemplateId, 'implement')
  assert.equal(r.data.templates.length, 5)
})

test('template requests create, edit, delete, mark the default and restore', async () => {
  const { call } = setup()
  const created = await call('yt.templates.save', { name: 'Docs', body: 'Write docs for {{id}}' })
  assert.equal(created.ok, true)
  const id = created.data.id
  assert.equal((await call('yt.templates.setDefault', { id })).data.defaultId, id)
  assert.equal((await call('yt.templates.save', { id, name: 'Docs!', body: 'B' })).data.templates.at(-1).name, 'Docs!')
  assert.equal((await call('yt.templates.delete', { id: 'plan' })).ok, true)
  const restored = await call('yt.templates.restore', {})
  assert.ok(restored.data.templates.some((t) => t.id === 'plan'))
  const list = await call('yt.templates', {})
  assert.equal(list.data.defaultId, id)
  assert.equal(list.data.templates.length, 6)
  for (const bad of [{ id: 5 }, {}, { id: '--x' }]) {
    assert.equal((await call('yt.templates.delete', bad)).ok, false)
    assert.equal((await call('yt.templates.setDefault', bad)).ok, false)
  }
  strict(list)
})
test('the project chosen at Start is offered next time for issues of that YouTrack project', async () => {
  const { call, state } = setup({ cli: threeRepos() })
  assert.equal((await call('yt.start.run', { ...RUN, repoId: 'r2' })).ok, true)
  assert.equal(await state.projectRepo('one', 'DEMO'), 'r2')
  assert.equal((await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.defaultRepoId, 'r2')
  // Another server or another project does not use it.
  assert.equal((await call('yt.start.prepare', { server: 'two', id: 'DEMO-3' })).data.defaultRepoId, 'r1')
})

test('Start defaults to the remembered project, then the server default, then the current workspace', async () => {
  const { call, state } = setup({ cli: threeRepos() })
  const repo = async () => (await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.defaultRepoId
  assert.equal(await repo(), 'r1')
  await state.setServerRepo('one', 'r3')
  assert.equal(await repo(), 'r3')
  await state.rememberProjectRepo('one', 'DEMO', 'r2')
  assert.equal(await repo(), 'r2')
  // A remembered or default project that is no longer in Orca is skipped.
  await state.rememberProjectRepo('one', 'DEMO', 'gone')
  assert.equal(await repo(), 'r3')
  await state.setServerRepo('one', 'gone')
  assert.equal(await repo(), 'r1')
})

test('Start still prepares when the remembered projects cannot be read', async () => {
  const { call, orca } = setup({ cli: threeRepos() })
  const get = orca.storage.get
  orca.storage.get = async (key) => {
    if (key === 'projectRepos' || key === 'serverRepos') throw new Error('broken')
    return get(key)
  }
  const r = await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })
  assert.equal(r.data.defaultRepoId, 'r1')
})

test('a start that cannot remember its project still succeeds without a warning', async () => {
  const { call, orca } = setup({ cli: threeRepos() })
  const set = orca.storage.set
  orca.storage.set = async (key, value) => {
    if (key === 'projectRepos') throw new Error('full')
    return set(key, value)
  }
  assert.deepEqual(await call('yt.start.run', RUN), ok({ workspaceId: 'identity:new' }))
})

test('server defaults list the projects and each server default; setting one checks its input', async () => {
  const { call, state } = setup({ cli: threeRepos() })
  await state.setServerRepo('two', 'r2')
  assert.deepEqual((await call('yt.servers.defaults', {})).data, { repos: REPOS, defaults: { two: 'r2' } })
  assert.deepEqual(await call('yt.servers.setDefaultRepo', { server: 'one', repoId: 'r3' }), ok({}))
  assert.equal(await state.serverRepo('one'), 'r3')
  assert.deepEqual(await call('yt.servers.setDefaultRepo', { server: 'one', repoId: null }), ok({}))
  assert.equal(await state.serverRepo('one'), null)
  for (const bad of [{ server: 'zzz', repoId: 'r1' }, { server: 'one', repoId: '-x' }, { server: 'one', repoId: 5 }]) {
    assert.equal((await call('yt.servers.setDefaultRepo', bad)).ok, false, JSON.stringify(bad))
  }
})

test('server defaults answer without projects when they cannot be listed', async () => {
  const noCli = await setup({ cli: null }).call('yt.servers.defaults', {})
  assert.deepEqual(noCli.data, { repos: [], reposError: 'The Orca CLI was not found.', defaults: {} })
  const failing = await setup({ cli: fakeCli({ repos: async () => fail('ORCA_CLI_FAILED', 'orca is down') }) }).call('yt.servers.defaults', {})
  assert.deepEqual(failing.data, { repos: [], reposError: 'orca is down', defaults: {} })
})

test('issue.comment adds the trimmed text to the issue on the chosen server', async () => {
  const { call, yt } = setup()
  assert.deepEqual(await call('yt.issue.comment', { server: 'one', id: 'DEMO-1', text: '  Looks good\n' }), ok({}))
  assert.deepEqual(yt.calls.at(-1), { name: 'addComment', a: ['one', 'DEMO-1', 'Looks good'] })
})

test('issue.comment checks the id, the text and the server before running anything', async () => {
  const { call, yt } = setup()
  assert.deepEqual(await call('yt.issue.comment', { server: 'one', id: '-DEMO-1', text: 'x' }), fail('UNKNOWN', 'Invalid issue id'))
  assert.deepEqual(await call('yt.issue.comment', { server: 'one', id: 'DEMO-1', text: '  ' }), fail('UNKNOWN', 'Enter a comment'))
  assert.deepEqual(await call('yt.issue.comment', { server: 'one', id: 'DEMO-1', text: 7 }), fail('UNKNOWN', 'Enter a comment'))
  assert.deepEqual(
    await call('yt.issue.comment', { server: 'one', id: 'DEMO-1', text: 'x'.repeat(10_001) }),
    fail('UNKNOWN', 'A comment is at most 10000 characters')
  )
  assert.equal((await call('yt.issue.comment', { server: 'nope', id: 'DEMO-1', text: 'x' })).ok, false)
  assert.equal(yt.calls.filter((c) => c.name === 'addComment').length, 0)
})

test('issue.comment answers the CLI failure', async () => {
  const { call } = setup({ yt: fakeYt({ addComment: async () => fail('FORBIDDEN', 'HTTP 403: Forbidden') }) })
  assert.deepEqual(await call('yt.issue.comment', { server: 'one', id: 'DEMO-1', text: 'x' }), fail('FORBIDDEN', 'HTTP 403: Forbidden'))
})

test('start.prepare offers the workspace started for the issue before the focused one', async () => {
  const { call, links } = setup()
  await links.add('one', 'DEMO-3', 'identity:main', 1)
  assert.equal((await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.defaultWorkspaceId, 'identity:main')
  // a workspace that is gone is skipped
  await links.add('one', 'DEMO-4', 'identity:gone', 2)
  assert.equal((await call('yt.start.prepare', { server: 'one', id: 'DEMO-4' })).data.defaultWorkspaceId, 'identity:feat')
})

test('start.prepare does not guess between focused workspaces of the same name and branch', async () => {
  const twins = [
    { id: 'identity:a', kind: 'worktree', name: 'main', project: 'alpha', path: '/p/alpha', branch: 'main' },
    { id: 'identity:b', kind: 'worktree', name: 'main', project: 'beta', path: '/p/beta', branch: 'main' },
  ]
  const host = { 'workspace.list': { workspaces: twins, truncated: false }, 'workspace.readContext': { branch: 'main', displayName: 'main', terminals: [] } }
  const repos = async () => ok([{ id: 'ra', name: 'alpha', path: '/p/alpha' }, { id: 'rb', name: 'beta', path: '/p/beta' }])
  const { call, state } = setup({ host, cli: fakeCli({ repos }) })
  assert.equal((await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.defaultWorkspaceId, null)
  // the project remembered for DEMO settles it
  await state.rememberProjectRepo('one', 'DEMO', 'rb')
  assert.equal((await call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.defaultWorkspaceId, 'identity:b')
})

test('start.prepare passes the start-without-prompt setting', async () => {
  assert.equal((await setup().call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.withoutPrompt, false)
  const on = setup({ settings: { startWithoutPrompt: true } })
  assert.equal((await on.call('yt.start.prepare', { server: 'one', id: 'DEMO-3' })).data.withoutPrompt, true)
})

test('issue.get adds the linked issues, capped, and still answers when only they fail', async () => {
  const many = [{ direction: 'OUTWARD', linkType: { sourceToTarget: 'relates to' }, issues: Array.from({ length: 150 }, (_, i) => ({ idReadable: `DEMO-${i}`, summary: 's'.repeat(300) })) }]
  const { call } = setup({ yt: fakeYt({ listLinks: async () => ok(many) }) })
  const r = await call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.data.links[0].issues.length, 100)
  assert.equal(r.data.links[0].issues[0].summary.length, 200)
  const broken = setup({ yt: fakeYt({ listLinks: async () => fail('NETWORK', 'down') }) })
  const b = await broken.call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.equal(b.ok, true)
  assert.equal(b.data.linksError, 'Linked issues could not be loaded.')
})

test('issues.search reads the fields the columns setting names and answers them per row', async () => {
  const raw = { ...rawIssue('DEMO-1'), customFields: [{ name: 'Fix versions', $type: 'MultiVersionIssueCustomField', value: [{ name: '1.0' }, { name: '2.0' }] }] }
  const { call, yt } = setup({ settings: { columns: 'Fix versions, Nope' }, yt: fakeYt({ listIssues: async () => ok([raw]) }) })
  const listIssues = yt.listIssues
  const seen = []
  yt.listIssues = async (...a) => (seen.push(a), listIssues(...a))
  const r = await call('yt.issues.search', { server: 'one', query: 'q', offset: 0, limit: 10 })
  assert.deepEqual(r.data.columns, ['Fix versions', 'Nope'])
  assert.deepEqual(r.data.issues[0].fields, { 'field:fix versions': '1.0, 2.0' })
  assert.deepEqual(seen[0][4], ['Fix versions', 'Nope'])
})

test('issues.search reads only the custom fields of the columns setting, not the dates', async () => {
  const seen = []
  const yt = fakeYt()
  const listIssues = yt.listIssues
  yt.listIssues = async (...a) => (seen.push(a), listIssues(...a))
  const { call } = setup({ settings: { columns: 'Created, State, Updated' }, yt })
  const r = await call('yt.issues.search', { server: 'one', query: 'q', offset: 0, limit: 5 })
  assert.deepEqual(r.data.columns, ['Created', 'State', 'Updated'])
  assert.deepEqual(seen[0][4], ['State'])
})

test('settings.reset writes every declared setting back to its manifest default', async () => {
  const { SETTING_DEFAULTS } = await import('../worker/handlers/settings.mjs')
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(SETTING_DEFAULTS, Object.fromEntries(manifest.contributes.settings.map((s) => [s.key, s.default])))
  const { call, orca } = setup({ settings: { columns: 'State', defaultAgent: 'codex' } })
  assert.deepEqual(await call('yt.settings.reset', {}), ok({}))
  assert.equal(await orca.settings.get('columns'), SETTING_DEFAULTS.columns)
  assert.equal(await orca.settings.get('defaultAgent'), 'claude')
  orca.settings.set = async (key) => {
    if (key === 'columns') throw new Error('denied')
  }
  assert.deepEqual(await call('yt.settings.reset', {}), fail('UNKNOWN', 'Some settings could not be reset: columns'))
})
