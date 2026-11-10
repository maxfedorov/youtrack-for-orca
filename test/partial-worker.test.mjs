import { test, assert } from 'orca/testing'
import { registerHandlers } from '../worker/handlers.mjs'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { createStateStore } from '../worker/state.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca } from './helpers.mjs'

const SERVERS = [{ alias: 'one', url: 'https://one.example.com', status: 'authenticated', active: true }]
const rawIssue = (id, over = {}) => ({
  idReadable: id, summary: `Fix ${id}`, created: 1, updated: 5, resolved: null,
  project: { shortName: 'DEMO', name: 'Demo' }, description: 'Body', customFields: [], ...over
})
const COMMENT = { id: 'c1', author: { login: 'a', fullName: 'A' }, created: 3, text: 'hi' }
const WS = [{ id: 'identity:feat', name: 'feat', project: 'demo-repo', path: '/w/demo-repo/feat', branch: 'feat' }]

function fakeYt(over = {}) {
  return {
    version: async () => ok('1.2.3'),
    instances: async () => ok(SERVERS),
    listIssues: async (s, q, off, lim) => ok(Array.from({ length: lim }, (_, i) => rawIssue(`DEMO-${off + i + 1}`))),
    countIssues: async () => ok(42),
    viewIssue: async (s, id) => ok(rawIssue(id)),
    listComments: async () => ok([COMMENT]),
    savedSearches: async () => ok([]),
    ...over
  }
}
const fakeCli = (over = {}) => ({
  repos: async () => ok([{ id: 'r1', name: 'demo-repo', path: '/w/demo-repo' }]),
  searchRefs: async () => ok(['main']),
  ...over
})

function setup({ yt = fakeYt(), cli = fakeCli(), host = {}, settings = {}, orca: patch, detectAgents } = {}) {
  const orca = fakeOrca({
    host: { 'workspace.list': { workspaces: WS, truncated: false }, 'workspace.readContext': { branch: 'feat', displayName: 'feat' }, ...host },
    settings: { defaultQuery: 'for: me', defaultAgent: 'claude', ...settings }
  })
  patch?.(orca)
  const state = createStateStore(orca.storage)
  registerHandlers(orca, {
    youtrack: yt, orcaCli: cli, links: createLinkStore(orca.storage), launches: createLaunchTracker(orca.storage), state, platform: 'darwin',
    detectAgents: detectAgents ?? (() => ({ installed: ['claude'], other: ['codex'] })),
    now: () => 1000
  })
  return { orca, call: (name, input) => orca.handlers.get(name)(input) }
}
const boom = () => {
  throw new Error('boom')
}

test('an issue whose comments fail to load is answered with a comments error', async () => {
  const { call } = setup({ yt: fakeYt({ listComments: async () => fail('NETWORK', 'down') }) })
  const r = await call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.ok, true)
  assert.equal(r.data.id, 'DEMO-1')
  assert.equal(r.data.descriptionMd, 'Body')
  assert.deepEqual(r.data.comments, [])
  assert.equal(r.data.commentsError, 'Comments could not be loaded.')
})

test('comments that throw or answer a non-list are a comments error, not a failed issue', async () => {
  for (const listComments of [async () => boom(), async () => ok({ odd: true })]) {
    const r = await setup({ yt: fakeYt({ listComments }) }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
    assert.equal(r.ok, true)
    assert.equal(r.data.commentsError, 'Comments could not be loaded.')
  }
})

test('an issue with its comments has no comments error', async () => {
  const r = await setup().call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.data.comments.length, 1)
  assert.equal('commentsError' in r.data, false)
})

test('the issue view failing still fails the whole issue', async () => {
  const r = await setup({ yt: fakeYt({ viewIssue: async () => fail('NOT_FOUND', 'gone') }) }).call('yt.issue.get', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.ok, false)
  assert.equal(r.error.message, 'gone')
})

