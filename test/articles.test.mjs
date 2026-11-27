import { test, assert } from 'orca/testing'
import { registerHandlers } from '../worker/handlers.mjs'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { createStateStore } from '../worker/state.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeOrca } from './helpers.mjs'

const SERVERS = [{ alias: 'one', url: 'https://one.example.com/', status: 'authenticated', active: true }]
const node = (id, ordinal, parent) => ({
  idReadable: id, summary: `Article ${id}`, hasChildren: false, hasStar: false, ordinal,
  ...(parent ? { parentArticle: { idReadable: parent, summary: `Article ${parent}` } } : { parentArticle: null }),
})

function fakeYt(over = {}) {
  const calls = []
  const rec = (name, fn) => async (...a) => (calls.push({ name, a }), fn(...a))
  return {
    calls,
    instances: rec('instances', () => ok(SERVERS)),
    scanArticles: rec('scanArticles', () => ok([node('DEMO-A-2', 2), node('DEMO-A-3', 0, 'DEMO-A-2'), node('DEMO-A-1', 1)])),
    childArticles: rec('childArticles', () => ok([node('DEMO-A-3', 0, 'DEMO-A-2')])),
    viewArticle: rec('viewArticle', (s, id) => ok({ idReadable: id, summary: 'Guide', content: 'Body', comments: [] })),
    addArticleComment: rec('addArticleComment', () => ok({})),
    ...over,
  }
}

function setup({ yt = fakeYt(), host = {} } = {}) {
  const orca = fakeOrca({ host })
  const state = createStateStore(orca.storage)
  registerHandlers(orca, {
    youtrack: yt, orcaCli: null, links: createLinkStore(orca.storage), launches: createLaunchTracker(orca.storage), state,
    detectAgents: () => ({ installed: [], other: [] }), now: () => 1000,
  })
  const call = (name, input) => orca.handlers.get(name)(input)
  return { orca, yt, call, state }
}

