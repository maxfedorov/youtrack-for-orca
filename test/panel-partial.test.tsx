import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'
import { optionsOf, shown } from './combo'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, state: { name: 'Open' }, priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' }, created: 1_690_000_000_000 + n, updated: 1_700_000_000_000 + n, resolved: false,
  url: `https://main.example.com/issue/DEMO-${n}`
})
const COMMENT = { id: 'c1', author: { login: 'bob', fullName: 'Bob Roe' }, created: 1_700_000_100_000, textMd: 'First comment' }
const detail = (n: number, over: Record<string, unknown> = {}) => ({
  ...issue(n),
  project: { shortName: 'DEMO', name: 'Demo' },
  fields: [{ name: 'State', value: 'Open' }, { name: 'Estimation', value: '2h' }],
  descriptionMd: `Description of issue ${n}`,
  comments: [COMMENT],
  ...over
})
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: 'for: me', defaultQuery: 'for: me'
})
const prepare = (over: Record<string, unknown> = {}) => ({
  repos: [{ id: 'r1', name: 'alpha' }], orcaCli: true, defaultRepoId: 'r1', name: 'demo-1', agents: { installed: ['claude'], other: ['codex'] },
  defaultAgent: 'claude', launchMode: 'worktree', includeDescription: false, templates: [{ id: 't', name: 'T', body: 'Do {{id}}' }], defaultTemplateId: 't', vars: { id: 'DEMO-1' },
  workspaces: [{ id: 'w1', name: 'main' }], defaultWorkspaceId: 'w1', ...over
})
function requests(over: Record<string, unknown> = {}) {
  return {
    'yt.env': env,
    'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: false, total: 2 }),
    'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'for: me' }]),
    'yt.links': ok({}),
    'yt.setQuery': ok({}),
    'yt.issue.get': ok(detail(1)),
    'yt.issue.comments': ok({ comments: [COMMENT] }),
    'yt.start.prepare': ok(prepare()),
    'yt.refs.search': ok({ refs: ['main'] }),
    'yt.start.run': ok({ workspaceId: 'w9' }),
    'yt.runInExisting': ok({}),
    ...over
  }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const table = { type: 'Table' }
const danger = (view: any) => view.findAll({ type: 'Callout' }).filter((c: any) => c.props.tone === 'danger')
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
}
const openIssue = async (host: any, id = 'DEMO-1') => {
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), id)
  return view
}

test('an issue whose comments failed shows the issue, a comments note and a Retry for the comments only', async () => {
  let n = 0
  const host = mockHost({
    requests: requests({
      'yt.issue.get': ok(detail(1, { comments: [], commentsError: 'Comments could not be loaded.' })),
      'yt.issue.comments': () => (n++ === 0 ? fail('NETWORK', 'Cannot reach the server') : ok({ comments: [COMMENT] }))
    })
  })
  const view = await openIssue(host)
  clean(view)
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.equal(view.find({ type: 'Markdown' }).props.content, 'Description of issue 1')
  assert.ok(view.find({ type: 'KeyValue' }))
  assert.equal(danger(view).length, 0)
  assert.ok(view.find({ text: 'Comments could not be loaded.' }))
  assert.equal(view.find({ text: 'No comments' }), null)
  await view.press({ role: 'button', text: 'Retry' })
  assert.deepEqual(calls(host, 'yt.issue.comments')[0].input, { server: 'main', id: 'DEMO-1' })
  assert.equal(calls(host, 'yt.issue.get').length, 1)
  assert.ok(view.find({ text: 'Cannot reach the server' }))
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  assert.equal(view.find({ text: 'Comments could not be loaded.' }), null)
  assert.equal(calls(host, 'yt.issue.get').length, 1)
  clean(view)
  await view.unmount()
})

test('a field of an unexpected shape is n/a and the rest of the issue is shown', async () => {
  const fields = [{ name: 'State', value: 'Open' }, { name: 'Odd', value: { x: 1 } }, { value: 'no name' }, null, { name: 'Estimation', value: '2h' }]
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok(detail(1, { fields })) }) })
  const view = await openIssue(host)
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual(view.find({ type: 'KeyValue' }).props.items.map((i: any) => [i.label, i.value]), [
    ['State', 'Open'], ['Odd', 'n/a'], ['Estimation', '2h']
  ])
  assert.ok(view.find({ type: 'Markdown', content: 'Description of issue 1' }))
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  await view.unmount()
})

