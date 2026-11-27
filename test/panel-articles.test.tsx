import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (message: string) => ({ ok: false as const, error: { code: 'UNKNOWN' as const, message } })
const node = (id: string, summary: string, hasChildren = false, parent?: { id: string; summary: string }) =>
  ({ id, summary, hasChildren, starred: false, ...(parent ? { parent } : {}) })
const server = (alias: string) => ({ alias, url: `https://${alias}.example.com`, active: alias === 'main', status: 'authenticated' })
let chosen = 'main'
const env = () => ok({ cli: { found: true }, orcaCli: { found: true }, servers: [server('main'), server('other')], server: chosen, query: '', defaultQuery: '' })

const ROOTS: Record<string, unknown> = {
  DEMO: ok({ articles: [node('DEMO-A-1', 'Getting started'), node('DEMO-A-3', 'Architecture', true)] }),
  OPS: ok({ articles: [node('OPS-A-1', 'Runbook')] })
}
const CHILDREN: Record<string, unknown> = {
  'DEMO-A-3': ok({ articles: [node('DEMO-A-4', 'API guidelines', true)] }),
  'DEMO-A-4': ok({ articles: [node('DEMO-A-5', 'Error codes')] })
}

const host = (over: Record<string, unknown> = {}) => {
  chosen = 'main'
  return mockHost({
    requests: {
      'yt.env': env, 'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }), 'yt.savedQueries': ok([]), 'yt.links': ok({}),
      'yt.setQuery': ok({}), 'yt.current': ok({ issue: null }), 'yt.quickViews': ok({ ids: [] }), 'yt.setServer': (input: { server: string }) => ((chosen = input.server), ok({})),
      'yt.projects': ok({ projects: [{ shortName: 'DEMO', name: 'Demo' }, { shortName: 'OPS', name: 'Operations' }] }),
      'yt.articles.project': ok({ project: 'DEMO' }),
      'yt.articles.setProject': ok({}),
      'yt.articles.roots': (input: { project: string }) => ROOTS[input.project],
      'yt.articles.children': (input: { id: string }) => CHILDREN[input.id] ?? ok({ articles: [] }),
      'yt.articles.search': ok({ articles: [node('DEMO-A-5', 'Error codes', false, { id: 'DEMO-A-4', summary: 'API guidelines' })] }),
      ...over
    }
  })
}
const asked = (h: ReturnType<typeof mockHost>, name: string) =>
  h.callsOf('plugin.request').filter((c: any) => c.name === name).map((c: any) => c.input)

const toArticles = async (h = host()) => {
  const view = await mount(panel, { host: h })
  await view.select({ type: 'Tabs' }, 'articles')
  return view
}

test('the Articles tab shows the remembered project as a tree of top-level articles', async () => {
  const h = host()
  const view = await toArticles(h)
  const tree = view.find({ type: 'Tree' })
  assert.deepEqual(tree.props.items.map((i: any) => [i.key, i.label, i.hasChildren === true]), [
    ['DEMO-A-1', 'Getting started', false], ['DEMO-A-3', 'Architecture', true]
  ])
  assert.equal(view.find({ type: 'Select', label: 'Project' }).props.value, 'DEMO')
  assert.deepEqual(asked(h, 'yt.articles.roots'), [{ server: 'main', project: 'DEMO' }])
  assert.equal(view.find({ type: 'Table' }), null)
  await view.unmount()
})

test('expanding an article loads its children once, and nested ones too', async () => {
  const h = host()
  const view = await toArticles(h)
  await view.expand({ type: 'Tree' }, 'DEMO-A-3')
  await view.expand({ type: 'Tree' }, 'DEMO-A-4')
  const items = view.find({ type: 'Tree' }).props.items
  assert.equal(items[1].children[0].key, 'DEMO-A-4')
  assert.equal(items[1].children[0].children[0].key, 'DEMO-A-5')
  await view.collapse({ type: 'Tree' }, 'DEMO-A-3')
  await view.expand({ type: 'Tree' }, 'DEMO-A-3')
  assert.deepEqual(asked(h, 'yt.articles.children').map((i: any) => i.id), ['DEMO-A-3', 'DEMO-A-4'])
  assert.deepEqual(view.expandedOf({ type: 'Tree' }).sort(), ['DEMO-A-3', 'DEMO-A-4'])
  await view.unmount()
})

test('a search shows a flat list with each article’s parent', async () => {
  const h = host()
  const view = await toArticles(h)
  await view.type({ type: 'Input', label: 'Search articles' }, 'error', { submit: true })
  assert.equal(view.find({ type: 'Tree' }), null)
  const item = view.find({ type: 'ListItem', testId: 'DEMO-A-5' })
  assert.deepEqual([item.props.title, item.props.description], ['Error codes', 'API guidelines'])
  assert.deepEqual(asked(h, 'yt.articles.search').at(-1), { server: 'main', project: 'DEMO', query: 'error', favorites: false })
  await view.type({ type: 'Input', label: 'Search articles' }, '', { replace: true, submit: true })
  assert.ok(view.find({ type: 'Tree' }))
  await view.unmount()
})

