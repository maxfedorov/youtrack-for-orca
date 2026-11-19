import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const env = (query: string) =>
  ok({
    cli: { found: true }, orcaCli: { found: true },
    servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
    server: 'main', query, defaultQuery: ''
  })
const host = (query = 'project: DEMO') =>
  mockHost({
    requests: { 'yt.env': env(query), 'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }), 'yt.savedQueries': ok([]), 'yt.links': ok({}), 'yt.setQuery': ok({}) }
  })
const searches = (h: any) => h.callsOf('plugin.request').filter((c: any) => c.name === 'yt.issues.search').map((c: any) => c.input.query)

test('the list offers four quick views', async () => {
  const view = await mount(panel, { host: host() })
  for (const text of ['Assigned to me', 'Reported by me', 'Commented by me', 'All open']) assert.ok(view.find({ role: 'button', text }), text)
  await view.unmount()
})

test('a quick view runs its query and fills the search field', async () => {
  const h = host()
  const view = await mount(panel, { host: h })
  await view.press({ role: 'button', text: 'Reported by me' })
  assert.equal(searches(h).at(-1), 'reporter: me #Unresolved')
  assert.equal(view.find({ type: 'Input', label: 'Query' }).props.value, 'reporter: me #Unresolved')
  await view.unmount()
})

test('the quick view whose query is shown is marked', async () => {
  const view = await mount(panel, { host: host('for: me #Unresolved') })
  assert.equal(view.find({ role: 'button', text: 'Assigned to me' }).props.variant, 'solid')
  assert.equal(view.find({ role: 'button', text: 'All open' }).props.variant, 'ghost')
  await view.unmount()
})