test('fields, description or comments of an unexpected shape do not hide the issue', async () => {
  const odd = { id: 'c2', author: null, created: 'yesterday', textMd: 'Odd comment' }
  const host = mockHost({
    requests: requests({ 'yt.issue.get': ok(detail(1, { fields: 'x', descriptionMd: 5, comments: [COMMENT, null, { id: 'c3' }, odd] })) })
  })
  const view = await openIssue(host)
  clean(view)
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.equal(view.find({ type: 'KeyValue' }), null)
  assert.ok(view.find({ text: 'No description' }))
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  assert.ok(view.find({ type: 'Markdown', content: 'Odd comment' }))
  assert.ok(view.find({ text: 'Unknown author' }))
  await view.unmount()
})

test('comments that are not a list are reported as not loaded, with Retry', async () => {
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok(detail(1, { comments: 'x' })) }) })
  const view = await openIssue(host)
  clean(view)
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.ok(view.find({ text: 'Comments could not be loaded.' }))
  await view.press({ role: 'button', text: 'Retry' })
  assert.ok(view.find({ type: 'Markdown', content: 'First comment' }))
  await view.unmount()
})

test('an issue answer without an id is still a whole-card error', async () => {
  const host = mockHost({ requests: requests({ 'yt.issue.get': ok({ ...detail(1), id: 5 }) }) })
  const view = await openIssue(host)
  clean(view)
  assert.equal(danger(view).length, 1)
  assert.ok(view.find({ role: 'button', text: 'Retry' }))
  await view.unmount()
})

test('a malformed issue row is skipped or shown with n/a cells, the rest of the page is shown', async () => {
  const rows = [
    issue(1),
    null,
    { summary: 'no id' },
    { ...issue(3), summary: 7, fields: { 'field:state': 7, 'field:priority': 'Major' }, created: 'soon' },
    issue(4)
  ]
  const host = mockHost({
    requests: requests({ 'yt.issues.search': ok({ issues: rows, hasMore: false, total: 'many' }), 'yt.issue.get': ok(detail(4)) })
  })
  const view = await mount(panel, { host })
  clean(view)
  assert.equal(danger(view).length, 0)
  const grid = view.find(table)
  assert.deepEqual(view.rowsOf(grid), ['DEMO-1', 'DEMO-3', 'DEMO-4'])
  const odd = grid.props.rows.find((r: any) => r.key === 'DEMO-3').cells
  assert.equal(odd.summary, 'n/a')
  // a field value of an unexpected shape is left empty; the others stay
  assert.equal(odd['field:state'], null)
  assert.equal(odd.created, 'n/a')
  assert.equal(odd['field:priority'], 'Major')
  assert.ok(view.find({ text: '3 issues' }))
  await view.activateRow(grid, 'DEMO-4')
  assert.ok(view.find({ type: 'Heading', text: 'Issue 4' }))
  await view.unmount()
})

test('saved searches that fail show a note and a reload, and search still works', async () => {
  let n = 0
  const host = mockHost({
    requests: requests({ 'yt.savedQueries': () => (n++ === 0 ? fail('NETWORK', 'down') : ok([{ id: 's1', name: 'Mine', query: 'for: me' }])) })
  })
  const view = await mount(panel, { host })
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  assert.equal(shown(view, 'Saved searches'), 'Saved searches unavailable')
  assert.ok(view.find({ text: 'Saved searches could not be loaded.' }))
  assert.equal(view.find({ text: 'Save the current query with ☆' }), null)
  await view.type({ label: 'Query' }, 'state: Open', { replace: true, submit: true })
  assert.equal(calls(host, 'yt.issues.search').at(-1).input.query, 'state: Open')
  await view.press({ role: 'button', label: 'Reload saved searches' })
  assert.equal(view.find({ text: 'Saved searches could not be loaded.' }), null)
  assert.deepEqual(await optionsOf(view, 'Saved searches'), [{ value: 's1', label: 'Mine' }])
  clean(view)
  await view.unmount()
})