test('issue.comments loads only the comments', async () => {
  let viewed = 0
  const { call } = setup({ yt: fakeYt({ viewIssue: async (s, id) => (viewed++, ok(rawIssue(id))) }) })
  const r = await call('yt.issue.comments', { server: 'one', id: 'DEMO-1' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data.comments.map((c) => c.textMd), ['hi'])
  assert.equal(viewed, 0)
  const bad = await call('yt.issue.comments', { server: 'one', id: '../x' })
  assert.equal(bad.ok, false)
  const down = await setup({ yt: fakeYt({ listComments: async () => fail('NETWORK', 'down') }) }).call('yt.issue.comments', { server: 'one', id: 'DEMO-1' })
  assert.equal(down.ok, false)
  assert.equal(down.error.message, 'down')
})

test('a search whose count throws still answers the rows, without a total', async () => {
  const r = await setup({ yt: fakeYt({ countIssues: async () => boom() }) }).call('yt.issues.search', { server: 'one', query: 'x', offset: 0, limit: 2 })
  assert.equal(r.ok, true)
  assert.equal(r.data.issues.length, 2)
  assert.equal('total' in r.data, false)
})

test('env answers servers when the version fails or throws', async () => {
  for (const version of [async () => fail('UNKNOWN', 'no'), async () => boom()]) {
    const r = await setup({ yt: fakeYt({ version }) }).call('yt.env')
    assert.equal(r.ok, true)
    assert.equal(r.data.cli.found, true)
    assert.equal('version' in r.data.cli, false)
    assert.equal(r.data.server, 'one')
  }
})

test('env answers when the settings or the stored server cannot be read', async () => {
  const unreadable = (orca) => {
    orca.settings.get = async () => boom()
    orca.storage.get = async () => boom()
  }
  const r = await setup({ orca: unreadable }).call('yt.env')
  assert.equal(r.ok, true)
  assert.equal(r.data.server, 'one')
  assert.equal(r.data.defaultQuery, '')
  assert.equal(r.data.query, '')
  assert.equal(r.data.cli.version, '1.2.3')
})

test('env keeps the CLI and Orca CLI state when the server list throws', async () => {
  const r = await setup({ yt: fakeYt({ instances: async () => boom() }) }).call('yt.env')
  assert.equal(r.ok, true)
  assert.equal(r.data.cli.found, true)
  assert.equal(r.data.orcaCli.found, true)
  assert.deepEqual(r.data.servers, [])
  assert.equal(r.data.error, 'boom')
})

const prepare = (o) => setup(o).call('yt.start.prepare', { server: 'one', id: 'DEMO-1' })

test('start.prepare without repositories still offers the workspaces', async () => {
  for (const repos of [async () => fail('ORCA_CLI_FAILED', 'repo list failed'), async () => boom()]) {
    const r = await prepare({ cli: fakeCli({ repos }) })
    assert.equal(r.ok, true)
    assert.deepEqual(r.data.repos, [])
    assert.equal(typeof r.data.reposError, 'string')
    assert.deepEqual(r.data.workspaces.map((w) => w.id), ['identity:feat'])
    assert.equal(r.data.defaultWorkspaceId, 'identity:feat')
  }
})

test('start.prepare without workspaces still offers new worktrees', async () => {
  const r = await prepare({ host: { 'workspace.list': () => boom() } })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data.workspaces, [])
  assert.equal(r.data.defaultWorkspaceId, null)
  assert.equal(r.data.workspacesError, 'boom')
  assert.deepEqual(r.data.repos.map((x) => x.id), ['r1'])
  assert.equal('reposError' in r.data, false)
})

test('start.prepare offers every agent as other when detection fails', async () => {
  const r = await prepare({ detectAgents: () => boom() })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data.agents.installed, [])
  assert.ok(r.data.agents.other.includes('claude'))
  assert.ok(r.data.agents.other.includes('codex'))
  assert.equal(r.data.agentsError, 'Installed agents could not be detected.')
  assert.equal(r.data.defaultAgent, 'claude')
})

test('start.prepare uses defaults when the settings cannot be read', async () => {
  const r = await prepare({ orca: (orca) => (orca.settings.get = async () => boom()) })
  assert.equal(r.ok, true)
  assert.equal(r.data.name, 'demo-1-fix-demo-1')
  assert.equal(r.data.launchMode, 'worktree')
  assert.equal(r.data.defaultAgent, '')
  assert.equal(r.data.defaultTemplateId, 'implement')
})

test('start.prepare builds vars with empty text for missing issue parts', async () => {
  const yt = fakeYt({ viewIssue: async (s, id) => ok({ idReadable: id, customFields: 'x', project: null }) })
  const r = await prepare({ yt })
  assert.equal(r.ok, true)
  assert.equal(r.data.vars.id, 'DEMO-1')
  for (const k of ['summary', 'state', 'assignee', 'priority', 'project', 'description']) assert.equal(r.data.vars[k], '')
  assert.equal(r.data.name, 'demo-1')
})

test('start.prepare fails only when the issue itself cannot be read', async () => {
  const r = await prepare({
    yt: fakeYt({ viewIssue: async () => fail('NOT_FOUND', 'gone') }),
    cli: fakeCli({ repos: async () => boom() }),
    host: { 'workspace.list': () => boom() }
  })
  assert.equal(r.ok, false)
  assert.equal(r.error.message, 'gone')
})

test('requests keep working when notifications, the command or the status bar cannot be set up', async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'yt-cli-'))
  const bin = join(dir, 'youtrack')
  writeFileSync(bin, '#!/bin/sh\necho "[]"\n')
  chmodSync(bin, 0o755)
  const main = await import('../worker/main.mjs')
  const orca = fakeOrca({ settings: { youtrackPath: bin } })
  orca.events = { on: () => boom() }
  orca.commands = { register: () => boom() }
  await main.default(orca)
  const r = await orca.handlers.get('yt.issue.comment')({ server: 'x', id: '-bad', text: 'x' })
  assert.deepEqual(r, fail('UNKNOWN', 'Invalid issue id'))
  await main.deactivate()
})
