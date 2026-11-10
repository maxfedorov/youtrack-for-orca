import { test, assert } from 'orca/testing'
import { registerHandlers } from '../worker/handlers.mjs'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { createStateStore } from '../worker/state.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca } from './helpers.mjs'

const SERVERS = [{ alias: 'one', url: 'https://one.youtrack.cloud', status: 'authenticated', active: true }]
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
    settings: { defaultQuery: 'for: me', promptTemplate: 'Do {{id}} {{summary}} {{state}} {{assignee}}', defaultAgent: 'claude', ...settings }
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
