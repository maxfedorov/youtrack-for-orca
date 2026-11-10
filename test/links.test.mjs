import { test, assert } from 'orca/testing'
import { createLinkStore, createLaunchTracker } from '../worker/links.mjs'
import { fakeStorage } from './helpers.mjs'

test('latest returns newest live workspace', async () => {
  const links = createLinkStore(fakeStorage())
  await links.add('s', 'A-1', 'w1', 1)
  await links.add('s', 'A-1', 'w2', 2)
  await links.add('s', 'A-1', 'w3', 3)
  assert.equal(await links.latest('s', 'A-1', new Set(['w1', 'w2', 'w3'])), 'w3')
  assert.equal(await links.latest('s', 'A-1', new Set(['w1', 'w2'])), 'w2')
  assert.equal(await links.latest('s', 'A-2', new Set(['w1'])), null)
})

test('latest ignores workspaces missing from workspace.list', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('s', 'A-1', 'w1', 1)
  const before = JSON.stringify(storage.data())
  assert.equal(await links.latest('s', 'A-1', new Set()), null)
  assert.deepEqual(await links.forServer('s', new Set()), {})
  assert.equal(JSON.stringify(storage.data()), before)
})

test('forServer maps issue to newest live workspace', async () => {
  const links = createLinkStore(fakeStorage())
  await links.add('s', 'A-1', 'w1', 1)
  await links.add('s', 'A-1', 'w2', 2)
  await links.add('s', 'A-2', 'w3', 3)
  await links.add('t', 'A-9', 'w4', 4)
  assert.deepEqual(await links.forServer('s', new Set(['w1', 'w3', 'w4'])), { 'A-1': 'w1', 'A-2': 'w3' })
})

test('add keeps at most 20 entries per issue', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  for (let i = 0; i < 25; i++) await links.add('s', 'A-1', `w${i}`, i)
  const list = storage.data().links['s|A-1']
  assert.equal(list.length, 20)
  assert.equal(list[0].workspaceId, 'w5')
})

test('prune drops dead ids', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('s', 'A-1', 'w1', 1)
  await links.add('s', 'A-1', 'w2', 2)
  await links.add('s', 'A-2', 'w3', 3)
  await links.prune(new Set(['w2']))
  assert.deepEqual(storage.data().links, { 's|A-1': [{ workspaceId: 'w2', createdAt: 2 }] })
})

test('takeFinished returns once', async () => {
  const launches = createLaunchTracker(fakeStorage())
  await launches.track({ terminalId: 't1', server: 's', issueId: 'A-1', workspaceId: 'w1', at: 5 })
  assert.deepEqual(await launches.takeFinished('t1'), { server: 's', issueId: 'A-1' })
  assert.equal(await launches.takeFinished('t1'), null)
  assert.equal(await launches.takeFinished('nope'), null)
})

test('track keeps at most 50 launches', async () => {
  const storage = fakeStorage()
  const launches = createLaunchTracker(storage)
  for (let i = 0; i < 55; i++) await launches.track({ terminalId: `t${i}`, server: 's', issueId: 'A-1', workspaceId: 'w', at: i })
  assert.equal(storage.data().launches.length, 50)
  assert.equal(await launches.takeFinished('t0'), null)
  assert.deepEqual(await launches.takeFinished('t54'), { server: 's', issueId: 'A-1' })
})

/** Storage whose reads and writes take a few ticks, so unserialized updates interleave. */
function slowStorage(initial = {}) {
  const inner = fakeStorage(initial)
  const tick = () => new Promise((r) => setTimeout(r, 2))
  return {
    async get(k) { const v = await inner.get(k); await tick(); return v },
    async set(k, v) { await tick(); await inner.set(k, v) },
    data: () => inner.data(),
  }
}

test('a link added while pruning is kept', async () => {
  const storage = slowStorage({ links: { 's|A-1': [{ workspaceId: 'w1', createdAt: 1 }] } })
  const links = createLinkStore(storage)
  // the workspace list was read at time 2, before the new workspace existed
  await Promise.all([links.prune(new Set(['w1']), 2), links.add('s', 'A-2', 'w2', 2)])
  assert.deepEqual(Object.keys(storage.data().links).sort(), ['s|A-1', 's|A-2'])
})

test('concurrent adds are all kept', async () => {
  const storage = slowStorage()
  const links = createLinkStore(storage)
  await Promise.all([links.add('s', 'A-1', 'w1', 1), links.add('s', 'A-2', 'w2', 2), links.add('s', 'A-3', 'w3', 3)])
  assert.equal(Object.keys(storage.data().links).length, 3)
})

