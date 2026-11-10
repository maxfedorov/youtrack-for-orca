import { assert, hostError, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const issue = {
  id: 'DEMO-1', summary: 'Issue 1', created: 1, updated: 2, resolved: false, url: 'https://main.example.com/issue/DEMO-1'
}
const requests = {
  'yt.env': ok({
    cli: { found: true }, orcaCli: { found: true },
    servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
    server: 'main', query: 'q', defaultQuery: 'q'
  }),
  'yt.issues.search': ok({ issues: [issue], hasMore: false, total: 1 }),
  'yt.savedQueries': ok([]),
  'yt.links': ok({}),
  'yt.setQuery': ok({}),
  'yt.issue.get': ok({ ...issue, project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: '', comments: [] })
}

test('a browser link that fails to open shows an error and the panel keeps working', async () => {
  const host = mockHost({ requests, results: { 'shell.openExternal': () => { throw hostError('action_failed') } } })
  const view = await mount(panel, { host })
  await view.selectRows(view.find({ type: 'Table' }), ['DEMO-1'])
  await view.press({ role: 'button', label: 'Open in browser' })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  await view.press({ role: 'button', label: 'Open in browser' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(host.callsOf('shell.openExternal').length, 2)
  assert.deepEqual(view.errors, [])
  assert.ok(view.find({ type: 'Heading', text: 'Issue 1' }))
  assert.ok(view.find({ text: 'Could not open the browser. Try again.' }))
  await view.unmount()
})
