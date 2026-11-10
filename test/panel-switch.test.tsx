import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, state: { name: 'Open' }, created: 1_690_000_000_000 + n, updated: 1_700_000_000_000 + n, resolved: false,
  url: `https://main.example.com/issue/DEMO-${n}`
})
const servers = [
  { alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' },
  { alias: 'other', url: 'https://other.example.com', active: false, status: 'authenticated' }
]

function setup() {
  let chosen = 'main'
  return mockHost({
    requests: {
      'yt.env': () => ok({ cli: { found: true }, orcaCli: { found: true }, servers, server: chosen, query: 'q', defaultQuery: 'q' }),
      'yt.setServer': (i: any) => ((chosen = i.server), ok({})),
      'yt.issues.search': (i: any) => ok({ issues: i.server === 'main' ? [issue(1), issue(2)] : [issue(7)], hasMore: false, total: 1 }),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({}),
      'yt.issue.get': (i: any) => ok({ ...issue(Number(i.id.split('-')[1])), project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Text', comments: [] }),
      'yt.start.prepare': ok({
        repos: [{ id: 'r1', name: 'alpha' }], orcaCli: true, defaultRepoId: 'r1', name: 'demo-1', agents: { installed: ['claude'], other: [] },
        defaultAgent: 'claude', launchMode: 'worktree', includeDescription: false, templates: [{ id: 't', name: 'T', body: 'Work on {{id}}' }], defaultTemplateId: 't',
        vars: { id: 'DEMO-1', summary: 'Issue 1', description: '' }, workspaces: [], defaultWorkspaceId: null
      }),
      'yt.refs.search': ok({ refs: [] })
    }
  })
}
const searches = (host: any) => host.callsOf('plugin.request').filter((c: any) => c.name === 'yt.issues.search')

test('switching server in the detail view returns to the new server list', async () => {
  const host = setup()
  const view = await mount(panel, { host })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  assert.ok(view.find({ role: 'button', text: '← Back' }))
  await view.select({ label: 'Server' }, 'other')
  assert.equal(view.find({ role: 'button', text: '← Back' }), null)
  assert.deepEqual(view.rowsOf(view.find({ type: 'Table' })), ['DEMO-7'])
  assert.equal(searches(host).at(-1).input.server, 'other')
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('switching server in the start view returns to the new server list', async () => {
  const host = setup()
  const view = await mount(panel, { host })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  await view.press({ role: 'button', text: 'Start →' })
  await view.select({ label: 'Server' }, 'other')
  assert.deepEqual(view.rowsOf(view.find({ type: 'Table' })), ['DEMO-7'])
  assert.equal(host.callsOf('plugin.request').filter((c: any) => c.name === 'yt.start.run').length, 0)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