test('two concurrent takeFinished calls return the launch once', async () => {
  const storage = slowStorage()
  const launches = createLaunchTracker(storage)
  await launches.track({ terminalId: 't1', server: 's', issueId: 'A-1', workspaceId: 'w', at: 1 })
  const results = await Promise.all([launches.takeFinished('t1'), launches.takeFinished('t1')])
  assert.equal(results.filter(Boolean).length, 1)
})

test('track and takeFinished do not lose each other', async () => {
  const storage = slowStorage()
  const launches = createLaunchTracker(storage)
  await launches.track({ terminalId: 't1', server: 's', issueId: 'A-1', workspaceId: 'w', at: 1 })
  await Promise.all([launches.takeFinished('t1'), launches.track({ terminalId: 't2', server: 's', issueId: 'A-2', workspaceId: 'w', at: 2 })])
  assert.deepEqual(storage.data().launches.map((l) => l.terminalId), ['t2'])
})

test('prune only drops links older than the workspace snapshot', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('s', 'A-1', 'old', 4)
  await links.add('s', 'A-2', 'new', 5)
  await links.prune(new Set(), 5)
  assert.deepEqual(Object.keys(storage.data().links), ['s|A-2'])
})

test('a removed workspace loses its links and the panels are told', async () => {
  const { createRemovedListener } = await import('../worker/links.mjs')
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('s', 'A-1', 'identity:gone', 1)
  await links.add('s', 'A-2', 'identity:kept', 2)
  const posts = []
  // The list may still hold the removed workspace for a moment; it is dropped by id and by path.
  const host = async () => ({
    workspaces: [
      { id: 'identity:gone', path: '/w/gone' },
      { id: 'identity:kept', path: '/w/kept' }
    ],
    truncated: false
  })
  const onRemoved = createRemovedListener({ host, links, now: () => 10, post: (name, payload) => posts.push({ name, payload }) })
  await onRemoved({ workspaceId: 'raw-id', kind: 'worktree', path: '/w/gone' })
  assert.deepEqual(Object.keys(storage.data().links), ['s|A-2'])
  assert.deepEqual(posts, [{ name: 'yt.linksChanged', payload: {} }])
})

test('a removed workspace is dropped by id even when the list cannot be read', async () => {
  const { createRemovedListener } = await import('../worker/links.mjs')
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('s', 'A-1', 'w1', 1)
  await links.add('s', 'A-2', 'w2', 2)
  const posts = []
  const host = async () => { throw new Error('unavailable') }
  await createRemovedListener({ host, links, now: () => 10, post: (name) => posts.push(name) })({ workspaceId: 'w1', path: '/x' })
  assert.deepEqual(Object.keys(storage.data().links), ['s|A-2'])
  assert.deepEqual(posts, ['yt.linksChanged'])
})

test('drop removes every entry of one workspace', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('s', 'A-1', 'w1', 1)
  await links.add('s', 'A-1', 'w2', 2)
  await links.add('t', 'B-1', 'w1', 3)
  await links.drop('w1')
  assert.deepEqual(storage.data().links, { 's|A-1': [{ workspaceId: 'w2', createdAt: 2 }] })
})

test('dropServer removes the links and launches of one server only', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  const launches = createLaunchTracker(storage)
  await links.add('a', 'DEMO-1', 'w1', 1)
  await links.add('ab', 'DEMO-1', 'w2', 1)
  await links.add('b', 'DEMO-2', 'w3', 1)
  await launches.track({ terminalId: 't1', server: 'a', issueId: 'DEMO-1', workspaceId: 'w1', at: 1 })
  await launches.track({ terminalId: 't2', server: 'b', issueId: 'DEMO-2', workspaceId: 'w3', at: 1 })
  await links.dropServer('a')
  await launches.dropServer('a')
  assert.deepEqual(Object.keys(storage.data().links), ['ab|DEMO-1', 'b|DEMO-2'])
  assert.deepEqual(storage.data().launches.map((e) => e.terminalId), ['t2'])
})

test('a server alias containing | does not take the links of another server', async () => {
  const storage = fakeStorage()
  const links = createLinkStore(storage)
  await links.add('a', 'DEMO-1', 'w1', 1)
  await links.add('a|b', 'DEMO-2', 'w2', 1)
  const live = new Set(['w1', 'w2'])
  assert.deepEqual(await links.forServer('a', live), { 'DEMO-1': 'w1' })
  assert.deepEqual(await links.forServer('a|b', live), { 'DEMO-2': 'w2' })
  await links.dropServer('a')
  assert.deepEqual(Object.keys(storage.data().links), ['a|b|DEMO-2'])
})
