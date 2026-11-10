import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const server = (alias: string, status = 'authenticated') => ({ alias, url: `https://${alias}.example.com`, active: false, status })
const env = (over: Record<string, unknown> = {}) =>
  ok({ cli: { found: true }, orcaCli: { found: true }, servers: [server('main')], server: 'main', query: 'for: me', ...over })

test('no CLI shows install screen', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ cli: { found: false, installCommand: 'brew install jetbrains/utils/youtrack' }, servers: [], server: null }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'EmptyState', label: 'Install YouTrack CLI' }))
  assert.ok(view.find({ type: 'Code', text: 'brew install jetbrains/utils/youtrack' }))
  assert.equal(view.find({ role: 'button', text: 'Open terminal with command' }), null)
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

test('add server waits for sign-in, then fails and shows the terminal command', async () => {
  let signedIn = false
  const host = mockHost({
    requests: withList({
      'yt.env': () => env(signedIn ? { servers: [server('yt')], server: 'yt' } : { servers: [], server: null }),
      'yt.servers.add': ok({ started: true }),
      'yt.setServer': ok({})
    })
  })
  const view = await mount(panel, { host })
  await view.type({ label: 'Server URL' }, 'https://yt.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  assert.ok(view.find({ text: 'Waiting for sign-in in the browser…' }))
  await view.post('yt.servers.authUrl', { url: 'https://yt.example.com/auth' })
  assert.ok(view.find({ type: 'Link' }))
  await view.post('yt.servers.added', { ok: false, error: { code: 'UNKNOWN', message: 'Sign-in failed' } })
  assert.ok(view.find({ text: 'Sign-in failed' }))
  assert.ok(view.find({ type: 'Code', text: 'youtrack auth login https://yt.example.com' }))
  await view.press({ role: 'button', text: "I've signed in" })
  assert.ok(view.find({ text: 'Not signed in yet.' }))
  signedIn = true
  await view.press({ role: 'button', text: "I've signed in" })
  await view.settled()
  assert.ok(host.callsOf('plugin.request').some((c: any) => c.name === 'yt.setServer' && c.input.server === 'yt'))
  assert.equal(view.find({ text: 'Add a YouTrack server' }), null)
  // the plugin itself never asked anything to open a terminal
  assert.equal(host.callsOf('plugin.request').some((c: any) => c.name === 'yt.terminal.run'), false)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the terminal command can be asked for without trying the browser, and is never a shell injection', async () => {
  const host = mockHost({ requests: { 'yt.env': env({ servers: [], server: null }) } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Server URL' }, 'https://yt.example.com:8443/youtrack')
  await view.press({ role: 'button', text: 'Sign in from a terminal instead' })
  assert.ok(view.find({ type: 'Code', text: 'youtrack auth login https://yt.example.com:8443/youtrack' }))
  assert.equal(host.callsOf('plugin.request').some((c: any) => c.name === 'yt.servers.add'), false)
  await view.type({ label: 'Server URL' }, 'https://x.io; rm -rf ~', { replace: true })
  assert.ok(view.find({ type: 'Code', text: 'youtrack auth login <server-url>' }))
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

test('expired server shows Sign in again with the terminal command', async () => {
  let status = 'expired'
  const host = mockHost({ requests: withList({ 'yt.env': () => env({ servers: [server('main', status)] }) }) })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Signed out' }))
  await view.press({ role: 'button', text: 'Sign in again' })
  assert.ok(view.find({ type: 'Code', text: 'youtrack auth login main' }))
  await view.press({ role: 'button', text: "I've signed in" })
  assert.ok(view.find({ text: 'Not signed in yet.' }))
  status = 'authenticated'
  await view.press({ role: 'button', text: "I've signed in" })
  await view.settled()
  assert.equal(view.find({ text: 'Signed out' }), null)
  assert.equal(view.find({ type: 'Code', text: 'youtrack auth login main' }), null)
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
      'yt.issues.search': () => (gone ? { ok: false, error: { code: 'CLI_NOT_FOUND', message: 'The YouTrack CLI was not found.' } } : ok({ issues: [], hasMore: false, total: 0 })),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({})
    }
  })
  const view = await mount(panel, { host })
  gone = true
  await view.press({ role: 'button', label: 'Refresh' })
  assert.ok(view.find({ type: 'EmptyState', label: 'Install YouTrack CLI' }))
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

const withList = (extra: Record<string, unknown> = {}) => ({
  'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }),
  'yt.savedQueries': ok([]),
  'yt.links': ok({}),
  'yt.setQuery': ok({}),
  ...extra
})
const names = (host: any) => host.callsOf('plugin.request').map((c: any) => c.name)

test('header add button opens the add-server form and back returns to the list', async () => {
  const host = mockHost({ requests: withList({ 'yt.env': env() }) })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Add server' })
  assert.ok(view.find({ text: 'Add a YouTrack server' }))
  assert.ok(view.find({ type: 'Input', label: 'Server URL' }))
  await view.press({ role: 'button', text: '← Back' })
  assert.equal(view.find({ text: 'Add a YouTrack server' }), null)
  assert.ok(view.find({ type: 'Table' }) || view.find({ type: 'EmptyState' }))
  await view.unmount()
})

test('adding a second server shows the sign-in link and failure, then selects the new alias', async () => {
  let chosen = 'main'
  let added = false
  const host = mockHost({
    requests: withList({
      'yt.env': () =>
        env({ servers: added ? [server('main'), server('fresh')] : [server('main')], server: chosen }),
      'yt.servers.add': ok({ started: true }),
      'yt.setServer': (i: any) => ((chosen = i.server), ok({})),
    })
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Add server' })
  await view.type({ label: 'Server URL' }, 'https://fresh.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  assert.ok(view.find({ text: 'Waiting for sign-in in the browser…' }))
  await view.post('yt.servers.authUrl', { url: 'https://fresh.example.com/auth' })
  assert.ok(view.find({ type: 'Link' }))
  await view.post('yt.servers.added', { ok: false, error: { code: 'UNKNOWN', message: 'Sign-in failed' } })
  assert.ok(view.find({ text: 'Sign-in failed' }))
  assert.ok(view.find({ role: 'button', text: "I've signed in" }))
  added = true
  await view.post('yt.servers.added', { ok: true, data: { alias: 'fresh' } })
  assert.ok(host.callsOf('plugin.request').some((c: any) => c.name === 'yt.setServer' && c.input.server === 'fresh'))
  assert.equal(view.valueOf({ label: 'Server' }), 'fresh')
  assert.equal(view.find({ text: 'Add a YouTrack server' }), null)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('refresh re-requests the environment before searching again', async () => {
  const host = mockHost({ requests: withList({ 'yt.env': env() }) })
  const view = await mount(panel, { host })
  const before = names(host).length
  await view.press({ role: 'button', label: 'Refresh' })
  const after = names(host).slice(before)
  assert.equal(after[0], 'yt.env')
  assert.ok(after.includes('yt.issues.search'))
  await view.unmount()
})

test('refresh shows a server that was added elsewhere', async () => {
  let two = false
  const host = mockHost({ requests: withList({ 'yt.env': () => env({ servers: two ? [server('main'), server('extra')] : [server('main')] }) }) })
  const view = await mount(panel, { host })
  two = true
  await view.press({ role: 'button', label: 'Refresh' })
  assert.deepEqual(
    view.find({ type: 'Select', label: 'Server' }).props.options.map((o: any) => o.value),
    ['main', 'extra']
  )
  await view.unmount()
})

const waiting = { text: 'Waiting for sign-in in the browser…' }
const noServers = () => env({ servers: [], server: null })

test('cancel stops waiting for sign-in and ignores a late failure', async () => {
  const host = mockHost({ requests: { 'yt.env': noServers(), 'yt.servers.add': ok({ started: true }) } })
  const view = await mount(panel, { host })
  await view.type({ label: 'Server URL' }, 'https://yt.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  assert.ok(view.find(waiting))
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(view.find(waiting), null)
  assert.equal(Boolean(view.find({ type: 'Input', label: 'Server URL' }).props.disabled), false)
  assert.equal(Boolean(view.find({ role: 'button', text: 'Add server' }).props.disabled), false)
  await view.post('yt.servers.added', { ok: false, error: { code: 'UNKNOWN', message: 'Sign-in failed' } })
  assert.equal(view.find({ text: 'Sign-in failed' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('leaving the add-server form forgets the waiting sign-in; it opens clean', async () => {
  const host = mockHost({ requests: withList({ 'yt.env': env(), 'yt.servers.add': ok({ started: true }) }) })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Add server' })
  await view.type({ label: 'Server URL' }, 'https://fresh.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  assert.ok(view.find(waiting))
  await view.press({ role: 'button', text: '← Back' })
  await view.press({ role: 'button', label: 'Add server' })
  assert.equal(view.find(waiting), null)
  assert.equal(view.valueOf({ type: 'Input', label: 'Server URL' }), '')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a sign-in that never reports back turns into an error after the deadline', async () => {
  const { SIGN_IN_DEADLINE_MS } = await import('../src/views/Setup')
  const real = globalThis.setTimeout
  let fire: (() => void) | null = null
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
    ms === SIGN_IN_DEADLINE_MS ? ((fire = fn), real(() => {}, 0)) : real(fn, ms, ...rest)) as typeof setTimeout
  try {
    const host = mockHost({ requests: { 'yt.env': noServers(), 'yt.servers.add': ok({ started: true }) } })
    const view = await mount(panel, { host })
    await view.type({ label: 'Server URL' }, 'https://yt.example.com')
    await view.press({ role: 'button', text: 'Add server' })
    assert.ok(fire, 'no sign-in deadline was set')
    assert.ok(SIGN_IN_DEADLINE_MS >= 10 * 60_000)
    ;(fire as unknown as () => void)()
    await view.settled()
    assert.equal(view.find(waiting), null)
    assert.ok(view.find({ text: 'Sign-in did not finish. Try again, or sign in from a terminal.' }))
    assert.ok(view.find({ role: 'button', text: "I've signed in" }))
    assert.deepEqual(view.errors, [])
    await view.unmount()
  } finally {
    globalThis.setTimeout = real
  }
})

test('check again finds a server added while its sign-in post was lost', async () => {
  let added = false
  const host = mockHost({
    requests: withList({
      'yt.env': () => (added ? env({ servers: [server('yt')], server: 'yt' }) : noServers()),
      'yt.servers.add': ok({ started: true }),
      'yt.setServer': ok({})
    })
  })
  const view = await mount(panel, { host })
  await view.type({ label: 'Server URL' }, 'https://yt.example.com')
  await view.press({ role: 'button', text: 'Add server' })
  await view.press({ role: 'button', text: 'Check again' })
  assert.ok(view.find(waiting))
  assert.ok(view.find({ text: 'Not signed in yet.' }))
  added = true
  await view.press({ role: 'button', text: 'Check again' })
  assert.equal(view.find(waiting), null)
  assert.ok(view.find({ type: 'Table' }) || view.find({ type: 'EmptyState' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
