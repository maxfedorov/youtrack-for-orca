import { test, assert } from 'orca/testing'
import { createCliUpdates, CHECK_EVERY_MS } from '../worker/cli-update.mjs'
import { ok, fail } from '../worker/result.mjs'
import { fakeStorage } from './helpers.mjs'

const RELEASE_URL = 'https://github.com/JetBrains/youtrack-cli/releases/tag/v0.9.0'
const status = (latest = '0.9.0', url = RELEASE_URL) => ok({ currentVersion: '0.8.2', latestVersion: latest, updateAvailable: true, releaseUrl: url })

/** A YouTrack CLI double: `installed` is what `--version` reports; counts the update checks. */
function fakeCli({ installed = '0.8.2', check = () => status(), upgrade = async () => ok({ upgraded: true }) } = {}) {
  const cli = {
    installed,
    checks: 0,
    upgrades: 0,
    version: async () => ok(`youtrack ${cli.installed} (abc123, 2026-11-12T13:33:50Z)`),
    updateStatus: async () => (cli.checks++, check()),
    upgrade: async () => (cli.upgrades++, upgrade(cli))
  }
  return cli
}

function setup({ cli = fakeCli(), storage = fakeStorage(), at = 1_000_000 } = {}) {
  const clock = { at }
  let refreshed = 0
  const updates = createCliUpdates({
    storage,
    getYoutrack: () => cli,
    refreshYoutrack: async () => void refreshed++,
    now: () => clock.at
  })
  return { updates, cli, storage, clock, refreshed: () => refreshed }
}

test('offers a newer release with its release page', async () => {
  const { updates } = setup()
  assert.deepEqual(await updates.status(), ok({ available: true, current: '0.8.2', latest: '0.9.0', url: RELEASE_URL }))
})

test('offers nothing when the installed version is the latest', async () => {
  const { updates } = setup({ cli: fakeCli({ installed: '0.9.0' }) })
  assert.deepEqual(await updates.status(), ok({ available: false }))
})

test('asks GitHub through the CLI at most once a day', async () => {
  const { updates, cli, clock } = setup()
  await updates.status()
  clock.at += CHECK_EVERY_MS - 1
  await updates.status()
  assert.equal(cli.checks, 1)
  clock.at += 1
  await updates.status()
  assert.equal(cli.checks, 2)
})

test('a failed check offers nothing and is tried again next time', async () => {
  const { updates, cli } = setup({ cli: fakeCli({ check: () => fail('NETWORK', 'GitHub API returned 403') }) })
  assert.deepEqual(await updates.status(), ok({ available: false }))
  await updates.status()
  assert.equal(cli.checks, 2)
})

test('a build that is not a release is never checked', async () => {
  for (const installed of ['dev', 'unknown', '0.9.0-rc1', '']) {
    const { updates, cli } = setup({ cli: fakeCli({ installed }) })
    assert.deepEqual(await updates.status(), ok({ available: false }))
    assert.equal(cli.checks, 0)
  }
})

test('without the CLI there is nothing to offer', async () => {
  const updates = createCliUpdates({ storage: fakeStorage(), getYoutrack: () => null, refreshYoutrack: async () => {}, now: () => 1 })
  assert.deepEqual(await updates.status(), ok({ available: false }))
})

test('versions compare by number, not as text', async () => {
  const { updates } = setup({ cli: fakeCli({ installed: '0.10.0', check: () => status('0.9.9') }) })
  assert.deepEqual(await updates.status(), ok({ available: false }))
  const newer = setup({ cli: fakeCli({ installed: '0.9.9', check: () => status('0.10.0') }) })
  assert.equal((await newer.updates.status()).data.available, true)
})

test('a latest version that is not a release, or an odd release page, is not passed on', async () => {
  for (const latest of ['dev', '1.0', '1.0.0; rm -rf', null]) {
    const { updates } = setup({ cli: fakeCli({ check: () => status(latest) }) })
    assert.deepEqual(await updates.status(), ok({ available: false }))
  }
  for (const url of ['https://evil.example.com/x', 'javascript:alert(1)', 'https://github.com/JetBrains/youtrack-cli/releases/tag/v0.9.0 x', 7]) {
    const { updates } = setup({ cli: fakeCli({ check: () => status('0.9.0', url) }) })
    assert.equal((await updates.status()).data.url, 'https://github.com/JetBrains/youtrack-cli/releases/latest')
  }
})

test('a skipped version is not offered again, a newer one is', async () => {
  const storage = fakeStorage()
  const { updates } = setup({ storage })
  assert.deepEqual(await updates.skip('0.9.0'), ok({}))
  assert.deepEqual(await updates.status(), ok({ available: false }))
  const later = setup({ storage, cli: fakeCli({ check: () => status('0.9.1') }), at: 1_000_000 + CHECK_EVERY_MS })
  assert.equal((await later.updates.status()).data.latest, '0.9.1')
})

test('skip accepts only a release version', async () => {
  const { updates } = setup()
  for (const v of ['', 'dev', '--yes', 5, null]) assert.equal((await updates.skip(v)).ok, false)
})

test('upgrade runs the CLI update, finds the CLI again and then offers nothing', async () => {
  const { updates, cli, refreshed } = setup({
    cli: fakeCli({ upgrade: async (c) => ((c.installed = '0.9.0'), ok({ upgraded: true })) })
  })
  await updates.status()
  assert.deepEqual(await updates.upgrade(), ok({ version: '0.9.0' }))
  assert.equal(cli.upgrades, 1)
  assert.equal(refreshed(), 1)
  assert.deepEqual(await updates.status(), ok({ available: false }))
  assert.equal(cli.checks, 1)
})

test('a failed upgrade answers the CLI error', async () => {
  const { updates } = setup({ cli: fakeCli({ upgrade: async () => fail('UNKNOWN', 'automatic upgrade is not available for this install (manual upgrade: sudo dpkg -i x.deb)') }) })
  const r = await updates.upgrade()
  assert.equal(r.ok, false)
  assert.match(r.error.message, /sudo dpkg/)
})

test('only one upgrade runs at a time', async () => {
  let finish
  const { updates, cli } = setup({ cli: fakeCli({ upgrade: () => new Promise((r) => (finish = r)) }) })
  const first = updates.upgrade()
  const second = await updates.upgrade()
  assert.equal(second.ok, false)
  finish(ok({ upgraded: true }))
  await first
  assert.equal(cli.upgrades, 1)
  assert.equal(updates.upgrading(), false)
})
