import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number, host = 'main') => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, created: 1, updated: 2, resolved: false, url: `https://${host}.example.com/issue/DEMO-${n}`
})
const all = [
  { alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' },
  { alias: 'other', url: 'https://other.example.com', active: false, status: 'authenticated' }
]
const QUESTION = 'Remove main? This signs the YouTrack CLI out of it.'

function setup(over: Record<string, unknown> = {}) {
  let servers = [...all]
  const host = mockHost({
    requests: {
      'yt.env': () => ok({ cli: { found: true }, orcaCli: { found: true }, servers, server: servers[0]?.alias ?? null, query: 'q', defaultQuery: 'q' }),
      'yt.setServer': ok({}),
      'yt.issues.search': (i: any) => ok({ issues: i.server === 'main' ? [issue(1)] : [issue(7, 'other')], hasMore: false, total: 1 }),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({}),
      'yt.servers.remove': (i: any) => ((servers = servers.filter((s) => s.alias !== i.server)), ok({})),
      ...over
    }
  })
  return { host, keep: (list: typeof all) => (servers = list) }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const removeButton = { role: 'button', label: 'Remove server' }
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
}

test('removing asks first; Cancel removes nothing', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  const button = view.find(removeButton)
  assert.equal(button.props.tone, 'danger')
  assert.equal(button.props.icon, 'delete')
  // A ghost IconButton is drawn without its tone; outline + danger is drawn red.
  assert.equal(button.props.variant, 'outline')
  await view.press(removeButton)
  assert.ok(view.find({ text: QUESTION }))
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(view.find({ text: QUESTION }), null)
  assert.equal(calls(host, 'yt.servers.remove').length, 0)
  clean(view)
  await view.unmount()
})

test('removing the selected server switches to the next one and loads its list', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.press(removeButton)
  await view.press({ role: 'button', text: 'Remove' })
  assert.deepEqual(calls(host, 'yt.servers.remove').map((c: any) => c.input), [{ server: 'main' }])
  assert.equal(view.find({ text: QUESTION }), null)
  assert.equal(view.find({ type: 'Select', label: 'Server' }).props.value, 'other')
  assert.deepEqual(view.find({ type: 'Select', label: 'Server' }).props.options.map((o: any) => o.value), ['other'])
  assert.deepEqual(view.rowsOf(view.find({ type: 'Table' })), ['DEMO-7'])
  clean(view)
  await view.unmount()
})

test('removing the last server shows the add-server screen', async () => {
  const { host, keep } = setup()
  keep([all[0]])
  const view = await mount(panel, { host })
  await view.press(removeButton)
  await view.press({ role: 'button', text: 'Remove' })
  assert.ok(view.find({ text: 'Add a YouTrack server' }))
  assert.equal(view.find({ type: 'Select', label: 'Server' }), null)
  clean(view)
  await view.unmount()
})

test('a failed removal keeps the question open with the reason', async () => {
  const { host } = setup({ 'yt.servers.remove': fail('UNKNOWN', 'config is locked') })
  const view = await mount(panel, { host })
  await view.press(removeButton)
  await view.press({ role: 'button', text: 'Remove' })
  assert.ok(view.find({ text: QUESTION }))
  assert.ok(view.find({ text: 'config is locked' }))
  assert.equal(view.find({ type: 'Select', label: 'Server' }).props.value, 'main')
  clean(view)
  await view.unmount()
})

test('a removal that could not clear its saved data still switches and shows the warning', async () => {
  let servers = [...all]
  const { host } = setup({
    'yt.env': () => ok({ cli: { found: true }, orcaCli: { found: true }, servers, server: servers[0].alias, query: 'q', defaultQuery: 'q' }),
    'yt.servers.remove': () => ((servers = [all[1]]), ok({ warning: 'The server was removed, but not forgotten.' }))
  })
  const view = await mount(panel, { host })
  await view.press(removeButton)
  await view.press({ role: 'button', text: 'Remove' })
  assert.equal(view.find({ type: 'Select', label: 'Server' }).props.value, 'other')
  assert.ok(view.find({ text: 'The server was removed, but not forgotten.' }))
  clean(view)
  await view.unmount()
})

/** The Rows of the drawn tree that hold the server Select, outermost first. */
function rowsAround(node: any, out: any[] = []): any[] | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'Select' && node.props?.label === 'Server') return out
  for (const child of node.children ?? []) {
    const found = rowsAround(child, node.type === 'Row' ? [...out, node] : out)
    if (found) return found
  }
  return null
}

test('the header buttons line up with the server control, not its label', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  const rows = rowsAround(view.tree()) ?? []
  assert.equal(rows.length, 2)
  for (const row of rows) assert.equal(row.props.align, 'end')
  await view.unmount()
})
