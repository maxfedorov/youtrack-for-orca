import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const RELEASE = 'https://github.com/JetBrains/youtrack-cli/releases/tag/v0.9.0'
const NEWER = ok({ available: true, current: '0.8.2', latest: '0.9.0', url: RELEASE })

function setup(update: unknown = NEWER, over: Record<string, unknown> = {}) {
  const host = mockHost({
    requests: {
      'yt.env': ok({
        cli: { found: true, version: 'youtrack 0.8.2' },
        orcaCli: { found: true },
        servers: [{ alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }],
        server: 'main',
        query: 'for: me',
        defaultQuery: 'for: me'
      }),
      'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({}),
      'yt.cli.update': update,
      'yt.cli.update.skip': ok({}),
      'yt.cli.upgrade': ok({ started: true }),
      ...over
    }
  })
  return host
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const icon = { role: 'button', label: 'YouTrack CLI 0.9.0 is available' }
const NOTE = 'YouTrack CLI 0.9.0 is available. You have 0.8.2.'
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
}

test('no newer release: the header has no update button', async () => {
  const host = setup(ok({ available: false }))
  const view = await mount(panel, { host })
  assert.equal(calls(host, 'yt.cli.update').length, 1)
  assert.equal(view.find(icon), null)
  assert.equal(view.findAll({ role: 'button' }).some((b: any) => b.props.icon === 'download'), false)
  clean(view)
  await view.unmount()
})

test('a failed check shows nothing', async () => {
  const view = await mount(panel, { host: setup(fail('NETWORK', 'GitHub API returned 403')) })
  assert.equal(view.find(icon), null)
  assert.equal(view.find({ text: 'GitHub API returned 403' }), null)
  clean(view)
  await view.unmount()
})

test('a newer release adds one button; pressing it shows the versions and the actions, pressing again hides them', async () => {
  const view = await mount(panel, { host: setup() })
  const button = view.find(icon)
  assert.equal(button.props.icon, 'download')
  assert.equal(view.find({ text: NOTE }), null)
  await view.press(icon)
  assert.ok(view.find({ text: NOTE }))
  assert.ok(view.find({ role: 'button', text: 'Update' }))
  assert.ok(view.find({ role: 'button', text: "What's new" }))
  assert.ok(view.find({ role: 'button', text: 'Skip this version' }))
  await view.press(icon)
  assert.equal(view.find({ text: NOTE }), null)
  clean(view)
  await view.unmount()
})

test("What's new opens the release page", async () => {
  const host = setup()
  const view = await mount(panel, { host })
  await view.press(icon)
  await view.press({ role: 'button', text: "What's new" })
  assert.deepEqual(host.callsOf('shell.openExternal').map((c: any) => c.url), [RELEASE])
  clean(view)
  await view.unmount()
})

test('a release page from elsewhere is never opened', async () => {
  const host = setup(ok({ available: true, current: '0.8.2', latest: '0.9.0', url: 'https://evil.example.com/x' }))
  const view = await mount(panel, { host })
  await view.press(icon)
  await view.press({ role: 'button', text: "What's new" })
  assert.deepEqual(host.callsOf('shell.openExternal').map((c: any) => c.url), ['https://github.com/JetBrains/youtrack-cli/releases/latest'])
  clean(view)
  await view.unmount()
})

test('Skip this version hides the button and tells the worker which version', async () => {
  const host = setup()
  const view = await mount(panel, { host })
  await view.press(icon)
  await view.press({ role: 'button', text: 'Skip this version' })
  assert.deepEqual(calls(host, 'yt.cli.update.skip').map((c: any) => c.input), [{ version: '0.9.0' }])
  assert.equal(view.find(icon), null)
  assert.equal(view.find({ text: NOTE }), null)
  clean(view)
  await view.unmount()
})

test('Update runs the upgrade, waits for its outcome, then hides the button and reloads the CLI version', async () => {
  const host = setup()
  const view = await mount(panel, { host })
  await view.press(icon)
  await view.press({ role: 'button', text: 'Update' })
  assert.equal(calls(host, 'yt.cli.upgrade').length, 1)
  assert.ok(view.find({ role: 'button', text: 'Updating…' }))
  assert.equal(view.find({ role: 'button', text: 'Updating…' }).props.disabled, true)
  const envCalls = calls(host, 'yt.env').length
  await view.post('yt.cli.upgraded', ok({ version: '0.9.0' }))
  assert.equal(view.find(icon), null)
  assert.equal(view.find({ text: NOTE }), null)
  assert.ok(calls(host, 'yt.env').length > envCalls)
  clean(view)
  await view.unmount()
})

test('a failed update keeps the note open with the CLI message', async () => {
  const view = await mount(panel, { host: setup() })
  await view.press(icon)
  await view.press({ role: 'button', text: 'Update' })
  const message = 'automatic upgrade is not available for this install (manual upgrade: sudo dpkg -i youtrack_linux_arm64.deb)'
  await view.post('yt.cli.upgraded', fail('UNKNOWN', message))
  assert.ok(view.find(icon))
  assert.ok(view.find({ text: message }))
  assert.equal(view.find({ role: 'button', text: 'Update' }).props.disabled, false)
  clean(view)
  await view.unmount()
})

test('an update that could not start shows why', async () => {
  const view = await mount(panel, { host: setup(NEWER, { 'yt.cli.upgrade': fail('UNKNOWN', 'The YouTrack CLI is already being updated.') }) })
  await view.press(icon)
  await view.press({ role: 'button', text: 'Update' })
  assert.ok(view.find({ text: 'The YouTrack CLI is already being updated.' }))
  assert.ok(view.find({ role: 'button', text: 'Update' }))
  clean(view)
  await view.unmount()
})

test('a broken answer is treated as no update', async () => {
  for (const data of [{ available: true }, { available: true, current: 1, latest: '0.9.0', url: RELEASE }, null, 'yes']) {
    const view = await mount(panel, { host: setup(ok(data)) })
    assert.equal(view.findAll({ role: 'button' }).some((b: any) => b.props.icon === 'download'), false)
    clean(view)
    await view.unmount()
  }
})

test('Refresh asks again, so an update found later shows up without reopening the panel', async () => {
  let answer: unknown = ok({ available: false })
  const host = setup(() => answer)
  const view = await mount(panel, { host })
  assert.equal(view.find(icon), null)
  answer = NEWER
  await view.press({ role: 'button', label: 'Refresh' })
  assert.ok(view.find(icon))
  clean(view)
  await view.unmount()
})