test('roots keep only top-level articles of the project, in YouTrack order', async () => {
  const { call, yt } = setup()
  const r = await call('yt.articles.roots', { server: 'one', project: 'DEMO' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data.articles.map((a) => a.id), ['DEMO-A-1', 'DEMO-A-2'])
  assert.equal(r.data.cut, undefined)
  assert.deepEqual(yt.calls.find((c) => c.name === 'scanArticles').a, ['one', 'project: {DEMO}'])
})

test('roots say cut when the scan reached the cap', async () => {
  const many = Array.from({ length: 5000 }, (_, i) => node(`DEMO-A-${i + 1}`, i, i % 2 ? 'DEMO-A-1' : null))
  const { call } = setup({ yt: fakeYt({ scanArticles: async () => ok(many) }) })
  const r = await call('yt.articles.roots', { server: 'one', project: 'DEMO' })
  assert.equal(r.data.cut, true)
  assert.ok(r.data.articles.length <= 500)
})

test('roots reject a project that is not a short name', async () => {
  const { call, yt } = setup()
  for (const project of ['', '-x', 'DEMO} or {X', 'a b']) {
    const r = await call('yt.articles.roots', { server: 'one', project })
    assert.equal(r.ok, false, project)
  }
  assert.equal(yt.calls.some((c) => c.name === 'scanArticles'), false)
})

test('children answers the sub-articles and rejects ids that are not article ids', async () => {
  const { call, yt } = setup()
  const r = await call('yt.articles.children', { server: 'one', id: 'DEMO-A-2' })
  assert.deepEqual(r.data.articles.map((a) => a.id), ['DEMO-A-3'])
  for (const id of ['DEMO-1', '-A-1', 'DEMO-A-1 x', '../DEMO-A-1', 7]) {
    assert.equal((await call('yt.articles.children', { server: 'one', id })).ok, false, String(id))
  }
  assert.equal(yt.calls.filter((c) => c.name === 'childArticles').length, 1)
})

test('search adds the project, and has: star for favorites, and keeps the parents', async () => {
  const { call, yt } = setup()
  const r = await call('yt.articles.search', { server: 'one', project: 'DEMO', query: ' login ', favorites: true })
  assert.deepEqual(yt.calls.find((c) => c.name === 'scanArticles').a, ['one', 'project: {DEMO} login has: star'])
  assert.deepEqual(r.data.articles.find((a) => a.id === 'DEMO-A-3').parent, { id: 'DEMO-A-2', summary: 'Article DEMO-A-2' })
  await call('yt.articles.search', { server: 'one', project: 'DEMO', query: '', favorites: false })
  assert.deepEqual(yt.calls.filter((c) => c.name === 'scanArticles').at(-1).a, ['one', 'project: {DEMO}'])
})

test('search rejects a query over 2000 characters and caps its results at 200', async () => {
  const many = Array.from({ length: 300 }, (_, i) => node(`DEMO-A-${i + 1}`, i))
  const { call } = setup({ yt: fakeYt({ scanArticles: async () => ok(many) }) })
  assert.equal((await call('yt.articles.search', { server: 'one', project: 'DEMO', query: 'x'.repeat(2001), favorites: false })).ok, false)
  const r = await call('yt.articles.search', { server: 'one', project: 'DEMO', query: 'x', favorites: false })
  assert.equal(r.data.articles.length, 200)
  assert.equal(r.data.cut, true)
})

test('an invalid query keeps the message of the YouTrack CLI', async () => {
  const { call } = setup({ yt: fakeYt({ scanArticles: async () => fail('QUERY_INVALID', "Can't parse search query") }) })
  const r = await call('yt.articles.search', { server: 'one', project: 'DEMO', query: '{', favorites: false })
  assert.deepEqual(r.error, { code: 'QUERY_INVALID', message: "Can't parse search query" })
})

test('get answers the article as the card shows it', async () => {
  const { call } = setup()
  const r = await call('yt.article.get', { server: 'one', id: 'DEMO-A-1' })
  assert.equal(r.data.url, 'https://one.example.com/articles/DEMO-A-1')
  assert.equal(r.data.contentMd, 'Body')
  assert.equal('descriptionMd' in r.data, false)
})

test('get caps a huge article and its comments to what the panel can draw', async () => {
  const comments = Array.from({ length: 300 }, (_, i) => ({ id: `8-${i}`, text: 'c'.repeat(3000), created: i, author: { login: 'jane', fullName: 'Jane Doe' } }))
  const { call } = setup({ yt: fakeYt({ viewArticle: async (s, id) => ok({ idReadable: id, summary: 'Big', content: 'x'.repeat(200_000), comments }) }) })
  const r = await call('yt.article.get', { server: 'one', id: 'DEMO-A-1' })
  assert.equal(r.ok, true)
  assert.equal(r.data.truncated, true)
  assert.ok(r.data.commentsOmitted > 0)
  assert.ok(Buffer.byteLength(r.data.contentMd, 'utf8') <= 60_000)
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') < 1_000_000)
})

test('get passes on NOT_FOUND from the YouTrack CLI', async () => {
  const { call } = setup({ yt: fakeYt({ viewArticle: async () => fail('NOT_FOUND', 'HTTP 404') }) })
  assert.deepEqual((await call('yt.article.get', { server: 'one', id: 'DEMO-A-9' })).error, { code: 'NOT_FOUND', message: 'HTTP 404' })
})

test('comment trims the text, rejects empty or too long text, and writes once', async () => {
  const { call, yt } = setup()
  assert.equal((await call('yt.article.comment', { server: 'one', id: 'DEMO-A-1', text: '  ' })).ok, false)
  assert.equal((await call('yt.article.comment', { server: 'one', id: 'DEMO-A-1', text: 'x'.repeat(10_001) })).ok, false)
  assert.equal((await call('yt.article.comment', { server: 'one', id: 'DEMO-1', text: 'Hi' })).ok, false)
  assert.deepEqual(await call('yt.article.comment', { server: 'one', id: 'DEMO-A-1', text: ' Hi\nthere ' }), { ok: true, data: {} })
  assert.deepEqual(yt.calls.filter((c) => c.name === 'addArticleComment').map((c) => c.a), [['one', 'DEMO-A-1', 'Hi\nthere']])
})

test('the article project is remembered per server and forgotten with the server', async () => {
  const { call, state } = setup()
  assert.deepEqual((await call('yt.articles.project', { server: 'one' })).data, { project: null })
  assert.equal((await call('yt.articles.setProject', { server: 'one', project: 'bad project' })).ok, false)
  await call('yt.articles.setProject', { server: 'one', project: 'DEMO' })
  assert.deepEqual((await call('yt.articles.project', { server: 'one' })).data, { project: 'DEMO' })
  await state.forgetServer('one')
  assert.deepEqual((await call('yt.articles.project', { server: 'one' })).data, { project: null })
})

test('article requests answer a Result whatever the YouTrack CLI returned', async () => {
  for (const bad of [null, 5, 'x', [1, null, { idReadable: 7 }], { idReadable: '' }]) {
    const yt = fakeYt({ scanArticles: async () => ok(bad), childArticles: async () => ok(bad), viewArticle: async () => ok(bad) })
    const { call } = setup({ yt })
    for (const [name, input] of [
      ['yt.articles.roots', { server: 'one', project: 'DEMO' }],
      ['yt.articles.children', { server: 'one', id: 'DEMO-A-1' }],
      ['yt.articles.search', { server: 'one', project: 'DEMO', query: 'x', favorites: false }],
      ['yt.article.get', { server: 'one', id: 'DEMO-A-1' }],
    ]) {
      const r = await call(name, input)
      assert.equal(typeof r.ok, 'boolean', `${name} ${JSON.stringify(bad)}`)
      if (r.ok && r.data.articles) assert.ok(r.data.articles.every((a) => typeof a.id === 'string' && a.id))
    }
  }
})
