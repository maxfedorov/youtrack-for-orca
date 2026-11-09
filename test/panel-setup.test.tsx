import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const server = (alias: string, status = 'authenticated') => ({ alias, url: `https://${alias}.example.com`, active: false, status })
const env = (over: Record<string, unknown> = {}) =>
  ok({ cli: { found: true }, orcaCli: { found: true }, servers: [server('main')], server: 'main', query: 'for: me', ...over })

test('no CLI shows install screen', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ cli: { found: false }, servers: [], server: null }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'EmptyState', label: 'Install youtrack CLI' }))
  assert.ok(view.find({ role: 'button', text: 'Open terminal with command' }))
  assert.ok(view.find({ role: 'button', text: 'Check again' }))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('Check again re-requests env', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ cli: { found: false }, servers: [], server: null }) } })
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
  assert.deepEqual(host.callsOf('plugin.request').at(-1), { name: 'yt.setServer', input: { server: 'other' } })
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
  assert.deepEqual(second.errors, [])
  await second.unmount()
})