test('workspace links that fail leave out Open buttons with a small note and a reload', async () => {
  let n = 0
  const host = mockHost({ requests: requests({ 'yt.links': () => (n++ === 0 ? fail('UNKNOWN', 'host down') : ok({ 'DEMO-1': 'ws-1' })) }) })
  const view = await mount(panel, { host })
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  assert.ok(view.find({ text: 'Workspace links could not be loaded.' }))
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.equal(view.find({ role: 'button', text: 'Open →' }), null)
  await view.press({ role: 'button', label: 'Reload workspace links' })
  assert.equal(view.find({ text: 'Workspace links could not be loaded.' }), null)
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  await view.unmount()
})

test('a search without a count shows the rows and a plus count', async () => {
  const host = mockHost({ requests: requests({ 'yt.issues.search': ok({ issues: [issue(1), issue(2)], hasMore: true }) }) })
  const view = await mount(panel, { host })
  clean(view)
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  assert.ok(view.find({ text: '2+ issues' }))
  await view.unmount()
})

const openStart = async (host: any) => {
  const view = await openIssue(host)
  await view.press({ role: 'button', text: 'Start →' })
  return view
}
const startButton = { role: 'button', text: 'Start' }
const option = (view: any, value: string) => view.find({ type: 'Select', label: 'Run in' }).props.options.find((o: any) => o.value === value)

test('start without repositories: new worktree is off with a reason and the current workspace still starts', async () => {
  const host = mockHost({ requests: requests({ 'yt.start.prepare': ok(prepare({ repos: [], defaultRepoId: null, reposError: 'repo list failed' })) }) })
  const view = await openStart(host)
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.equal(option(view, 'worktree').disabled, true)
  assert.equal(view.find({ type: 'Select', label: 'Run in' }).props.value, 'current')
  assert.ok(view.find({ text: 'Projects could not be loaded, so new worktrees are unavailable: repo list failed' }))
  assert.equal(Boolean(view.find(startButton).props.disabled), false)
  await view.press(startButton)
  assert.equal(calls(host, 'yt.runInExisting')[0].input.workspaceId, 'w1')
  await view.unmount()
})

test('start without workspaces: current workspace is off with a reason and a new worktree still starts', async () => {
  const host = mockHost({
    requests: requests({ 'yt.start.prepare': ok(prepare({ launchMode: 'current', workspaces: [], defaultWorkspaceId: null, workspacesError: 'host down' })) })
  })
  const view = await openStart(host)
  clean(view)
  assert.equal(option(view, 'current').disabled, true)
  assert.equal(view.find({ type: 'Select', label: 'Run in' }).props.value, 'worktree')
  assert.ok(view.find({ text: 'Workspaces could not be loaded, so the current workspace is unavailable: host down' }))
  await view.press(startButton)
  assert.equal(calls(host, 'yt.start.run')[0].input.repoId, 'r1')
  await view.unmount()
})

test('start without agent detection lists every agent under other, with a manual id', async () => {
  const host = mockHost({
    requests: requests({
      'yt.start.prepare': ok(prepare({ agents: { installed: [], other: ['claude', 'codex'] }, agentsError: 'Installed agents could not be detected.' }))
    })
  })
  const view = await openStart(host)
  clean(view)
  assert.ok(view.find({ text: 'Installed agents could not be detected. Every agent is listed under Other agents.' }))
  assert.deepEqual((await optionsOf(view, 'Agent')).map((o) => o.label), ['Claude', 'Codex', 'Other…', 'None (terminal only)'])
  assert.equal(view.find({ text: 'Installed' }), null)
  assert.equal(shown(view, 'Agent'), 'Claude')
  await view.unmount()
})

test('start with branches that fail offers only the project default with a note', async () => {
  const host = mockHost({ requests: requests({ 'yt.refs.search': fail('ORCA_CLI_FAILED', 'git failed') }) })
  const view = await openStart(host)
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual((await optionsOf(view, 'Create from')).map((o) => o.label), ['Project default'])
  assert.ok(view.find({ text: 'Branches could not be loaded, so only the project default is offered. git failed' }))
  await view.press(startButton)
  assert.equal('baseBranch' in calls(host, 'yt.start.run')[0].input, false)
  await view.unmount()
})

