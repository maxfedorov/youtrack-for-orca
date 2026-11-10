import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`,
  summary: `Issue ${n}`,
  created: 1_690_000_000_000 + n,
  updated: 1_700_000_000_000 + n,
  resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`
})
const detail = (n: number) => ({
  ...issue(n),
  project: { shortName: 'DEMO', name: 'Demo' },
  fields: [],
  descriptionMd: '',
  comments: []
})
const env = ok({
  cli: { found: true },
  orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
  server: 'main',
  query: 'for: me',
  defaultQuery: 'for: me'
})
/** `yt.links` answers from `linked`, which a test changes to stand for a removed workspace. */
function setup(over: Record<string, unknown> = {}) {
  const state = { linked: { 'DEMO-1': 'ws-1' } as Record<string, string> }
  const host = mockHost({
    requests: {
      'yt.env': env,
      'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: false, total: 2 }),
      'yt.savedQueries': ok([]),
      'yt.links': () => ok(state.linked),
      'yt.setQuery': ok({}),
      'yt.workspace.open': ok({}),
      'yt.issue.get': (i: any) => ok(detail(Number(i.id.split('-')[1]))),
      ...over
    }
  })
  return { host, state }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const table = { type: 'Table' }

test('the list shows Start again once the worker says the links changed', async () => {
  const { host, state } = setup()
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  state.linked = {}
  const before = calls(host, 'yt.links').length
  view.post('yt.linksChanged', {})
  await view.settled()
  assert.equal(calls(host, 'yt.links').length, before + 1)
  assert.equal(view.find({ role: 'button', text: 'Open →' }), null)
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the detail shows Start again once the worker says the links changed', async () => {
  const { host, state } = setup()
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  state.linked = {}
  view.post('yt.linksChanged', {})
  await view.settled()
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  await view.unmount()
})

test('links load again when the panel is shown again', async () => {
  const { host, state } = setup()
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  state.linked = {}
  await view.setVisible(false)
  const before = calls(host, 'yt.links').length
  await view.setVisible(true)
  await view.settled()
  assert.equal(calls(host, 'yt.links').length, before + 1)
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the header refresh loads the links of the open detail again', async () => {
  const { host, state } = setup()
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  state.linked = {}
  await view.press({ role: 'button', label: 'Refresh' })
  await view.settled()
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  await view.unmount()
})

test('opening a workspace that is gone shows Start with a note', async () => {
  const { host, state } = setup({
    'yt.workspace.open': () => {
      state.linked = {}
      return fail('NOT_FOUND', 'That workspace no longer exists.')
    }
  })
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.press({ role: 'button', text: 'Open →' })
  await view.settled()
  assert.equal(view.find({ role: 'button', text: 'Open →' }), null)
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  assert.ok(view.find({ text: 'That workspace no longer exists.' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opening from the detail a workspace that is gone shows Start with a note', async () => {
  const { host, state } = setup({
    'yt.workspace.open': () => {
      state.linked = {}
      return fail('NOT_FOUND', 'That workspace no longer exists.')
    }
  })
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.press({ role: 'button', text: 'Open →' })
  await view.settled()
  assert.ok(view.find({ role: 'button', text: 'Start →' }))
  assert.ok(view.find({ text: 'That workspace no longer exists.' }))
  await view.unmount()
})
