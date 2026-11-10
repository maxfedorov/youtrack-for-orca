import { assert, hostError, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'
import { comboDisabled, filterCombo, isOpen, optionsOf, pick, shown } from './combo'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, state: { name: 'Open' }, priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' }, created: 1_690_000_000_000 + n, updated: 1_700_000_000_000 + n, resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`
})
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
  server: 'main', query: 'for: me #Unresolved', defaultQuery: 'for: me #Unresolved'
})
const prepare = (over: Record<string, unknown> = {}) => ({
  repos: [
    { id: 'r1', name: 'alpha', worktreeBaseRef: 'origin/main' },
    { id: 'r2', name: 'beta' }
  ],
  orcaCli: true,
  defaultRepoId: 'r1',
  name: 'demo-1-issue-1',
  agents: { installed: ['claude'], other: ['codex'] },
  defaultAgent: 'claude',
  launchMode: 'worktree',
  includeDescription: true,
  promptTemplate: 'Work on {{id}}: {{summary}}',
  vars: { id: 'DEMO-1', summary: 'Issue 1', description: 'Details of the issue' },
  workspaces: [
    { id: 'w1', name: 'main', project: 'alpha' },
    { id: 'w2', name: 'feature' }
  ],
  defaultWorkspaceId: 'w2',
  ...over
})
function requests(over: Record<string, unknown> = {}) {
  return {
    'yt.env': env,
    'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: false, total: 2 }),
    'yt.savedQueries': ok([]),
    'yt.links': ok({}),
    'yt.setQuery': ok({}),
    'yt.issue.get': (i: any) => ok({ ...issue(Number(i.id.split('-')[1])), project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Text', comments: [] }),
    'yt.start.prepare': ok(prepare()),
    'yt.refs.search': (i: any) => ok({ refs: i.query === 'dev' ? ['origin/dev', 'origin/devel'] : ['origin/main', 'origin/other'] }),
    'yt.start.run': ok({ workspaceId: 'w9' }),
    'yt.runInExisting': ok({ terminalId: 't1' }),
    ...over
  }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const table = { type: 'Table' }
const startButton = { role: 'button', text: 'Start' }
const open = async (host: any) => {
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  return view
}
const disabled = (view: any, query: any) => Boolean(view.find(query)?.props.disabled)
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
}

test('defaults come from prepare', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.deepEqual(calls(host, 'yt.start.prepare')[0].input, { server: 'main', id: 'DEMO-1' })
  assert.equal(view.find({ type: 'RadioGroup', label: 'Run in' }).props.value, 'worktree')
  assert.equal(shown(view, 'Project'), 'alpha')
  assert.equal(view.find({ type: 'Input', label: 'Name' }).props.value, 'demo-1-issue-1')
  assert.equal(shown(view, 'Agent'), 'Claude')
  assert.equal(view.find({ type: 'Checkbox', label: 'Include issue description in prompt' }).props.checked, true)
  assert.match(view.find({ type: 'Textarea', label: 'Prompt' }).props.value, /^Work on DEMO-1: Issue 1\n\n--- BEGIN YOUTRACK ISSUE/)
  assert.equal(shown(view, 'Create from'), 'Project default (origin/main)')
  assert.equal(view.find({ role: 'button', text: 'Use project default' }), null)
  assert.equal(view.find({ type: 'Input', label: 'Filter branches' }), null)
  for (const label of ['Project', 'Create from', 'Workspace', 'Agent']) assert.equal(view.find({ type: 'Select', label }), null, label)
  for (const label of ['Project', 'Name', 'Create from', 'Workspace', 'Agent', 'Prompt']) assert.ok(view.find({ type: 'Field', label }), label)
  assert.deepEqual((await optionsOf(view, 'Create from')).map((o) => o.value), ['__default__', 'origin/main', 'origin/other'])
  assert.deepEqual((await optionsOf(view, 'Project')).map((o) => o.label), ['alpha', 'beta'])
  assert.deepEqual(await optionsOf(view, 'Agent'), [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: '__other__', label: 'Other…', description: 'Type an agent id' },
    { value: '__none__', label: 'None (terminal only)' }
  ])
  clean(view)
  await view.unmount()
})

test('mode switch disables project, name, branch and enables workspace', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.equal(comboDisabled(view, 'Workspace'), true)
  assert.ok(!view.find({ text: 'The agent works in this folder on its current branch. No new branch is created.' }))
  await view.select({ type: 'RadioGroup', label: 'Run in' }, 'current')
  assert.equal(comboDisabled(view, 'Project'), true)
  assert.equal(disabled(view, { type: 'Input', label: 'Name' }), true)
  assert.equal(comboDisabled(view, 'Create from'), true)
  assert.equal(comboDisabled(view, 'Workspace'), false)
  assert.equal(shown(view, 'Workspace'), 'feature (current)')
  assert.ok(view.find({ text: 'The agent works in this folder on its current branch. No new branch is created.' }))
  clean(view)
  await view.unmount()
})

