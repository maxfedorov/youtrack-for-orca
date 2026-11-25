import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const row = (id: string) => ({ id, summary: `Issue ${id}`, created: 1, updated: 2, resolved: false, url: `https://main.example.com/issue/${id}` })
const FIELDS = [
  { name: 'Severity', value: '\u2014', kind: 'enum', multi: false, required: true },
  { name: 'Priority', value: 'Normal', kind: 'enum', multi: false, required: true },
  { name: 'Assignee', kind: 'user', multi: false, required: false },
  { name: 'Points', kind: 'other', multi: false, required: true }
]
const VALUES: Record<string, unknown> = {
  Severity: ok({ values: [{ name: 'Low' }, { name: 'High' }], cut: false }),
  Priority: ok({ values: [{ name: 'Normal' }, { name: 'Major' }], cut: false }),
  Assignee: ok({ values: [{ name: 'jane', label: 'Jane Doe' }], cut: false })
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
      'yt.issue.draft': (i: any) => ok({ draftId: i.project === 'PLG' ? '3-9' : '3-8', fields: FIELDS }),
      'yt.issue.fieldValues': (i: any) => VALUES[i.field], 'yt.issue.create': ok({ id: 'PLG-9' }), 'yt.issue.draft.discard': ok({}),
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

test('a new issue is made from a draft of the project of the listed issues, with its required fields, and then opens', async () => {
  const h = host()
  const view = await form(h)
  assert.deepEqual(calls(h, 'yt.issue.draft')[0].input, { server: 'main', project: 'PLG' })
  assert.deepEqual(calls(h, 'yt.issue.fieldValues').map((c: any) => c.input.field), ['Severity', 'Priority'])
  assert.ok(view.find({ type: 'ListItem', label: 'Normal' }), 'a default the draft has is shown')
  assert.ok(view.find({ type: 'ListItem', label: 'Required' }))
  assert.ok(view.find({ text: 'Also required, set after creating with a command: Points.' }))
  await view.type({ type: 'Input', label: 'Summary' }, 'Login fails')
  await view.type({ type: 'Textarea', label: 'Description' }, 'Steps')
  await view.press({ testId: 'Severity:toggle' })
  await view.press({ type: 'ListItem', label: 'High' })
  await view.press({ role: 'button', text: 'Create' })
  assert.deepEqual(calls(h, 'yt.issue.create')[0].input, { server: 'main', draftId: '3-9', summary: 'Login fails', description: 'Steps', fields: { Severity: 'High' } })
  assert.equal(calls(h, 'yt.issue.get').at(-1).input.id, 'PLG-9')
  assert.equal(calls(h, 'yt.issue.draft.discard').length, 0)
  await view.unmount()
})

test('optional fields wait under More fields and load their values when shown', async () => {
  const h = host()
  const view = await form(h)
  assert.equal(view.find({ testId: 'Assignee:toggle' }), null)
  await view.press({ role: 'button', text: 'More fields' })
  assert.ok(view.find({ testId: 'Assignee:toggle' }))
  assert.ok(calls(h, 'yt.issue.fieldValues').some((c: any) => c.input.field === 'Assignee'))
  await view.unmount()
})

test('Back and another project delete the draft of the form', async () => {
  const h = host()
  const view = await form(h)
  await view.press({ testId: 'Project:toggle' })
  await view.press({ type: 'ListItem', label: 'Demo' })
  assert.deepEqual(calls(h, 'yt.issue.draft.discard')[0].input, { server: 'main', draftId: '3-9' })
  assert.equal(calls(h, 'yt.issue.draft').at(-1).input.project, 'DEMO')
  await view.press({ role: 'button', text: '← Back' })
  assert.deepEqual(calls(h, 'yt.issue.draft.discard')[1].input, { server: 'main', draftId: '3-8' })
  await view.unmount()
})

test('a failed create keeps the form and says why', async () => {
  const h = host({ 'yt.issue.create': fail('UNKNOWN', 'HTTP 400: Severity is required') })
  const view = await form(h)
  await view.type({ type: 'Input', label: 'Summary' }, 'Keep me')
  await view.press({ role: 'button', text: 'Create' })
  assert.ok(view.find({ text: 'HTTP 400: Severity is required' }))
  assert.equal(view.find({ type: 'Input', label: 'Summary' }).props.value, 'Keep me')
  await view.unmount()
})

test('a project where the user cannot create issues says so and offers no Create', async () => {
  const h = host({ 'yt.issue.draft': fail('FORBIDDEN', 'You cannot create issues in PLG.') })
  const view = await form(h)
  assert.ok(view.find({ text: 'You cannot create issues in PLG.' }))
  assert.equal(view.find({ role: 'button', text: 'Create' }).props.disabled, true)
  await view.unmount()
})