test('Favorites lists starred articles of the project', async () => {
  const h = host()
  const view = await toArticles(h)
  await view.press({ type: 'Button', text: 'Favorites' })
  assert.deepEqual(asked(h, 'yt.articles.search').at(-1), { server: 'main', project: 'DEMO', query: '', favorites: true })
  await view.press({ type: 'Button', text: 'Favorites' })
  assert.ok(view.find({ type: 'Tree' }))
  await view.unmount()
})

test('choosing another project loads its articles and remembers it', async () => {
  const h = host()
  const view = await toArticles(h)
  await view.select({ type: 'Select', label: 'Project' }, 'OPS')
  assert.deepEqual(view.find({ type: 'Tree' }).props.items.map((i: any) => i.key), ['OPS-A-1'])
  assert.deepEqual(asked(h, 'yt.articles.setProject'), [{ server: 'main', project: 'OPS' }])
  await view.unmount()
})

test('without a remembered project the first project is shown', async () => {
  const view = await toArticles(host({ 'yt.articles.project': ok({ project: null }) }))
  assert.equal(view.find({ type: 'Select', label: 'Project' }).props.value, 'DEMO')
  await view.unmount()
})

test('switching the server shows the articles of the new server only', async () => {
  const h = host()
  const view = await toArticles(h)
  await view.expand({ type: 'Tree' }, 'DEMO-A-3')
  await view.select({ type: 'Select', label: 'Server' }, 'other')
  assert.deepEqual(asked(h, 'yt.articles.roots').at(-1), { server: 'other', project: 'DEMO' })
  assert.deepEqual(view.expandedOf({ type: 'Tree' }), [])
  await view.unmount()
})

test('Settings and back keeps the Articles tab', async () => {
  const view = await toArticles()
  await view.press({ type: 'IconButton', label: 'Prompt templates and servers' })
  await view.press({ type: 'Button', text: '← Back' })
  assert.equal(view.valueOf({ type: 'Tabs' }), 'articles')
  assert.ok(view.find({ type: 'Tree' }))
  await view.unmount()
})

test('a cut answer says that not all articles are shown', async () => {
  const view = await toArticles(host({ 'yt.articles.roots': ok({ articles: [node('DEMO-A-1', 'One')], cut: true }) }))
  assert.ok(view.find({ text: 'Not all articles are shown. Search to narrow them down.' }))
  await view.unmount()
})

test('a project without articles says so, and a failed load offers Retry', async () => {
  const empty = await toArticles(host({ 'yt.articles.roots': ok({ articles: [] }) }))
  assert.ok(empty.find({ type: 'EmptyState', label: 'No articles in this project' }))
  await empty.unmount()
  const h = host({ 'yt.articles.roots': fail('Network is down') })
  const broken = await toArticles(h)
  assert.ok(broken.find({ text: 'Network is down' }))
  await broken.press({ type: 'Button', text: 'Retry' })
  assert.equal(asked(h, 'yt.articles.roots').length, 2)
  await broken.unmount()
})

const article = (id: string, over: Record<string, unknown> = {}) => ({
  id, summary: `Title ${id}`, url: `https://main.example.com/articles/${id}`, project: { shortName: 'DEMO', name: 'Demo' }, contentMd: `Body of ${id}`,
  path: [{ id: 'DEMO-A-3', summary: 'Architecture' }], children: [node('DEMO-A-5', 'Error codes')],
  mentionedArticles: [{ id: 'DEMO-A-6', summary: 'Release process' }], mentionedIssues: [{ id: 'DEMO-1', summary: 'Fix login', resolved: true }],
  attachments: ['diagram.png'], comments: [{ id: '8-1', author: { login: 'jane', fullName: 'Jane Doe' }, created: 1, textMd: 'Looks good' }],
  updated: 2, updatedBy: { login: 'jane', fullName: 'Jane Doe' }, ...over
})
const issueDetail = (id: string) => ({
  id, summary: `Issue ${id}`, created: 1, updated: 2, resolved: false, url: `https://main.example.com/issue/${id}`,
  project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Body', comments: [], tags: [], links: []
})
const withArticles = (over: Record<string, unknown> = {}) =>
  host({ 'yt.article.get': (input: { id: string }) => ok(article(input.id)), 'yt.issue.get': (input: { id: string }) => ok(issueDetail(input.id)), ...over })

const openFromTree = async (h = withArticles()) => {
  const view = await toArticles(h)
  await view.expand({ type: 'Tree' }, 'DEMO-A-3')
  await view.selectItem({ type: 'Tree' }, 'DEMO-A-4')
  return view
}

