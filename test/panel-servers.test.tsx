import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'
import { optionsOf, pick, shown } from './combo'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const all = [
  { alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' },
  { alias: 'other', url: 'https://other.example.com', active: false, status: 'authenticated' }
]
const REPOS = [{ id: 'r1', name: 'alpha' }, { id: 'r2', name: 'beta' }]

function setup(over: Record<string, unknown> = {}) {
  let servers = [...all]
  let defaults: Record<string, string> = { other: 'r1' }
  return mockHost({
    requests: {
      'yt.env': () => ok({ cli: { found: true }, orcaCli: { found: true }, servers, server: servers[0]?.alias ?? null, query: 'q', defaultQuery: 'q' }),
      'yt.setServer': ok({}),
      'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({}),
      'yt.templates': ok({ templates: [{ id: 'a', name: 'Alpha', body: 'A' }], defaultId: 'a' }),
      'yt.servers.defaults': () => ok({ repos: REPOS, defaults: structuredClone(defaults) }),
      'yt.servers.setDefaultRepo': (i: any) => {
        if (i.repoId) defaults[i.server] = i.repoId
        else delete defaults[i.server]
        return ok({})
      },
      'yt.servers.remove': (i: any) => ((servers = servers.filter((s) => s.alias !== i.server)), ok({})),
      ...over
    }
  })
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const openSettings = async (host: any) => {
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Prompt templates and servers' })
  return view
}
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
}

test('each server shows its default project, None when it has none', async () => {
  const host = setup()
  const view = await openSettings(host)
  assert.ok(view.find({ type: 'Heading', text: 'Servers' }))
  assert.equal(shown(view, 'Default project for main'), 'None')
  assert.equal(shown(view, 'Default project for other'), 'alpha')
  assert.deepEqual((await optionsOf(view, 'Default project for main')).map((o) => o.label), ['None', 'alpha', 'beta'])
  clean(view)
  await view.unmount()
})

test('choosing a default project saves it, and None clears it', async () => {
  const host = setup()
  const view = await openSettings(host)
  await pick(view, 'Default project for main', 'r2')
  assert.deepEqual(calls(host, 'yt.servers.setDefaultRepo')[0].input, { server: 'main', repoId: 'r2' })
  assert.equal(shown(view, 'Default project for main'), 'beta')
  await pick(view, 'Default project for other', '__none__')
  assert.deepEqual(calls(host, 'yt.servers.setDefaultRepo')[1].input, { server: 'other', repoId: null })
  assert.equal(shown(view, 'Default project for other'), 'None')
  clean(view)
  await view.unmount()
})

test('a default project that cannot be saved goes back, with the reason', async () => {
  const host = setup({ 'yt.servers.setDefaultRepo': fail('UNKNOWN', 'storage is full') })
  const view = await openSettings(host)
  await pick(view, 'Default project for main', 'r2')
  assert.equal(shown(view, 'Default project for main'), 'None')
  assert.ok(view.find({ text: 'storage is full' }))
  clean(view)
  await view.unmount()
})

test('without the project list the servers are still shown, with the reason and Retry', async () => {
  let fails = true
  const host = setup({
    'yt.servers.defaults': () => (fails ? ok({ repos: [], reposError: 'The Orca CLI was not found.', defaults: {} }) : ok({ repos: REPOS, defaults: {} }))
  })
  const view = await openSettings(host)
  assert.ok(view.find({ text: 'Projects could not be loaded: The Orca CLI was not found.' }))
  assert.equal(view.find({ testId: 'Default project for main:toggle' }), null)
  assert.ok(view.find({ role: 'button', text: 'Remove main' }))
  fails = false
  await view.press({ role: 'button', text: 'Retry' })
  assert.equal(shown(view, 'Default project for main'), 'None')
  clean(view)
  await view.unmount()
})

test('a server can be removed from the settings view, which stays open', async () => {
  const host = setup()
  const view = await openSettings(host)
  await view.press({ role: 'button', text: 'Remove main' })
  assert.ok(view.find({ text: 'Remove main? This signs the YouTrack CLI out of it.' }))
  await view.press({ role: 'button', text: 'Remove' })
  assert.deepEqual(calls(host, 'yt.servers.remove').map((c: any) => c.input), [{ server: 'main' }])
  assert.ok(view.find({ type: 'Heading', text: 'Servers' }))
  assert.equal(view.find({ role: 'button', text: 'Remove main' }), null)
  assert.ok(view.find({ role: 'button', text: 'Remove other' }))
  clean(view)
  await view.unmount()
})
