import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const row = (id: string) => ({ id, summary: `Issue ${id}`, created: 1, updated: 2, resolved: false, url: `https://main.example.com/issue/${id}` })
const FIELDS = {
  fields: [
    { name: 'Severity', kind: 'enum', multi: false, required: true, values: [{ name: 'Low' }, { name: 'High' }] },
    { name: 'Assignee', kind: 'user', multi: false, required: false, values: [{ name: 'jane', label: 'Jane Doe' }] },
    { name: 'Points', kind: 'other', multi: false, required: false, values: [] }
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
      'yt.env': env, 'yt.issues.search': ok({ issues: [row('PLG-1')], hasMore: false, total: 1 }), 'yt.savedQueries': ok([]),
      'yt.links': ok({}), 'yt.setQuery': ok({}), 'yt.current': ok({ issue: null }),
      'yt.projects': ok({ projects: [{ shortName: 'DEMO', name: 'Demo' }, { shortName: 'PLG', name: 'Plugin' }] }),
      'yt.project.fields': ok(FIELDS), 'yt.issue.create': ok({ id: 'PLG-9' }),
      'yt.issue.get': (i: any) => ok({ ...row(i.id), project: { shortName: 'PLG', name: 'Plugin' }, fields: [], descriptionMd: '', comments: [], tags: [] }),
      ...over
    }
  })
}
const calls = (h: any, name: string) => h.callsOf('plugin.request').filter((c: any) => c.name === name)
async function form(h: any) {
  const view = await mount(panel, { host: h })
  await view.press({ role: 'button', text: 'New issue' })
  return view
}

test('a new issue is created in the project of the listed issues, with its required fields, and then opens', async () => {
  const h = host()
  const view = await form(h)
  assert.deepEqual(calls(h, 'yt.project.fields')[0].input, { server: 'main', project: 'PLG' })
  assert.equal(view.find({ role: 'button', text: 'Create' }).props.disabled, true)
  await view.type({ type: 'Input', label: 'Summary' }, 'Login fails')
  await view.type({ type: 'Textarea', label: 'Description' }, 'Steps')
  await view.press({ testId: 'Severity:toggle' })
  await view.press({ type: 'ListItem', label: 'High' })
  await view.press({ role: 'button', text: 'Create' })
  assert.deepEqual(calls(h, 'yt.issue.create')[0].input, { server: 'main', project: 'PLG', summary: 'Login fails', description: 'Steps', fields: { Severity: 'High' } })
  assert.equal(calls(h, 'yt.issue.get').at(-1).input.id, 'PLG-9')
  assert.ok(view.find({ role: 'button', text: '← Back' }))
  await view.unmount()
})

test('optional fields wait under More fields', async () => {
  const view = await form(host())
  assert.equal(view.find({ testId: 'Assignee:toggle' }), null)
  await view.press({ role: 'button', text: 'More fields' })
  assert.ok(view.find({ testId: 'Assignee:toggle' }))
  await view.unmount()
})

test('a failed create keeps the form and says why', async () => {
  const h = host({ 'yt.issue.create': fail('UNKNOWN', 'HTTP 400: Severity is required') })
  const view = await form(h)
  await view.type({ type: 'Input', label: 'Summary' }, 'Keep me')
  await view.press({ testId: 'Severity:toggle' })
  await view.press({ type: 'ListItem', label: 'Low' })
  await view.press({ role: 'button', text: 'Create' })
  assert.ok(view.find({ text: 'HTTP 400: Severity is required' }))
  assert.equal(view.find({ type: 'Input', label: 'Summary' }).props.value, 'Keep me')
  await view.unmount()
})

test('without the project fields the issue can still be created with a summary', async () => {
  const h = host({ 'yt.project.fields': fail('FORBIDDEN', 'HTTP 403: Forbidden') })
  const view = await form(h)
  assert.ok(view.find({ text: 'The fields of this project could not be read (HTTP 403: Forbidden). The issue gets their default values.' }))
  await view.type({ type: 'Input', label: 'Summary' }, 'Plain')
  await view.press({ role: 'button', text: 'Create' })
  assert.deepEqual(calls(h, 'yt.issue.create')[0].input.fields, {})
  await view.unmount()
})