test('branch filter queries refs after debounce', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await filterCombo(view, 'Create from', 'dev')
  assert.equal(calls(host, 'yt.refs.search').length, 1)
  await sleep(450)
  await view.settled()
  assert.deepEqual(calls(host, 'yt.refs.search').map((c: any) => c.input), [{ repoId: 'r1', query: '' }, { repoId: 'r1', query: 'dev' }])
  assert.deepEqual((await optionsOf(view, 'Create from')).map((o) => o.value), ['__default__', 'origin/dev', 'origin/devel'])
  assert.ok(view.find({ text: '2 matches' }))
  await pick(view, 'Create from', 'origin/devel')
  assert.equal(isOpen(view, 'Create from'), false)
  assert.equal(shown(view, 'Create from'), 'origin/devel')
  await view.press({ testId: 'Create from:toggle' })
  assert.equal(view.valueOf({ label: 'Filter Create from' }), 'dev')
  await view.press(startButton)
  assert.equal(calls(host, 'yt.start.run')[0].input.baseBranch, 'origin/devel')
  clean(view)
  await view.unmount()
})

test('a chosen branch stays selectable when the filter changes, and choosing the default clears it', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await pick(view, 'Create from', 'origin/main')
  await filterCombo(view, 'Create from', 'dev')
  await sleep(450)
  await view.settled()
  assert.equal(shown(view, 'Create from'), 'origin/main')
  assert.deepEqual((await optionsOf(view, 'Create from')).map((o) => o.value), ['__default__', 'origin/main', 'origin/dev', 'origin/devel'])
  await pick(view, 'Create from', '__default__')
  await view.press(startButton)
  assert.ok(!('baseBranch' in calls(host, 'yt.start.run')[0].input))
  await view.unmount()
})

test('the branch list never shows more than 200 options', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `origin/b${i}`)
  const host = mockHost({ requests: requests({ 'yt.refs.search': ok({ refs: many }) }) })
  const view = await open(host)
  assert.equal((await optionsOf(view, 'Create from')).length, 200)
  await view.unmount()
})

test('project change resets branch', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await filterCombo(view, 'Create from', 'dev')
  await sleep(450)
  await view.settled()
  await pick(view, 'Create from', 'origin/dev')
  await pick(view, 'Project', 'r2')
  assert.equal(shown(view, 'Project'), 'beta')
  assert.equal(shown(view, 'Create from'), 'Project default')
  await view.press({ testId: 'Create from:toggle' })
  assert.equal(view.find({ type: 'Input', label: 'Filter Create from' }).props.value, '')
  await view.press(startButton)
  const input = calls(host, 'yt.start.run')[0].input
  assert.equal(input.repoId, 'r2')
  assert.ok(!('baseBranch' in input))
  clean(view)
  await view.unmount()
})

test('None agent omits agent', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await pick(view, 'Agent', '__none__')
  assert.equal(disabled(view, { type: 'Textarea', label: 'Prompt' }), true)
  await view.press(startButton)
  const input = calls(host, 'yt.start.run')[0].input
  assert.ok(!('agent' in input) && !('prompt' in input))
  assert.deepEqual(input, { server: 'main', id: 'DEMO-1', repoId: 'r1', name: 'demo-1-issue-1' })
  clean(view)
  await view.unmount()
})

test('current workspace needs an agent', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.prepare': ok(prepare({ launchMode: 'current', defaultAgent: '' })) }) })
  const view = await open(host)
  assert.equal(disabled(view, startButton), true)
  assert.ok(view.find({ text: 'Choose an agent to run in the current workspace.' }))
  await pick(view, 'Agent', '__other__')
  await view.type({ type: 'Input', label: 'Agent id' }, 'mytool')
  assert.equal(disabled(view, startButton), false)
  await view.press(startButton)
  const input = calls(host, 'yt.runInExisting')[0].input
  assert.equal(input.agent, 'mytool')
  assert.equal(input.workspaceId, 'w2')
  assert.equal(input.server, 'main')
  assert.match(input.prompt, /^Work on DEMO-1/)
  await view.unmount()
})

