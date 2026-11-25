import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'
import { openCombo, optionsOf, pick } from './combo'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const env = (query: string) =>
  ok({
    cli: { found: true }, orcaCli: { found: true },
    servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
    server: 'main', query, defaultQuery: ''
  })
const SAVED = [
  { id: 's1', name: 'All tickets', query: 'project: DEMO' },
  { id: 's2', name: 'Assigned to me', query: 'for: me', favorite: true },
  { id: 's3', name: 'Bugs', query: 'Type: Bug' },
  { id: 's4', name: 'Reported by me', query: 'by: me', favorite: true }
]
const host = ({ query = 'project: DEMO', ids = [] as string[], saved = SAVED as unknown[] } = {}) => {
  let stored = ids
  return mockHost({
    requests: {
      'yt.env': env(query), 'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }), 'yt.savedQueries': ok(saved),
      'yt.links': ok({}), 'yt.setQuery': ok({}), 'yt.current': ok({ issue: null }),
      'yt.quickViews': () => ok({ ids: stored }),
      'yt.quickViews.set': (input: any) => ok({ ids: (stored = input.ids) })
    }
  })
}
const calls = (h: any, name: string) => h.callsOf('plugin.request').filter((c: any) => c.name === name)
const searches = (h: any) => calls(h, 'yt.issues.search').map((c: any) => c.input.query)
const buttons = (view: any) => view.findAll({ role: 'button' }).filter((b: any) => String(b.key).startsWith('quick-view:')).map((b: any) => b.text)

test('without chosen saved searches there are no quick view buttons', async () => {
  const view = await mount(panel, { host: host() })
  assert.deepEqual(buttons(view), [])
  for (const text of ['Assigned to me', 'All open']) assert.equal(view.find({ role: 'button', text }), null, text)
  await view.unmount()
})

test('chosen saved searches are buttons, in the order chosen, and run their query', async () => {
  const h = host({ ids: ['s3', 'gone', 's2'] })
  const view = await mount(panel, { host: h })
  assert.deepEqual(buttons(view), ['Bugs', 'Assigned to me'])
  await view.press({ role: 'button', text: 'Bugs' })
  assert.equal(searches(h).at(-1), 'Type: Bug')
  assert.equal(view.find({ type: 'Input', label: 'Query' }).props.value, 'Type: Bug')
  assert.equal(view.find({ role: 'button', text: 'Bugs' }).props.variant, 'solid')
  assert.equal(view.find({ role: 'button', text: 'Assigned to me' }).props.variant, 'ghost')
  await view.unmount()
})

test('the saved search shown can be added as a button and removed again', async () => {
  const h = host({ query: 'Type: Bug' })
  const view = await mount(panel, { host: h })
  await view.press({ role: 'button', label: 'Show as a quick view' })
  assert.deepEqual(calls(h, 'yt.quickViews.set').at(-1).input, { server: 'main', ids: ['s3'] })
  assert.deepEqual(buttons(view), ['Bugs'])
  await view.press({ role: 'button', label: 'Remove the quick view' })
  assert.deepEqual(calls(h, 'yt.quickViews.set').at(-1).input, { server: 'main', ids: [] })
  assert.deepEqual(buttons(view), [])
  await view.unmount()
})

test('a query that is not a saved search offers no quick view toggle', async () => {
  const view = await mount(panel, { host: host({ query: 'State: Open' }) })
  assert.equal(view.find({ role: 'button', label: 'Show as a quick view' }), null)
  await view.unmount()
})

test('removing a button forgets saved searches that no longer exist', async () => {
  const h = host({ query: 'Type: Bug', ids: ['gone', 's3', 's2'] })
  const view = await mount(panel, { host: h })
  await view.press({ role: 'button', label: 'Remove the quick view' })
  assert.deepEqual(calls(h, 'yt.quickViews.set').at(-1).input, { server: 'main', ids: ['s2'] })
  await view.unmount()
})

test('favorite saved searches come first, starred', async () => {
  const view = await mount(panel, { host: host() })
  const options = await optionsOf(view, 'Saved searches')
  assert.deepEqual(options.map((o) => o.label), ['★ Assigned to me', '★ Reported by me', 'All tickets', 'Bugs'])
  await openCombo(view, 'Saved searches')
  assert.ok(view.find({ text: 'Favorites' }))
  assert.ok(view.find({ text: 'Other saved searches' }))
  await pick(view, 'Saved searches', 's4')
  assert.equal(view.find({ type: 'Input', label: 'Query' }).props.value, 'by: me')
  await view.unmount()
})

test('without favorites the saved searches keep their order and have no stars', async () => {
  const view = await mount(panel, { host: host({ saved: SAVED.map(({ favorite, ...rest }) => rest) }) })
  const options = await optionsOf(view, 'Saved searches')
  assert.deepEqual(options.map((o) => o.label), ['All tickets', 'Assigned to me', 'Bugs', 'Reported by me'])
  await view.unmount()
})

test('with twelve quick views no more can be added', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `View ${i}`, query: `tag: t${i}` }))
  const view = await mount(panel, { host: host({ query: 'Type: Bug', ids: many.map((m) => m.id), saved: [...SAVED, ...many] }) })
  assert.equal(view.find({ role: 'button', label: 'Show as a quick view' }).props.disabled, true)
  await view.unmount()
})
