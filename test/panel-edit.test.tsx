import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const row = { id: 'DEMO-1', summary: 'Old title', created: 1, updated: 2, resolved: false, url: 'https://main.example.com/issue/DEMO-1' }
const detail = { ...row, project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: 'Old body', comments: [], tags: [] }
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
  server: 'main', query: '', defaultQuery: ''
})
function host(update: (input: any) => unknown = () => ok({})) {
  return mockHost({
    requests: {
      'yt.env': env, 'yt.issues.search': ok({ issues: [row], hasMore: false, total: 1 }), 'yt.savedQueries': ok([]),
      'yt.links': ok({}), 'yt.setQuery': ok({}), 'yt.current': ok({ issue: null }), 'yt.issue.get': ok(detail), 'yt.issue.update': update
    }
  })
}
const calls = (h: any, name: string) => h.callsOf('plugin.request').filter((c: any) => c.name === name)
async function editing(h: any) {
  const view = await mount(panel, { host: h })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  await view.press({ label: 'Edit summary and description' })
  return view
}

test('editing sends only what changed and shows the issue again', async () => {
  const h = host()
  const view = await editing(h)
  assert.equal(view.find({ type: 'Input', label: 'Summary' }).props.value, 'Old title')
  assert.equal(view.find({ type: 'Textarea', label: 'Description' }).props.value, 'Old body')
  const loads = calls(h, 'yt.issue.get').length
  await view.type({ type: 'Input', label: 'Summary' }, 'New title', { replace: true })
  await view.press({ role: 'button', text: 'Save' })
  assert.deepEqual(calls(h, 'yt.issue.update')[0].input, { server: 'main', id: 'DEMO-1', summary: 'New title' })
  assert.equal(calls(h, 'yt.issue.get').length, loads + 1)
  assert.equal(view.find({ type: 'Input', label: 'Summary' }), null)
  await view.unmount()
})

test('a failed save keeps the draft and says why', async () => {
  const h = host(() => ({ ok: false, error: { code: 'FORBIDDEN', message: 'No permission to update' } }))
  const view = await editing(h)
  await view.type({ type: 'Textarea', label: 'Description' }, 'Draft body', { replace: true })
  await view.press({ role: 'button', text: 'Save' })
  assert.deepEqual(calls(h, 'yt.issue.update')[0].input, { server: 'main', id: 'DEMO-1', description: 'Draft body' })
  assert.ok(view.find({ text: 'No permission to update' }))
  assert.equal(view.find({ type: 'Textarea', label: 'Description' }).props.value, 'Draft body')
  await view.unmount()
})

test('cancel leaves the issue as it was, and an empty summary cannot be saved', async () => {
  const h = host()
  const view = await editing(h)
  await view.type({ type: 'Input', label: 'Summary' }, '', { replace: true })
  assert.equal(view.find({ role: 'button', text: 'Save' }).props.disabled, true)
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(calls(h, 'yt.issue.update').length, 0)
  assert.ok(view.find({ text: 'Old title' }))
  await view.unmount()
})
