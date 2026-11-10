import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number, state = 'Open') => ({
  id: `DEMO-${n}`,
  summary: `Issue ${n}`,
  state: { name: state },
  created: 1_690_000_000_000 + n,
  updated: 1_700_000_000_000 + n,
  resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`
})
const detail = (n: number, state: string) => ({
  ...issue(n, state),
  project: { shortName: 'DEMO', name: 'Demo' },
  fields: [{ name: 'State', value: state }],
  descriptionMd: '',
  comments: []
})
const env = ok({
  cli: { found: true },
  orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
  server: 'main',
  query: 'for: me',
  defaultQuery: 'for: me'
})
/** A fake server: an applied "State X" command changes the state the next reads answer. */
function setup(command?: (input: any) => unknown) {
  const state = { value: 'Open' }
  const host = mockHost({
    requests: {
      'yt.env': env,
      'yt.issues.search': () => ok({ issues: [issue(1, state.value), issue(2)], hasMore: false, total: 2 }),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({}),
      'yt.issue.get': (i: any) => ok(detail(Number(i.id.split('-')[1]), i.id === 'DEMO-1' ? state.value : 'Open')),
      'yt.issue.command':
        command ??
        ((input: any) => {
          state.value = input.command.replace(/^State /, '')
          return ok({})
        })
    }
  })
  return { host, state }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const table = { type: 'Table' }
const commandInput = { type: 'Input', label: 'Command' }
const apply = { role: 'button', text: 'Apply' }

test('the row actions apply a command to the selected issue and reload the results', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.equal(view.find(commandInput).props.placeholder, 'State Done')
  assert.equal(view.find(apply).props.disabled, true)
  const searches = calls(host, 'yt.issues.search').length
  const links = calls(host, 'yt.links').length
  await view.type(commandInput, 'State Done')
  assert.equal(calls(host, 'yt.issue.command').length, 0)
  await view.press(apply)
  await view.settled()
  assert.deepEqual(calls(host, 'yt.issue.command')[0].input, { server: 'main', id: 'DEMO-1', command: 'State Done' })
  assert.equal(calls(host, 'yt.issues.search').length, searches + 1)
  assert.equal(calls(host, 'yt.links').length, links + 1)
  assert.ok(view.find({ text: 'Command applied.' }))
  assert.equal(view.valueOf(view.find(commandInput)), '')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('the detail applies a command and loads the issue again', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  const stateField = () => view.find({ type: 'KeyValue' }).props.items.find((i: any) => i.label === 'State').value
  assert.equal(stateField(), 'Open')
  await view.type(commandInput, 'State Fixed')
  await view.press(apply)
  await view.settled()
  assert.deepEqual(calls(host, 'yt.issue.command')[0].input, { server: 'main', id: 'DEMO-1', command: 'State Fixed' })
  assert.equal(calls(host, 'yt.issue.get').length, 2)
  assert.equal(stateField(), 'Fixed')
  assert.ok(view.find({ text: 'Command applied.' }))
  assert.equal(view.valueOf(view.find(commandInput)), '')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a failed command shows the message under the input and keeps the text', async () => {
  const { host } = setup(() => fail('UNKNOWN', 'HTTP 400: Unknown command: Stat'))
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.type(commandInput, 'Stat Done')
  await view.press(apply)
  await view.settled()
  assert.ok(view.find({ text: 'HTTP 400: Unknown command: Stat' }))
  assert.equal(view.valueOf(view.find(commandInput)), 'Stat Done')
  assert.equal(view.find(commandInput).props.invalid, true)
  assert.equal(view.find({ text: 'Command applied.' }), null)
  assert.equal(calls(host, 'yt.issue.get').length, 1)
  await view.unmount()
})

test('enter in the command input applies nothing; only Apply does', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.type(commandInput, 'State Done', { submit: true })
  await view.settled()
  assert.equal(calls(host, 'yt.issue.command').length, 0)
  await view.unmount()
})

test('the command text and its result belong to one issue', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.type(commandInput, 'State Done')
  await view.selectRows(view.find(table), ['DEMO-2'])
  assert.equal(view.valueOf(view.find(commandInput)), '')
  await view.unmount()
})

const later = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

test('a command still running when another issue is selected refreshes the list and keeps its result', async () => {
  const { host } = setup(() => later(30, ok({})))
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.type(commandInput, 'State Done')
  const searches = calls(host, 'yt.issues.search').length
  const links = calls(host, 'yt.links').length
  const pressing = view.press(apply)
  await view.selectRows(view.find(table), ['DEMO-2'])
  await pressing
  await view.settled()
  assert.equal(calls(host, 'yt.issues.search').length, searches + 1)
  assert.equal(calls(host, 'yt.links').length, links + 1)
  assert.equal(view.find({ text: 'Command applied.' }), null)
  assert.equal(view.valueOf(view.find(commandInput)), '')
  await view.selectRows(view.find(table), ['DEMO-1'])
  assert.ok(view.find({ text: 'Command applied.' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a second press while the command of that issue runs sends nothing', async () => {
  const { host } = setup(() => later(20, ok({})))
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.type(commandInput, 'State Done')
  // Both presses reach the same drawn button before the busy state is drawn.
  await Promise.all([view.press(apply), view.press(apply)])
  await view.settled()
  assert.equal(calls(host, 'yt.issue.command').length, 1)
  await view.unmount()
})

test('a command applied from a detail that was left reloads the list, not the issue', async () => {
  const { host } = setup(() => later(30, ok({})))
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  await view.type(commandInput, 'State Done')
  const searches = calls(host, 'yt.issues.search').length
  const pressing = view.press(apply)
  await view.press({ role: 'button', text: '← Back' })
  await pressing
  await view.settled()
  assert.equal(calls(host, 'yt.issue.get').length, 1)
  assert.equal(calls(host, 'yt.issues.search').length, searches + 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an open detail reloads the issue and the list behind it', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.activateRow(view.find(table), 'DEMO-1')
  const searches = calls(host, 'yt.issues.search').length
  await view.type(commandInput, 'State Done')
  await view.press(apply)
  await view.settled()
  assert.equal(calls(host, 'yt.issue.get').length, 2)
  assert.equal(calls(host, 'yt.issues.search').length, searches + 1)
  await view.unmount()
})

test('a timed out command says it may have been applied, refreshes and is not sent again', async () => {
  const { host } = setup(() => fail('TIMEOUT', 'The youtrack CLI did not answer in time.'))
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.type(commandInput, 'State Done')
  const searches = calls(host, 'yt.issues.search').length
  await view.press(apply)
  await view.settled()
  assert.ok(view.find({ text: 'The command may have been applied. Refresh before trying again.' }))
  assert.equal(view.find({ text: 'Command applied.' }), null)
  assert.equal(calls(host, 'yt.issues.search').length, searches + 1)
  assert.equal(calls(host, 'yt.issue.command').length, 1)
  await view.unmount()
})

test('the refresh after a command runs the applied query and keeps the query being typed', async () => {
  const { host } = setup()
  const view = await mount(panel, { host })
  await view.selectRows(view.find(table), ['DEMO-1'])
  await view.type({ type: 'Input', label: 'Query' }, 'project: OTHER', { replace: true })
  await view.type(commandInput, 'State Done')
  await view.press(apply)
  await view.settled()
  assert.equal(calls(host, 'yt.issues.search').at(-1).input.query, 'for: me')
  assert.equal(view.valueOf(view.find({ type: 'Input', label: 'Query' })), 'project: OTHER')
  await view.unmount()
})
