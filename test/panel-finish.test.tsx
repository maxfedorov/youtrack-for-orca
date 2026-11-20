import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const row = { id: 'DEMO-1', summary: 'Issue 1', created: 1, updated: 2, resolved: false, url: 'https://main.example.com/issue/DEMO-1' }
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: '', defaultQuery: ''
})
const prepare = (finish: unknown) => ({
  repos: [{ id: 'r1', name: 'alpha' }], orcaCli: true, defaultRepoId: 'r1', name: 'demo-1-issue-1',
  agents: { installed: ['claude'], other: [] }, defaultAgent: 'claude', launchMode: 'worktree', includeDescription: false,
  templates: [{ id: 't', name: 'T', body: 'Work on {{id}}' }], defaultTemplateId: 't',
  vars: { id: 'DEMO-1', server: 'main', summary: 'Issue 1', description: '' }, workspaces: [], defaultWorkspaceId: null, finish
})
function host(finish: unknown, over: Record<string, unknown> = {}) {
  return mockHost({
    requests: {
      'yt.env': env, 'yt.issues.search': ok({ issues: [row], hasMore: false, total: 1 }), 'yt.savedQueries': ok([]), 'yt.links': ok({}),
      'yt.setQuery': ok({}), 'yt.current': ok({ issue: null }), 'yt.refs.search': ok({ refs: [] }), 'yt.start.prepare': ok(prepare(finish)),
      'yt.start.run': ok({ workspaceId: 'w9' }),
      'yt.issue.get': ok({ ...row, project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: '', comments: [], tags: [] }), ...over
    }
  })
}
const calls = (h: any, name: string) => h.callsOf('plugin.request').filter((c: any) => c.name === name)
async function start(h: any) {
  const view = await mount(panel, { host: h })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  return view
}
const promptOf = (view: any) => String(view.find({ type: 'Textarea', label: 'Prompt' }).props.value)
const FINISH = { comment: false, field: 'Stage', fields: [{ name: 'Stage', values: ['Open', 'In Review'], state: '' }] }

test('the finish choices add the instructions at the end of the prompt', async () => {
  const h = host(FINISH)
  const view = await start(h)
  assert.equal(promptOf(view), 'Work on DEMO-1')
  await view.toggle({ type: 'Switch', label: 'Comment on the issue when done' })
  assert.ok(promptOf(view).endsWith("youtrack --server 'main' issue comment create --text-file - -- DEMO-1"))
  await view.select({ type: 'Select', label: 'Then set Stage to' }, 'In Review')
  assert.ok(promptOf(view).endsWith("youtrack --server 'main' issue field set -- DEMO-1 'Stage' 'In Review'"))
  assert.equal(view.find({ type: 'Select', label: 'Field to set when done' }), null)
  await view.press({ role: 'button', text: 'Start' })
  assert.ok(String(calls(h, 'yt.start.run')[0].input.prompt).includes("'Stage' 'In Review'"))
  assert.deepEqual(calls(h, 'yt.start.run')[0].input.finish, { field: 'Stage', state: 'In Review' })
  await view.unmount()
})

test('with several fields to choose from, another field starts at its own first value', async () => {
  const h = host({
    comment: false, field: 'Status',
    fields: [{ name: 'State', values: ['Open', 'Fixed'], state: '' }, { name: 'Status', values: ['New', 'Done'], state: 'Done' }]
  })
  const view = await start(h)
  assert.ok(promptOf(view).endsWith("issue field set -- DEMO-1 'Status' 'Done'"))
  await view.select({ type: 'Select', label: 'Field to set when done' }, 'State')
  assert.equal(view.find({ type: 'Select', label: 'Then set Status to' }), null)
  assert.equal(view.find({ type: 'Select', label: 'Then set State to' }).props.value, '__none__')
  assert.equal(promptOf(view), 'Work on DEMO-1')
  await view.select({ type: 'Select', label: 'Then set State to' }, 'Fixed')
  assert.ok(promptOf(view).endsWith("issue field set -- DEMO-1 'State' 'Fixed'"))
  await view.press({ role: 'button', text: 'Start' })
  assert.deepEqual(calls(h, 'yt.start.run')[0].input.finish, { field: 'State', state: 'Fixed' })
  await view.unmount()
})

