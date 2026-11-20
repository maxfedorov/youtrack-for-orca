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
    { name: 'Estimation', value: '1h', kind: 'other', multi: false, required: false },
    { name: 'Points', value: 'No points', kind: 'integer', multi: false, required: false, empty: true },
    { name: 'Label', value: 'abc', kind: 'string', multi: false, required: true }
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

const toggle = (name: string) => ({ testId: `${name}:toggle` })

test('the fields sit in a grid that fills the sidebar width, with no edit buttons', async () => {
  const view = await opened(host())
  const grid = view.find({ type: 'Grid' })
  assert.equal(grid.props.minItemWidth, 'sm')
  assert.equal(view.findAll({ type: 'IconButton' }).some((b: any) => String(b.props.label).startsWith('Change ')), false)
  assert.equal(view.find(toggle('Priority')).props.title, 'Major')
  assert.equal(view.find({ testId: 'field-value:Estimation' }).text, '1h')
  await view.unmount()
})

test('a field takes one of the values it offers on this issue, read when its list first opens, and the issue loads again', async () => {
  const h = host()
  const view = await opened(h)
  assert.equal(calls(h, 'yt.issue.fieldValues').length, 0)
  await view.press(toggle('Assignee'))
  assert.deepEqual(calls(h, 'yt.issue.fieldValues')[0].input, { server: 'main', id: 'DEMO-1', field: 'Assignee' })
  const loads = calls(h, 'yt.issue.get').length
  await view.press({ type: 'ListItem', label: 'Bob Roe' })
  assert.deepEqual(calls(h, 'yt.issue.setField')[0].input, { server: 'main', id: 'DEMO-1', field: 'Assignee', value: 'bob' })
  assert.equal(calls(h, 'yt.issue.get').length, loads + 1)
  await view.unmount()
})

test('an optional field can be emptied, a required one cannot', async () => {
  const h = host()
  const view = await opened(h)
  await view.press(toggle('Assignee'))
  await view.press({ type: 'ListItem', label: 'No value' })
  assert.deepEqual(calls(h, 'yt.issue.setField')[0].input, { server: 'main', id: 'DEMO-1', field: 'Assignee', value: null })
  await view.press(toggle('Priority'))
  assert.equal(view.findAll({ type: 'ListItem' }).some((i: any) => i.props.title === 'No value'), false)
  await view.unmount()
})

test('only single-value list fields open a list; the others show their value and are changed with a command', async () => {
  const view = await opened(host())
  assert.ok(view.find(toggle('Priority')))
  assert.equal(view.find(toggle('Sprints')), null)
  assert.equal(view.find(toggle('Estimation')), null)
  assert.equal(view.find({ testId: 'field-value:Sprints' }).text, '1')
  await view.unmount()
})

test('values that cannot be read, or a write without permission, say why', async () => {
  const h = host({ 'yt.issue.fieldValues': fail('FORBIDDEN', 'HTTP 403: Forbidden'), 'yt.issue.setField': fail('FORBIDDEN', 'HTTP 403: Forbidden') })
  const view = await opened(h)
  await view.press(toggle('Priority'))
  assert.ok(view.find({ text: 'You cannot change Priority on this issue.' }))
  await view.unmount()
  const denied = await opened(host({ 'yt.issue.setField': fail('FORBIDDEN', 'HTTP 403: Forbidden') }))
  await denied.press(toggle('Priority'))
  await denied.press({ type: 'ListItem', label: 'Minor' })
  assert.ok(denied.find({ text: 'You cannot change this issue.' }))
  assert.ok(denied.find(toggle('Priority')))
  await denied.unmount()
})

test('a write that fails for another reason names the field and the reason', async () => {
  const view = await opened(host({ 'yt.issue.setField': fail('UNKNOWN', 'Workflow refused it') }))
  await view.press(toggle('Priority'))
  await view.press({ type: 'ListItem', label: 'Minor' })
  assert.ok(view.find({ text: 'Priority: Workflow refused it' }))
  assert.equal(view.find(toggle('Priority')).props.title, 'Major')
  await view.unmount()
})