test('selecting an article shows its path, content, sub-articles, mentions, attachments and comments', async () => {
  const view = await openFromTree()
  assert.ok(view.find({ type: 'Heading', text: 'Title DEMO-A-4' }))
  assert.ok(view.find({ type: 'Markdown' }).props.content === 'Body of DEMO-A-4')
  assert.ok(view.find({ type: 'Link', text: 'Architecture' }))
  for (const key of ['child:DEMO-A-5', 'article:DEMO-A-6', 'issue:DEMO-1']) assert.ok(view.find({ type: 'ListItem', testId: key }), key)
  assert.ok(view.find({ text: 'diagram.png' }))
  assert.ok(view.find({ text: 'Looks good' }) || view.findAll({ type: 'Markdown' }).some((m: any) => m.props.content === 'Looks good'))
  await view.unmount()
})

test('Back from an article returns to the tree with its branches still open', async () => {
  const view = await openFromTree()
  await view.press({ type: 'Button', text: '← Back' })
  assert.deepEqual(view.expandedOf({ type: 'Tree' }), ['DEMO-A-3'])
  assert.equal(view.valueOf({ type: 'Tabs' }), 'articles')
  await view.unmount()
})

test('a mentioned issue opens inside the plugin, and Back returns to the article', async () => {
  const h = withArticles()
  const view = await openFromTree(h)
  await view.press({ type: 'ListItem', testId: 'issue:DEMO-1' })
  assert.deepEqual(asked(h, 'yt.issue.get').at(-1), { server: 'main', id: 'DEMO-1' })
  await view.press({ type: 'Button', text: '← Back' })
  assert.ok(view.find({ type: 'Heading', text: 'Title DEMO-A-4' }))
  await view.unmount()
})

test('a mentioned article, then Back twice, walks back the chain to the tree', async () => {
  const view = await openFromTree()
  await view.press({ type: 'ListItem', testId: 'article:DEMO-A-6' })
  assert.ok(view.find({ type: 'Heading', text: 'Title DEMO-A-6' }))
  await view.press({ type: 'Button', text: '← Back' })
  assert.ok(view.find({ type: 'Heading', text: 'Title DEMO-A-4' }))
  await view.press({ type: 'Button', text: '← Back' })
  assert.ok(view.find({ type: 'Tree' }))
  await view.unmount()
})

test('a path link opens the parent article', async () => {
  const h = withArticles()
  const view = await openFromTree(h)
  await view.press({ type: 'Link', text: 'Architecture' })
  assert.deepEqual(asked(h, 'yt.article.get').at(-1), { server: 'main', id: 'DEMO-A-3' })
  await view.unmount()
})

test('sending a comment adds it to the article and loads the article again', async () => {
  const h = withArticles({ 'yt.article.comment': ok({}) })
  const view = await openFromTree(h)
  await view.type({ type: 'Textarea', label: 'Add comment' }, 'Thanks')
  await view.press({ type: 'Button', text: 'Send' })
  assert.deepEqual(asked(h, 'yt.article.comment'), [{ server: 'main', id: 'DEMO-A-4', text: 'Thanks' }])
  assert.equal(asked(h, 'yt.article.get').length, 2)
  assert.equal(view.find({ type: 'Textarea', label: 'Add comment' }).props.value, '')
  await view.unmount()
})

test('a failed comment keeps the text and says why', async () => {
  const view = await openFromTree(withArticles({ 'yt.article.comment': fail('No permission') }))
  await view.type({ type: 'Textarea', label: 'Add comment' }, 'Thanks')
  await view.press({ type: 'Button', text: 'Send' })
  assert.ok(view.find({ text: 'No permission' }))
  assert.equal(view.find({ type: 'Textarea', label: 'Add comment' }).props.value, 'Thanks')
  await view.unmount()
})

test('an article too large to draw offers the browser', async () => {
  const view = await openFromTree(withArticles({ 'yt.article.get': ok(article('DEMO-A-4', { contentMd: 'x'.repeat(70 * 1024) })) }))
  assert.ok(view.find({ text: 'This article is too large to show here. Open it in the browser.' }))
  assert.equal(view.find({ type: 'Markdown' }), null)
  await view.unmount()
})

test('a cut article says so and offers the browser', async () => {
  const view = await openFromTree(withArticles({ 'yt.article.get': ok(article('DEMO-A-4', { truncated: true, commentsOmitted: 3 })) }))
  assert.ok(view.find({ text: 'This article is too long to show in full. Open it in the browser to see everything.' }))
  await view.unmount()
})

test('switching the server closes an open article of the old server', async () => {
  const h = withArticles()
  const view = await openFromTree(h)
  await view.select({ type: 'Select', label: 'Server' }, 'other')
  assert.equal(view.find({ type: 'Heading', text: 'Title DEMO-A-4' }), null)
  assert.ok(view.find({ type: 'Tree' }))
  assert.deepEqual(asked(h, 'yt.articles.roots').at(-1), { server: 'other', project: 'DEMO' })
  await view.unmount()
})