test('start with neither repositories nor workspaces shows both reasons and offers no start', async () => {
  const host = mockHost({
    requests: requests({
      'yt.start.prepare': ok(prepare({ repos: [], defaultRepoId: null, reposError: 'a', workspaces: [], defaultWorkspaceId: null, workspacesError: 'b' }))
    })
  })
  const view = await openStart(host)
  clean(view)
  assert.equal(option(view, 'worktree').disabled, true)
  assert.equal(option(view, 'current').disabled, true)
  assert.equal(Boolean(view.find(startButton).props.disabled), true)
  await view.unmount()
})

test('start with issue variables left out builds the prompt with empty text for them', async () => {
  const host = mockHost({
    requests: requests({ 'yt.start.prepare': ok(prepare({ templates: [{ id: 't', name: 'T', body: 'Do {{id}} [{{state}}] [{{assignee}}]' }], defaultTemplateId: 't', vars: { id: 'DEMO-1' } })) })
  })
  const view = await openStart(host)
  clean(view)
  assert.equal(view.find({ type: 'Textarea', label: 'Prompt' }).props.value, 'Do DEMO-1 [] []')
  await view.unmount()
})

test('an environment with odd parts keeps the servers it can read', async () => {
  const odd = ok({
    cli: { found: true, version: 7 }, orcaCli: 'yes',
    servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }, null, { alias: 5 }],
    server: 'main', query: null, defaultQuery: 'for: me'
  })
  const host = mockHost({ requests: requests({ 'yt.env': odd }) })
  const view = await mount(panel, { host })
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual(view.find({ type: 'Select', label: 'Server' }).props.options, [{ value: 'main', label: 'main' }])
  assert.deepEqual(view.rowsOf(view.find(table)), ['DEMO-1', 'DEMO-2'])
  assert.equal(calls(host, 'yt.issues.search')[0].input.query, 'for: me')
  await view.unmount()
})

test('odd saved searches and links are left out, the others are offered', async () => {
  const host = mockHost({
    requests: requests({
      'yt.savedQueries': ok([{ id: 's1', name: 'Mine', query: 'for: me' }, null, { id: 's2' }]),
      'yt.links': ok({ 'DEMO-1': 'ws-1', 'DEMO-2': 5 })
    })
  })
  const view = await mount(panel, { host })
  clean(view)
  assert.deepEqual(await optionsOf(view, 'Saved searches'), [{ value: 's1', label: 'Mine' }])
  assert.equal(view.find({ text: 'Saved searches could not be loaded.' }), null)
  assert.equal(view.find({ text: 'Workspace links could not be loaded.' }), null)
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.ok(view.find({ role: 'button', text: 'Open →' }))
  await view.unmount()
})

test('a start answer with odd projects, workspaces or variables keeps the rest', async () => {
  const host = mockHost({
    requests: requests({
      'yt.start.prepare': ok(prepare({
        repos: [{ id: 'r1', name: 'alpha' }, null, { name: 'no id' }],
        workspaces: [{ id: 'w1', name: 'main' }, 3],
        vars: { id: 'DEMO-1', summary: 9 },
        agents: { installed: 'claude', other: ['codex'] },
        templates: [{ id: 't', name: 'T', body: 'Do {{id}} {{summary}}' }], defaultTemplateId: 't'
      }))
    })
  })
  const view = await openStart(host)
  clean(view)
  assert.equal(danger(view).length, 0)
  assert.deepEqual(await optionsOf(view, 'Project'), [{ value: 'r1', label: 'alpha' }])
  await view.select({ type: 'Select', label: 'Run in' }, 'current')
  assert.deepEqual((await optionsOf(view, 'Workspace')).map((o) => o.value), ['w1'])
  assert.equal(view.find({ type: 'Textarea', label: 'Prompt' }).props.value, 'Do DEMO-1 ')
  assert.ok(view.find({ text: 'Installed agents could not be detected. Every agent is listed under Other agents.' }))
  await view.unmount()
})

test('odd branch names are left out and the others are offered', async () => {
  const host = mockHost({ requests: requests({ 'yt.refs.search': ok({ refs: ['main', null, 4, 'dev'] }) }) })
  const view = await openStart(host)
  clean(view)
  assert.deepEqual((await optionsOf(view, 'Create from')).map((o) => o.value), ['__default__', 'main', 'dev'])
  await view.unmount()
})