test('a value list cut short says so and points to commands', async () => {
  const view = await opened(host({ 'yt.issue.fieldValues': ok({ values: [{ name: 'jane' }], cut: true }) }))
  await view.press(toggle('Assignee'))
  assert.ok(view.find({ text: 'Only the first 500 values are listed. Set another one with a command, such as "Assignee <value>".' }))
  await view.unmount()
})

test('each field is its name in small muted text over a bare value, with no field frame', async () => {
  const view = await opened(host())
  const name = view.findAll({ type: 'Text' }).find((t: any) => t.text === 'Priority')
  assert.equal(name.props.size, 'xs')
  assert.equal(name.props.muted, true)
  assert.equal(view.findAll({ type: 'Field' }).some((f: any) => ['Priority', 'Estimation', 'Points'].includes(f.props.label)), false)
  await view.unmount()
})

const edit = async (view: any, name: string) => view.press({ testId: `${name}:value` })

test('a number or text field shows its value like the others; pressing it opens an input, Enter saves', async () => {
  const h = host()
  const view = await opened(h)
  assert.equal(view.find({ type: 'Input', label: 'Points' }), null)
  assert.equal(view.find({ testId: 'Points:value' }).props.title, 'No points')
  assert.equal(view.find({ testId: 'Label:value' }).props.title, 'abc')
  assert.equal(view.find({ type: 'IconButton', label: 'Edit Points' }), null)
  await edit(view, 'Points')
  const points = () => view.find({ type: 'Input', label: 'Points' })
  assert.equal(points().props.value, '')
  assert.equal(points().props.placeholder, 'No points')
  await view.type({ type: 'Input', label: 'Points' }, '12')
  assert.ok(view.find({ text: 'Enter to save' }))
  const loads = calls(h, 'yt.issue.get').length
  await view.type({ type: 'Input', label: 'Points' }, '12', { replace: true, submit: true })
  assert.deepEqual(calls(h, 'yt.issue.setField').at(-1).input, { server: 'main', id: 'DEMO-1', field: 'Points', value: '12' })
  assert.equal(calls(h, 'yt.issue.get').length, loads + 1)
  assert.equal(points(), null)
  await view.unmount()
})

test('an input left unchanged saves nothing, an emptied one clears the field, and cancel closes it', async () => {
  const h = host()
  const view = await opened(h)
  await edit(view, 'Label')
  assert.equal(view.find({ type: 'Input', label: 'Label' }).props.value, 'abc')
  await view.type({ type: 'Input', label: 'Label' }, 'abc', { replace: true, submit: true })
  assert.equal(calls(h, 'yt.issue.setField').length, 0)
  assert.equal(view.find({ type: 'Input', label: 'Label' }), null)
  await edit(view, 'Label')
  await view.type({ type: 'Input', label: 'Label' }, '', { replace: true, submit: true })
  assert.deepEqual(calls(h, 'yt.issue.setField').at(-1).input, { server: 'main', id: 'DEMO-1', field: 'Label', value: null })
  await edit(view, 'Points')
  await view.type({ type: 'Input', label: 'Points' }, '7')
  await view.press({ type: 'IconButton', label: 'Cancel editing Points' })
  assert.equal(view.find({ type: 'Input', label: 'Points' }), null)
  assert.equal(calls(h, 'yt.issue.setField').length, 1)
  await view.unmount()
})

test('a typed value the issue refuses keeps the input and the text, and says why', async () => {
  const view = await opened(host({ 'yt.issue.setField': fail('INVALID_INPUT', 'Points takes a whole number') }))
  await edit(view, 'Points')
  await view.type({ type: 'Input', label: 'Points' }, '1.5', { replace: true, submit: true })
  assert.ok(view.find({ text: 'Points takes a whole number' }))
  assert.equal(view.find({ type: 'Input', label: 'Points' }).props.value, '1.5')
  await view.unmount()
})
