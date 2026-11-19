import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const row = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, created: 1, updated: 2, resolved: false, url: `https://main.example.com/issue/DEMO-${n}`
})
const linked = (n: number, resolved = false) => ({ id: `DEMO-${n}`, summary: `Linked ${n}`, resolved })
const detail = (links: unknown) => ({
  ...row(1), project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Body', comments: [], tags: [], links
})
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: '', defaultQuery: ''
})
const host = (links: unknown) =>
  mockHost({
    requests: {
      'yt.env': env, 'yt.issues.search': ok({ issues: [row(1)], hasMore: false, total: 1 }), 'yt.savedQueries': ok([]),
      'yt.links': ok({}), 'yt.setQuery': ok({}), 'yt.issue.get': ok(detail(links))
    }
  })
const open = async (links: unknown) => {
  const view = await mount(panel, { host: host(links) })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  return view
}

test('an issue with open blockers says what it is blocked by', async () => {
  const view = await open([{ type: 'depends on', issues: [linked(2), linked(3, true)] }])
  assert.ok(view.find({ text: 'Blocked by DEMO-2' }))
  assert.equal(view.find({ text: 'Blocked by DEMO-3' }), null)
  await view.unmount()
})

test('resolved blockers do not block', async () => {
  const view = await open([{ type: 'depends on', issues: [linked(3, true)] }])
  assert.equal(view.findAll({ type: 'Callout' }).filter((c: any) => c.props.tone === 'warning').length, 0)
  await view.unmount()
})

test('subtasks show how many are done', async () => {
  const view = await open([{ type: 'parent for', issues: [linked(4, true), linked(5)] }])
  assert.ok(view.find({ text: 'Subtasks 1/2 done' }))
  assert.equal(view.find({ type: 'Progress' }).props.value, 50)
  await view.unmount()
})

test('an issue without subtasks or blockers shows neither', async () => {
  const view = await open([{ type: 'relates to', issues: [linked(6)] }])
  assert.equal(view.find({ type: 'Progress' }), null)
  assert.equal(view.find({ text: 'Blocked by DEMO-6' }), null)
  await view.unmount()
})
