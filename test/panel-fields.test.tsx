import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const row = { id: 'DEMO-1', summary: 'Title', created: 1, updated: 2, resolved: false, url: 'https://main.example.com/issue/DEMO-1' }
const detail = {
  ...row, project: { shortName: 'DEMO', name: 'Demo' }, descriptionMd: '', comments: [], tags: [],
  fields: [{ name: 'Priority', value: 'Major' }, { name: 'Assignee', value: 'Jane Doe' }, { name: 'Estimation', value: '1h' }]
}
const FIELDS = {
  fields: [
    { name: 'Priority', kind: 'enum', multi: false, required: true, values: [{ name: 'Major' }, { name: 'Minor' }] },
    { name: 'Assignee', kind: 'user', multi: false, required: false, values: [{ name: 'jane', label: 'Jane Doe' }, { name: 'bob', label: 'Bob Roe' }] },
    { name: 'Estimation', kind: 'other', multi: false, required: false, values: [] }
  ]
}
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: '', defaultQuery: ''
})
function host(over: Record<string, unknown> = {}) {
  return mockHost({
    requests: {
      'yt.env': env, 'yt.issues.search': ok({ issues: [row], hasMore: false, total: 1 }), 'yt.savedQueries': ok([]),
      'yt.links': ok({}), 'yt.setQuery': ok({}), 'yt.current': ok({ issue: null }), 'yt.issue.get': ok(detail),
      'yt.project.fields': ok(FIELDS), 'yt.issue.setField': ok({}), ...over
    }
  })
}
const calls = (h: any, name: string) => h.callsOf('plugin.request').filter((c: any) => c.name === name)
async function opened(h: any) {
  const view = await mount(panel, { host: h })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  return view
}

test('a field takes a value from the project list, and the issue loads again', async () => {
  const h = host()
  const view = await opened(h)
  assert.ok(view.find({ text: 'Major' }))
  await view.press({ label: 'Change Assignee' })
  assert.deepEqual(calls(h, 'yt.project.fields')[0].input, { server: 'main', project: 'DEMO' })
  await view.press({ testId: 'Assignee:toggle' })
  const loads = calls(h, 'yt.issue.get').length
  await view.press({ type: 'ListItem', label: 'Bob Roe' })
  assert.deepEqual(calls(h, 'yt.issue.setField')[0].input, { server: 'main', id: 'DEMO-1', field: 'Assignee', value: 'bob' })
  assert.equal(calls(h, 'yt.issue.get').length, loads + 1)
  await view.unmount()
})

test('an optional field can be emptied, a required one cannot', async () => {
  const h = host()
  const view = await opened(h)
  await view.press({ label: 'Change Assignee' })
  await view.press({ testId: 'Assignee:toggle' })
  await view.press({ type: 'ListItem', label: 'No value' })
  assert.deepEqual(calls(h, 'yt.issue.setField')[0].input, { server: 'main', id: 'DEMO-1', field: 'Assignee', value: null })
  await view.press({ label: 'Change Priority' })
  await view.press({ testId: 'Priority:toggle' })
  assert.equal(view.findAll({ type: 'ListItem' }).some((i: any) => i.props.title === 'No value'), false)
  await view.unmount()
})

test('a field without a value list, or a project whose fields cannot be read, points to commands', async () => {
  const view = await opened(host())
  await view.press({ label: 'Change Estimation' })
  assert.ok(view.find({ text: 'Change Estimation with a command, such as "Estimation 1h".' }))
  await view.unmount()
  const denied = await opened(host({ 'yt.project.fields': fail('FORBIDDEN', 'HTTP 403: Forbidden') }))
  await denied.press({ label: 'Change Priority' })
  assert.ok(denied.find({ text: 'HTTP 403: Forbidden Change Priority with a command instead.' }))
  await denied.unmount()
})

test('a write that fails says why and keeps the picker open', async () => {
  const h = host({ 'yt.issue.setField': fail('UNKNOWN', 'Workflow refused it') })
  const view = await opened(h)
  await view.press({ label: 'Change Priority' })
  await view.press({ testId: 'Priority:toggle' })
  await view.press({ type: 'ListItem', label: 'Minor' })
  assert.ok(view.find({ text: 'Workflow refused it' }))
  assert.ok(view.find({ testId: 'Priority:toggle' }))
  await view.unmount()
})
