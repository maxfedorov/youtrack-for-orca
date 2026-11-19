import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const row = (n: number) => ({ id: `DEMO-${n}`, summary: `Issue ${n}`, created: 1, updated: 2, resolved: false, url: `https://main.example.com/issue/DEMO-${n}` })
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: '', defaultQuery: ''
})
const current = { issue: { id: 'DEMO-4', summary: 'Fix the login', url: 'https://main.example.com/issue/DEMO-4' }, workspaceId: 'identity:w' }
function host(answer: () => unknown) {
  return mockHost({
    requests: {
      'yt.env': env, 'yt.issues.search': ok({ issues: [row(1)], hasMore: false, total: 1 }), 'yt.savedQueries': ok([]),
      'yt.links': ok({}), 'yt.setQuery': ok({}), 'yt.current': () => answer(),
      'yt.issue.get': ok({ ...row(4), project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: '', comments: [], tags: [] })
    }
  })
}
const currents = (h: any) => h.callsOf('plugin.request').filter((c: any) => c.name === 'yt.current').length

test('the list shows the issue of the current workspace, and it opens', async () => {
  const h = host(() => ok(current))
  const view = await mount(panel, { host: h })
  assert.ok(view.find({ text: 'This workspace' }))
  await view.press({ text: 'DEMO-4 Fix the login' })
  assert.ok(view.find({ role: 'button', text: '← Back' }))
  assert.equal(h.callsOf('plugin.request').filter((c: any) => c.name === 'yt.issue.get').at(-1).input.id, 'DEMO-4')
  await view.unmount()
})

test('no current issue, or a failed answer, shows nothing', async () => {
  for (const answer of [ok({ issue: null }), { ok: false, error: { code: 'UNKNOWN', message: 'x' } }]) {
    const view = await mount(panel, { host: host(() => answer) })
    assert.equal(view.find({ text: 'This workspace' }), null)
    assert.deepEqual(view.errors, [])
    await view.unmount()
  }
})

test('the current issue loads again when the worker says the workspace changed', async () => {
  let answer: unknown = ok({ issue: null })
  const h = host(() => answer)
  const view = await mount(panel, { host: h })
  const before = currents(h)
  answer = ok(current)
  view.post('yt.currentChanged', {})
  await view.settled()
  assert.equal(currents(h), before + 1)
  assert.ok(view.find({ text: 'This workspace' }))
  await view.unmount()
})