test('a start without a prompt sends no finish choice to remember', async () => {
  const h = host(FINISH)
  const view = await start(h)
  await view.toggle({ type: 'Switch', label: 'Start without a prompt' })
  await view.press({ role: 'button', text: 'Start' })
  assert.equal('finish' in calls(h, 'yt.start.run')[0].input, false)
  await view.unmount()
})

test('the settings choose the finish options first; without a state field only the comment is offered', async () => {
  const view = await start(host({ comment: true, field: 'Stage', fields: [{ name: 'Stage', values: ['In Review'], state: 'In Review' }] }))
  assert.ok(promptOf(view).includes('Then set its Stage to "In Review"'))
  await view.unmount()
  const bare = await start(host({ comment: false, field: null, fields: [] }))
  assert.equal(bare.find({ type: 'Select', label: 'Then set Stage to' }), null)
  assert.equal(bare.find({ type: 'Select', label: 'Field to set when done' }), null)
  assert.ok(bare.find({ type: 'Switch', label: 'Comment on the issue when done' }))
  await bare.unmount()
})

test('settings install the skill for coding agents and say what happened', async () => {
  const h = host(FINISH, { 'yt.skill.install': ok({ messages: ['installed youtrack-cli for codex (2.1.0)'] }), 'yt.templates': ok({ templates: [], defaultId: '' }), 'yt.servers.defaults': ok({ repos: [], defaults: {} }) })
  const view = await mount(panel, { host: h })
  await view.press({ label: 'Prompt templates and servers' })
  await view.press({ role: 'button', text: 'Install or update the skill' })
  assert.equal(calls(h, 'yt.skill.install').length, 1)
  assert.ok(view.find({ text: 'installed youtrack-cli for codex (2.1.0)' }))
  await view.unmount()
  const failing = await mount(panel, { host: host(FINISH, { 'yt.skill.install': fail('UNKNOWN', 'no AI coding agents detected'), 'yt.templates': ok({ templates: [], defaultId: '' }), 'yt.servers.defaults': ok({ repos: [], defaults: {} }) }) })
  await failing.press({ label: 'Prompt templates and servers' })
  await failing.press({ role: 'button', text: 'Install or update the skill' })
  assert.ok(failing.find({ text: 'no AI coding agents detected' }))
  await failing.unmount()
})

test('finish choices still apply after the prompt was edited by hand, and turning one off removes its steps', async () => {
  const view = await start(host(FINISH))
  await view.type({ type: 'Textarea', label: 'Prompt' }, 'My own words', { replace: true })
  await view.toggle({ type: 'Switch', label: 'Comment on the issue when done' })
  assert.ok(promptOf(view).startsWith('My own words\n\nWhen you are done:'))
  await view.toggle({ type: 'Switch', label: 'Comment on the issue when done' })
  assert.equal(promptOf(view), 'My own words')
  await view.unmount()
})

test('damaged finish fields are repaired: unnamed or valueless fields are dropped, unknown choices fall back', async () => {
  const view = await start(host({
    comment: 'yes', field: 'Gone',
    fields: [{ name: 7, values: ['x'] }, { name: 'Empty', values: [] }, { name: 'Stage', values: ['Open', 5, 'Done'], state: 'Nope' }, null]
  }))
  assert.equal(view.find({ type: 'Select', label: 'Field to set when done' }), null)
  const select = view.find({ type: 'Select', label: 'Then set Stage to' })
  assert.deepEqual(select.props.options.map((o: any) => o.value), ['__none__', 'Open', 'Done'])
  assert.equal(select.props.value, '__none__')
  assert.equal(promptOf(view), 'Work on DEMO-1')
  await view.unmount()
})
