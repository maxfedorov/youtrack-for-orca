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
