import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const server = (alias: string, status = 'authenticated') => ({ alias, url: `https://${alias}.example.com`, active: false, status })
const env = (over: Record<string, unknown> = {}) =>
  ok({ cli: { found: true }, orcaCli: { found: true }, servers: [server('main')], server: 'main', query: 'for: me', ...over })

test('no CLI shows install screen', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ cli: { found: false, installCommand: 'brew install jetbrains/utils/youtrack' }, servers: [], server: null }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'EmptyState', label: 'Install youtrack CLI' }))
  assert.ok(view.find({ type: 'Code', text: 'brew install jetbrains/utils/youtrack' }))
  assert.ok(view.find({ role: 'button', text: 'Open terminal with command' }))
  assert.ok(view.find({ role: 'button', text: 'Check again' }))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('Check again re-requests env', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ cli: { found: false, installCommand: 'brew install jetbrains/utils/youtrack' }, servers: [], server: null }) } })
  const view = await mount(panel, { host })
  const before = host.callsOf('plugin.request').length
  await view.press({ role: 'button', text: 'Check again' })
  assert.equal(host.callsOf('plugin.request').length, before + 1)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('no servers shows add server', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ servers: [], server: null }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add a YouTrack server' }))
  assert.ok(view.find({ role: 'button', text: 'Add server' }))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('add server waits for sign-in, then fails with terminal fallback', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ servers: [], server: null }), 'yt.servers.add': ok({ started: true }), 'yt.terminal.run': ok({}) } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Server URL' }, 'https://yt.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  assert.ok(view.find({ text: 'Waiting for sign-in in the browser…' }))
  await view.post('yt.servers.authUrl', { url: 'https://yt.example.com/auth' })
  assert.ok(view.find({ type: 'Link' }))
  await view.post('yt.servers.added', { ok: false, error: { code: 'UNKNOWN', message: 'Sign-in failed' } })
  assert.ok(view.find({ text: 'Sign-in failed' }))
  await view.press({ role: 'button', text: 'Sign in in terminal' })
  assert.deepEqual(host.callsOf('plugin.request').at(-1), { name: 'yt.terminal.run', input: { command: 'login', url: 'https://yt.example.com' } })
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('server select persists via yt.setServer', async () => {
  const host = mockHost({
    requests: {
      'yt.env': env({ servers: [server('main'), server('other')] }),
      'yt.setServer': ok({})
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: 'Server' }, 'other')
  assert.ok(host.callsOf('plugin.request').some((c) => c.name === 'yt.setServer' && c.input.server === 'other'))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('expired server shows Sign in again', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ servers: [server('main', 'expired')] }), 'yt.terminal.run': ok({}) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Signed out' }))
  await view.press({ role: 'button', text: 'Sign in again' })
  assert.deepEqual(host.callsOf('plugin.request').at(-1), { name: 'yt.terminal.run', input: { command: 'login', url: 'https://main.example.com' } })
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('authenticated server has no badge; request error is shown', async () => {
  const host = mockHost({ requests: { 'yt.env': env() } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: 'Signed out' }), null)
  await view.unmount()
  const failing = mockHost({ requests: { 'yt.env': { ok: false, error: { code: 'UNKNOWN', message: 'boom' } } } })
  const second = await mount(panel, { host: failing })
  assert.ok(second.find({ text: 'boom' }))
  assert.ok(second.find({ role: 'button', text: 'Retry' }))
  assert.deepEqual(second.errors, [])
  await second.unmount()
})

test('Retry recovers from a failed env and clears the error', async () => {
  let n = 0
  const host = mockHost({
    requests: { 'yt.env': () => (n++ === 0 ? { ok: false, error: { code: 'UNKNOWN', message: 'boom' } } : env()), 'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }) }
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', text: 'Retry' })
  assert.equal(view.find({ text: 'boom' }), null)
  assert.equal(view.find({ role: 'button', text: 'Retry' }), null)
  await view.unmount()
})

test('failed setServer reverts the select', async () => {
  const host = mockHost({
    requests: { 'yt.env': env({ servers: [server('main'), server('other')] }), 'yt.setServer': { ok: false, error: { code: 'UNKNOWN', message: 'nope' } } }
  })
  const view = await mount(panel, { host })
  await view.select({ label: 'Server' }, 'other')
  assert.equal(view.valueOf({ label: 'Server' }), 'main')
  assert.ok(view.find({ text: 'nope' }))
  await view.unmount()
})

test('non-http auth url is plain text', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ servers: [], server: null }), 'yt.servers.add': ok({ started: true }) } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Server URL' }, 'https://yt.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  await view.post('yt.servers.authUrl', { url: 'javascript:alert(1)' })
  assert.equal(view.find({ type: 'Link' }), null)
  assert.ok(view.find({ text: 'javascript:alert(1)' }))
  await view.unmount()
})

test('a request that finds the CLI gone returns to the install screen', async () => {
  let gone = false
  const host = mockHost({
    requests: {
      'yt.env': () =>
        gone
          ? env({ cli: { found: false, installCommand: 'brew install jetbrains/utils/youtrack' }, servers: [], server: null })
          : env(),
      'yt.issues.search': () => (gone ? { ok: false, error: { code: 'CLI_NOT_FOUND', message: 'The youtrack CLI was not found.' } } : ok({ issues: [], hasMore: false, total: 0 })),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({})
    }
  })
  const view = await mount(panel, { host })
  gone = true
  await view.press({ role: 'button', label: 'Refresh' })
  assert.ok(view.find({ type: 'EmptyState', label: 'Install youtrack CLI' }))
  assert.equal(view.find({ type: 'Callout' }), null)
  await view.unmount()
})

test('a failed instance list shows the error with Retry instead of the add form', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ servers: [], server: null, error: 'broken config' }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'broken config' }))
  assert.ok(view.find({ role: 'button', text: 'Retry' }))
  assert.equal(view.find({ text: 'Add a YouTrack server' }), null)
  await view.unmount()
})