test('include description rebuilds prompt', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  const prompt = () => view.find({ type: 'Textarea', label: 'Prompt' }).props.value as string
  assert.match(prompt(), /Details of the issue/)
  await view.toggle({ type: 'Checkbox', label: 'Include issue description in prompt' })
  assert.equal(prompt(), 'Work on DEMO-1: Issue 1')
  await view.toggle({ type: 'Checkbox', label: 'Include issue description in prompt' })
  assert.match(prompt(), /Details of the issue/)
  // an edited prompt is kept, until reset
  await view.type({ type: 'Textarea', label: 'Prompt' }, 'My own prompt', { replace: true })
  await view.toggle({ type: 'Checkbox', label: 'Include issue description in prompt' })
  assert.equal(prompt(), 'My own prompt')
  await view.press({ role: 'button', text: 'Reset to template' })
  assert.equal(prompt(), 'Work on DEMO-1: Issue 1')
  clean(view)
  await view.unmount()
})

test('over 4096 disables Start', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.ok(view.find({ text: /^\d+ \/ 4096$/ }))
  await view.type({ type: 'Textarea', label: 'Prompt' }, 'x'.repeat(4097), { replace: true })
  assert.ok(view.find({ text: '4097 / 4096' }))
  assert.equal(disabled(view, startButton), true)
  await view.type({ type: 'Textarea', label: 'Prompt' }, 'x'.repeat(4096), { replace: true })
  assert.equal(disabled(view, startButton), false)
  clean(view)
  await view.unmount()
})

test('start success returns to list with Open', async () => {
  const links: Record<string, string>[] = [{}, { 'DEMO-1': 'w9' }]
  const host = mockHost({ requests: requests({ 'yt.links': () => ok(links.length > 1 ? links.shift()! : links[0]) }) })
  const view = await open(host)
  await view.press(startButton)
  const input = calls(host, 'yt.start.run')[0].input
  assert.equal(input.agent, 'claude')
  assert.equal(input.name, 'demo-1-issue-1')
  assert.equal(input.repoId, 'r1')
  assert.ok(view.find(table))
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  clean(view)
  await view.unmount()
})

test('run error keeps fields', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.run': fail('ORCA_CLI_FAILED', 'Branch already exists') }) })
  const view = await open(host)
  await view.type({ type: 'Input', label: 'Name' }, 'custom-name', { replace: true })
  await view.press(startButton)
  assert.ok(view.find({ text: 'Branch already exists' }))
  assert.equal(view.find({ type: 'Input', label: 'Name' }).props.value, 'custom-name')
  assert.equal(view.find(table), null)
  assert.equal(disabled(view, startButton), false)
  clean(view)
  await view.unmount()
})

test('no orca cli disables new worktree', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.prepare': ok(prepare({ orcaCli: false })) }) })
  const view = await open(host)
  assert.ok(view.find({ text: 'Orca CLI not found — new worktrees are unavailable.' }))
  const radio = view.find({ type: 'RadioGroup', label: 'Run in' })
  assert.equal(radio.props.value, 'current')
  assert.equal(radio.props.options.find((o: any) => o.value === 'worktree').disabled, true)
  clean(view)
  await view.unmount()
})

test('prepare error offers retry and back', async () => {
  let n = 0
  const host = mockHost({ requests: requests({ 'yt.start.prepare': () => (n++ === 0 ? fail('NOT_FOUND', 'Issue not found') : ok(prepare())) }) })
  const view = await open(host)
  assert.ok(view.find({ text: 'Issue not found' }))
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ type: 'Input', label: 'Name' }))
  await view.press({ role: 'button', text: '← Back' })
  assert.ok(view.find(table))
  await view.unmount()
})

test('branch list shows on open and after a project change', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  assert.deepEqual(calls(host, 'yt.refs.search').map((c: any) => c.input), [{ repoId: 'r1', query: '' }])
  assert.ok((await optionsOf(view, 'Create from')).some((o) => o.value === 'origin/main'))
  await pick(view, 'Project', 'r2')
  assert.deepEqual(calls(host, 'yt.refs.search').at(-1).input, { repoId: 'r2', query: '' })
  assert.ok((await optionsOf(view, 'Create from')).some((o) => o.value === 'origin/other'))
  await view.select({ type: 'RadioGroup', label: 'Run in' }, 'current')
  assert.equal(comboDisabled(view, 'Create from'), true)
  clean(view)
  await view.unmount()
})

test('no default workspace is not guessed', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.prepare': ok(prepare({ launchMode: 'current', defaultWorkspaceId: null })) }) })
  const view = await open(host)
  assert.equal(shown(view, 'Workspace'), 'Choose a workspace')
  assert.equal(disabled(view, startButton), true)
  await pick(view, 'Workspace', 'w1')
  assert.equal(disabled(view, startButton), false)
  clean(view)
  await view.unmount()
})

