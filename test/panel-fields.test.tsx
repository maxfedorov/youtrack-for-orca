import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const row = { id: 'DEMO-1', summary: 'Title', created: 1, updated: 2, resolved: false, url: 'https://main.example.com/issue/DEMO-1' }
const detail = {
  ...row, project: { shortName: 'DEMO', name: 'Demo' }, descriptionMd: '', comments: [], tags: [],
  fields: [
    { name: 'Priority', value: 'Major', kind: 'enum', multi: false, required: true },
    { name: 'Assignee', value: 'Jane Doe', kind: 'user', multi: false, required: false },
    { name: 'Sprints', value: '1', kind: 'version', multi: true, required: false },
    { name: 'Estimation', value: '1h', kind: 'other', multi: false, required: false }
  ]
}
const VALUES: Record<string, unknown> = {
  Priority: ok({ values: [{ name: 'Major' }, { name: 'Minor' }], cut: false }),
  Assignee: ok({ values: [{ name: 'jane', label: 'Jane Doe' }, { name: 'bob', label: 'Bob Roe' }], cut: false })
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
      'yt.issue.fieldValues': (i: any) => VALUES[i.field], 'yt.issue.setField': ok({}), ...over
    }
  })
}
const calls = (h: any, name: string) => h.callsOf('plugin.request').filter((c: any) => c.name === name)
async function opened(h: any) {
  const view = await mount(panel, { host: h })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  return view
}

test('a field takes one of the values it offers on this issue, and the issue loads again', async () => {
  const h = host()
  const view = await opened(h)
  await view.press({ label: 'Change Assignee' })
  assert.deepEqual(calls(h, 'yt.issue.fieldValues')[0].input, { server: 'main', id: 'DEMO-1', field: 'Assignee' })
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

test('only single-value list fields get a change button; the others are changed with a command', async () => {
  const view = await opened(host())
  assert.ok(view.find({ label: 'Change Priority' }))
  assert.equal(view.find({ label: 'Change Sprints' }), null)
  assert.equal(view.find({ label: 'Change Estimation' }), null)
  assert.ok(view.find({ testId: 'field-value:Estimation' }))
  await view.unmount()
})

test('values that cannot be read, or a write without permission, say why', async () => {
  const h = host({ 'yt.issue.fieldValues': fail('FORBIDDEN', 'HTTP 403: Forbidden'), 'yt.issue.setField': fail('FORBIDDEN', 'HTTP 403: Forbidden') })
  const view = await opened(h)
  await view.press({ label: 'Change Priority' })
  assert.ok(view.find({ text: 'You cannot change Priority on this issue.' }))
  await view.unmount()
  const denied = await opened(host({ 'yt.issue.setField': fail('FORBIDDEN', 'HTTP 403: Forbidden') }))
  await denied.press({ label: 'Change Priority' })
  await denied.press({ testId: 'Priority:toggle' })
  await denied.press({ type: 'ListItem', label: 'Minor' })
  assert.ok(denied.find({ text: 'You cannot change this issue.' }))
  assert.ok(denied.find({ testId: 'Priority:toggle' }))
  await denied.unmount()
})

test('a write that fails for another reason shows the reason and keeps the picker open', async () => {
  const view = await opened(host({ 'yt.issue.setField': fail('UNKNOWN', 'Workflow refused it') }))
  await view.press({ label: 'Change Priority' })
  await view.press({ testId: 'Priority:toggle' })
  await view.press({ type: 'ListItem', label: 'Minor' })
  assert.ok(view.find({ text: 'Workflow refused it' }))
  await view.unmount()
})

test('a value list cut short says so and points to commands', async () => {
  const view = await opened(host({ 'yt.issue.fieldValues': ok({ values: [{ name: 'jane' }], cut: true }) }))
  await view.press({ label: 'Change Assignee' })
  assert.ok(view.find({ text: 'Only the first 500 values are listed. Set another one with a command, such as "Assignee <value>".' }))
  await view.unmount()
})
