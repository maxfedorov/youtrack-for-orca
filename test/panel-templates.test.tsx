import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'
import { optionsOf, pick, shown } from './combo'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, created: 1, updated: 2, resolved: false, url: `https://main.example.com/issue/DEMO-${n}`
})
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: 'q', defaultQuery: 'q'
})
const TEMPLATES = [
  { id: 'a', name: 'Alpha', body: 'A {{id}}' },
  { id: 'b', name: 'Beta', body: 'B {{id}}: {{summary}}' }
]
const prepare = (over: Record<string, unknown> = {}) => ({
  repos: [{ id: 'r1', name: 'alpha' }], orcaCli: true, defaultRepoId: 'r1', name: 'demo-1', agents: { installed: ['claude'], other: [] },
  defaultAgent: 'claude', launchMode: 'worktree', includeDescription: false, promptTemplate: 'B {{id}}: {{summary}}',
  templates: TEMPLATES, defaultTemplateId: 'b',
  vars: { id: 'DEMO-1', summary: 'Issue 1', description: '' }, workspaces: [], defaultWorkspaceId: null, ...over
})
function requests(over: Record<string, unknown> = {}) {
  return {
    'yt.env': env,
    'yt.issues.search': ok({ issues: [issue(1)], hasMore: false, total: 1 }),
    'yt.savedQueries': ok([]),
    'yt.links': ok({}),
    'yt.setQuery': ok({}),
    'yt.issue.get': ok({ ...issue(1), project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Text', comments: [] }),
    'yt.start.prepare': ok(prepare()),
    'yt.refs.search': ok({ refs: [] }),
    'yt.start.run': ok({ workspaceId: 'w9' }),
    ...over
  }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const promptOf = (view: any) => view.find({ type: 'Textarea', label: 'Prompt' }).props.value
const openStart = async (host: any) => {
  const view = await mount(panel, { host })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  return view
}
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
}

test('Start chooses the default template and builds the prompt from it', async () => {
  const host = mockHost({ requests: requests() })
  const view = await openStart(host)
  assert.equal(shown(view, 'Template'), 'Beta')
  assert.deepEqual((await optionsOf(view, 'Template')).map((o) => o.label), ['Alpha', 'Beta'])
  assert.equal(promptOf(view), 'B DEMO-1: Issue 1')
  clean(view)
  await view.unmount()
})

test('choosing another template rebuilds the prompt, and Start sends it', async () => {
  const host = mockHost({ requests: requests() })
  const view = await openStart(host)
  await pick(view, 'Template', 'a')
  assert.equal(shown(view, 'Template'), 'Alpha')
  assert.equal(promptOf(view), 'A DEMO-1')
  await view.press({ role: 'button', text: 'Start' })
  assert.equal(calls(host, 'yt.start.run')[0].input.prompt, 'A DEMO-1')
  clean(view)
  await view.unmount()
})

test('a prompt edited by hand stays when the template changes; Reset applies the chosen template', async () => {
  const host = mockHost({ requests: requests() })
  const view = await openStart(host)
  await view.type({ type: 'Textarea', label: 'Prompt' }, 'My own words', { replace: true })
  await pick(view, 'Template', 'a')
  assert.equal(promptOf(view), 'My own words')
  await view.press({ role: 'button', text: 'Reset to template' })
  assert.equal(promptOf(view), 'A DEMO-1')
  await pick(view, 'Template', 'b')
  assert.equal(promptOf(view), 'B DEMO-1: Issue 1')
  clean(view)
  await view.unmount()
})

test('without templates in the answer the prompt comes from the prompt template and no choice is shown', async () => {
  const { templates: _t, defaultTemplateId: _d, ...old } = prepare({ promptTemplate: 'Old {{id}}' })
  const host = mockHost({ requests: requests({ 'yt.start.prepare': ok(old) }) })
  const view = await openStart(host)
  assert.equal(view.find({ testId: 'Template:toggle' }), null)
  assert.equal(promptOf(view), 'Old DEMO-1')
  clean(view)
  await view.unmount()
})

test('templates of an unexpected shape are left out and the default falls to the first one', async () => {
  const host = mockHost({
    requests: requests({ 'yt.start.prepare': ok(prepare({ templates: [null, { id: 'x' }, TEMPLATES[0], 'y'], defaultTemplateId: 'b' })) })
  })
  const view = await openStart(host)
  assert.equal(shown(view, 'Template'), 'Alpha')
  assert.equal(promptOf(view), 'A DEMO-1')
  clean(view)
  await view.unmount()
})

// The settings view: templates.

const LIST = { templates: [{ ...TEMPLATES[0], builtIn: true }, TEMPLATES[1]], defaultId: 'a' }
function settingsHost(over: Record<string, unknown> = {}) {
  let state = structuredClone(LIST) as { templates: any[]; defaultId: string }
  let n = 0
  const answer = () => ok(structuredClone(state))
  return mockHost({
    requests: requests({
      'yt.templates': () => answer(),
      'yt.templates.save': (i: any) => {
        const id = i.id ?? `user-${++n}`
        state.templates = i.id ? state.templates.map((t) => (t.id === i.id ? { ...t, name: i.name, body: i.body } : t)) : [...state.templates, { id, name: i.name, body: i.body }]
        return ok({ ...structuredClone(state), id })
      },
      'yt.templates.delete': (i: any) => ((state.templates = state.templates.filter((t) => t.id !== i.id)), answer()),
      'yt.templates.setDefault': (i: any) => ((state.defaultId = i.id), answer()),
      'yt.templates.restore': () => ((state.templates = [...state.templates, { id: 'plan', name: 'Review and plan (no code changes)', body: 'P', builtIn: true }]), answer()),
      'yt.servers.defaults': ok({ repos: [{ id: 'r1', name: 'alpha' }], defaults: {} }),
      ...over
    })
  })
}
const openSettings = async (host: any) => {
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Prompt templates and servers' })
  return view
}

test('the settings button opens the templates, marking the default; Back returns to the list', async () => {
  const host = settingsHost()
  const view = await mount(panel, { host })
  assert.equal(view.find({ role: 'button', label: 'Prompt templates and servers' }).props.icon, 'settings')
  await view.press({ role: 'button', label: 'Prompt templates and servers' })
  assert.ok(view.find({ type: 'Heading', text: 'Prompt templates' }))
  assert.ok(view.find({ text: 'Alpha' }))
  assert.ok(view.find({ text: 'Beta' }))
  assert.equal(view.findAll({ type: 'Badge', text: 'Default' }).length, 1)
  assert.equal(view.find({ role: 'button', label: 'Make Alpha the default' }).disabled, true)
  await view.press({ role: 'button', text: '← Back' })
  assert.ok(view.find({ type: 'Table' }))
  clean(view)
  await view.unmount()
})

test('a new template is saved with its name and text and shown in the list', async () => {
  const host = settingsHost()
  const view = await openSettings(host)
  await view.press({ role: 'button', text: 'New template' })
  assert.equal(view.find({ type: 'Input', label: 'Name' }).props.maxLength, 60)
  assert.equal(view.find({ type: 'Textarea', label: 'Template' }).props.maxLength, 8000)
  assert.equal(view.find({ role: 'button', text: 'Save' }).disabled, true)
  await view.type({ type: 'Input', label: 'Name' }, 'Docs')
  await view.type({ type: 'Textarea', label: 'Template' }, 'Document {{id}}')
  await view.press({ role: 'button', text: 'Save' })
  assert.deepEqual(calls(host, 'yt.templates.save')[0].input, { name: 'Docs', body: 'Document {{id}}' })
  assert.equal(view.find({ type: 'Input', label: 'Name' }), null)
  assert.ok(view.find({ text: 'Docs' }))
  clean(view)
  await view.unmount()
})

test('editing a template starts from its text and saves it under its id; Cancel keeps it', async () => {
  const host = settingsHost()
  const view = await openSettings(host)
  await view.press({ role: 'button', label: 'Edit Beta' })
  assert.equal(view.valueOf({ type: 'Input', label: 'Name' }), 'Beta')
  assert.equal(view.valueOf({ type: 'Textarea', label: 'Template' }), 'B {{id}}: {{summary}}')
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(calls(host, 'yt.templates.save').length, 0)
  await view.press({ role: 'button', label: 'Edit Beta' })
  await view.type({ type: 'Input', label: 'Name' }, 'Gamma', { replace: true })
  await view.press({ role: 'button', text: 'Save' })
  assert.deepEqual(calls(host, 'yt.templates.save')[0].input, { id: 'b', name: 'Gamma', body: 'B {{id}}: {{summary}}' })
  assert.ok(view.find({ text: 'Gamma' }))
  clean(view)
  await view.unmount()
})

test('a failed save keeps the form with the reason', async () => {
  const host = settingsHost({ 'yt.templates.save': fail('UNKNOWN', 'You can keep at most 30 templates. Delete one first.') })
  const view = await openSettings(host)
  await view.press({ role: 'button', text: 'New template' })
  await view.type({ type: 'Input', label: 'Name' }, 'Docs')
  await view.type({ type: 'Textarea', label: 'Template' }, 'Document {{id}}')
  await view.press({ role: 'button', text: 'Save' })
  assert.ok(view.find({ text: 'You can keep at most 30 templates. Delete one first.' }))
  assert.equal(view.valueOf({ type: 'Input', label: 'Name' }), 'Docs')
  clean(view)
  await view.unmount()
})

test('deleting asks first, then removes the template', async () => {
  const host = settingsHost()
  const view = await openSettings(host)
  await view.press({ role: 'button', label: 'Delete Beta' })
  assert.ok(view.find({ text: 'Delete the template Beta?' }))
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(calls(host, 'yt.templates.delete').length, 0)
  await view.press({ role: 'button', label: 'Delete Beta' })
  await view.press({ role: 'button', text: 'Delete' })
  assert.deepEqual(calls(host, 'yt.templates.delete')[0].input, { id: 'b' })
  assert.equal(view.find({ text: 'Beta' }), null)
  clean(view)
  await view.unmount()
})

test('a template is made the default, and Restore brings back the built-ins', async () => {
  const host = settingsHost()
  const view = await openSettings(host)
  await view.press({ role: 'button', label: 'Make Beta the default' })
  assert.deepEqual(calls(host, 'yt.templates.setDefault')[0].input, { id: 'b' })
  assert.equal(view.find({ role: 'button', label: 'Make Beta the default' }).disabled, true)
  await view.press({ role: 'button', text: 'Restore built-in templates' })
  assert.equal(calls(host, 'yt.templates.restore').length, 1)
  assert.ok(view.find({ text: 'Review and plan (no code changes)' }))
  clean(view)
  await view.unmount()
})

test('templates that cannot be loaded show the reason with Retry', async () => {
  let fails = true
  const host = settingsHost({ 'yt.templates': () => (fails ? fail('UNKNOWN', 'storage is broken') : ok(LIST)) })
  const view = await openSettings(host)
  assert.ok(view.find({ text: 'storage is broken' }))
  fails = false
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ text: 'Alpha' }))
  clean(view)
  await view.unmount()
})

test('a failed change shows its reason above the list', async () => {
  const host = settingsHost({ 'yt.templates.delete': fail('UNKNOWN', 'Keep at least one template.') })
  const view = await openSettings(host)
  await view.press({ role: 'button', label: 'Delete Beta' })
  await view.press({ role: 'button', text: 'Delete' })
  assert.ok(view.find({ text: 'Keep at least one template.' }))
  assert.ok(view.find({ text: 'Beta' }))
  clean(view)
  await view.unmount()
})