test('a second press while running sends nothing', async () => {
  let release: (value: unknown) => void = () => {}
  const pending = new Promise((resolve) => { release = resolve })
  const host = mockHost({ requests: requests({ 'yt.start.run': () => pending.then(() => ok({ workspaceId: 'w9' })) }) })
  const view = await open(host)
  const first = view.press(startButton)
  await sleep(30)
  assert.equal(disabled(view, startButton), true)
  assert.equal(disabled(view, { role: 'button', text: '← Back' }), true)
  await view.press(startButton).catch(() => {})
  assert.equal(calls(host, 'yt.start.run').length, 1)
  release(null)
  await first
  assert.ok(view.find(table))
  assert.equal(calls(host, 'yt.start.run').length, 1)
  clean(view)
  await view.unmount()
})

test('starting waits up to two minutes for the worker', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await view.press(startButton)
  assert.equal(calls(host, 'yt.start.run')[0].timeoutMs, 120_000)
  await view.unmount()
  const current = mockHost({ requests: requests({ 'yt.start.prepare': ok(prepare({ launchMode: 'current' })) }) })
  const other = await open(current)
  await other.press(startButton)
  assert.equal(calls(current, 'yt.runInExisting')[0].timeoutMs, 120_000)
  await other.unmount()
})

test('a start that times out is not offered again until the form is reloaded', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.run': () => { throw hostError('timeout') } }) })
  const view = await open(host)
  await view.press(startButton)
  clean(view)
  assert.ok(view.find({ text: 'Still starting — check the Orca sidebar before trying again.' }))
  assert.equal(disabled(view, startButton), true)
  await view.press({ role: 'button', text: '← Back' })
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  assert.equal(disabled(view, startButton), false)
  await view.unmount()
})

test('a start with a warning returns to the list and shows the warning', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.run': ok({ workspaceId: 'w9', warning: 'Started, but not remembered.' }) }) })
  const view = await open(host)
  await view.press(startButton)
  clean(view)
  assert.ok(view.find(table))
  assert.ok(view.find({ text: 'Started, but not remembered.' }))
  await view.unmount()
})

test('agents are grouped as installed and other, and filtering finds one', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await view.press({ testId: 'Agent:toggle' })
  assert.ok(view.find({ text: 'Installed' }))
  assert.ok(view.find({ text: 'Other agents' }))
  await filterCombo(view, 'Agent', 'cod')
  assert.deepEqual((await optionsOf(view, 'Agent')).map((o) => o.value), ['codex'])
  await pick(view, 'Agent', 'codex')
  assert.equal(shown(view, 'Agent'), 'Codex')
  await view.press(startButton)
  assert.equal(calls(host, 'yt.start.run')[0].input.agent, 'codex')
  clean(view)
  await view.unmount()
})

test('workspaces are named by project and branch, the current project first', async () => {
  const workspaces = [
    { id: 'w1', name: 'main', project: 'beta', branch: 'main' },
    { id: 'w2', name: 'main', project: 'alpha', branch: 'main' },
    { id: 'w3', name: 'feature', project: 'alpha', branch: 'feat/x' },
    { id: 'w4', name: 'loose' },
    { id: 'w5', name: 'api', project: 'beta' }
  ]
  const host = mockHost({ requests: requests({ 'yt.start.prepare': ok(prepare({ launchMode: 'current', workspaces, defaultWorkspaceId: 'w1' })) }) })
  const view = await open(host)
  assert.equal(shown(view, 'Workspace'), 'beta / main (current)')
  assert.deepEqual(await optionsOf(view, 'Workspace'), [
    { value: 'w5', label: 'beta / api' },
    { value: 'w1', label: 'beta / main (current)', description: 'main' },
    { value: 'w3', label: 'alpha / feature', description: 'feat/x' },
    { value: 'w2', label: 'alpha / main', description: 'main' },
    { value: 'w4', label: 'loose' }
  ])
  await filterCombo(view, 'Workspace', 'feat/')
  assert.deepEqual((await optionsOf(view, 'Workspace')).map((o) => o.value), ['w3'])
  clean(view)
  await view.unmount()
})

test('Enter in the branch filter waits for the search, then picks its first branch', async () => {
  const host = mockHost({ requests: requests() })
  const view = await open(host)
  await filterCombo(view, 'Create from', 'dev')
  await view.submit({ type: 'Input', label: 'Filter Create from' })
  assert.equal(shown(view, 'Create from'), 'Project default (origin/main)')
  await sleep(450)
  await view.settled()
  await view.submit({ type: 'Input', label: 'Filter Create from' })
  assert.equal(shown(view, 'Create from'), 'origin/dev')
  clean(view)
  await view.unmount()
})
