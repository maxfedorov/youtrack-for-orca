import { test, assert } from 'orca/testing'
import { createStateStore } from '../worker/state.mjs'
import { fakeStorage } from './helpers.mjs'

test('server is stored', async () => {
  const state = createStateStore(fakeStorage())
  assert.equal(await state.getServer(), null)
  await state.setServer('work')
  assert.equal(await state.getServer(), 'work')
})

test('query is stored per server', async () => {
  const state = createStateStore(fakeStorage())
  await state.setQuery('a', 'for: me')
  await state.setQuery('b', 'project: X')
  assert.equal(await state.getQuery('a', 'd'), 'for: me')
  assert.equal(await state.getQuery('b', 'd'), 'project: X')
})

test('getQuery falls back to default', async () => {
  const state = createStateStore(fakeStorage())
  assert.equal(await state.getQuery('a', 'default'), 'default')
  await state.setQuery('a', '')
  assert.equal(await state.getQuery('a', 'default'), '')
})

test('concurrent setQuery calls for different servers are all kept', async () => {
  const inner = fakeStorage()
  const slow = {
    get: async (k) => { const v = await inner.get(k); await new Promise((r) => setTimeout(r, 2)); return v },
    set: async (k, v) => { await new Promise((r) => setTimeout(r, 2)); await inner.set(k, v) },
  }
  const state = createStateStore(slow)
  await Promise.all([state.setQuery('a', '1'), state.setQuery('b', '2')])
  assert.deepEqual(inner.data().queries, { a: '1', b: '2' })
})

test('forgetServer drops the stored choice, query and project memory of that server only', async () => {
  const storage = fakeStorage()
  const state = createStateStore(storage)
  await state.setServer('a')
  await state.setQuery('a', 'q1')
  await state.setQuery('b', 'q2')
  await state.rememberProjectRepo('a', 'DEMO', 'r1')
  await state.rememberProjectRepo('b', 'DEMO', 'r2')
  await state.setServerRepo('a', 'r1')
  await state.setServerRepo('b', 'r2')
  await state.forgetServer('a')
  assert.equal(await state.getServer(), null)
  assert.equal(await state.getQuery('a', 'd'), 'd')
  assert.equal(await state.getQuery('b', 'd'), 'q2')
  assert.equal(await state.projectRepo('a', 'DEMO'), null)
  assert.equal(await state.projectRepo('b', 'DEMO'), 'r2')
  assert.deepEqual(await state.serverRepos(), { b: 'r2' })
})

test('forgetServer keeps the stored choice of another server', async () => {
  const state = createStateStore(fakeStorage())
  await state.setServer('b')
  await state.forgetServer('a')
  assert.equal(await state.getServer(), 'b')
})

test('the project of each YouTrack project is remembered per server', async () => {
  const state = createStateStore(fakeStorage())
  assert.equal(await state.projectRepo('a', 'DEMO'), null)
  await state.rememberProjectRepo('a', 'DEMO', 'r1')
  await state.rememberProjectRepo('a', 'DEMO', 'r2')
  await state.rememberProjectRepo('a', 'OTHER', 'r3')
  assert.equal(await state.projectRepo('a', 'DEMO'), 'r2')
  assert.equal(await state.projectRepo('a', 'OTHER'), 'r3')
  assert.equal(await state.projectRepo('b', 'DEMO'), null)
})

test('project memory keeps the newest 200 projects of a server', async () => {
  const storage = fakeStorage()
  const state = createStateStore(storage)
  for (let i = 0; i < 205; i++) await state.rememberProjectRepo('a', `P${i}`, 'r1')
  await state.rememberProjectRepo('a', 'P3', 'r9')
  const kept = Object.keys(storage.data().projectRepos.a)
  assert.equal(kept.length, 200)
  assert.equal(await state.projectRepo('a', 'P5'), null)
  assert.equal(await state.projectRepo('a', 'P6'), 'r1')
  assert.equal(await state.projectRepo('a', 'P3'), 'r9')
  assert.equal(kept.at(-1), 'P3')
})

test('the default project of a server is set and cleared', async () => {
  const state = createStateStore(fakeStorage())
  assert.deepEqual(await state.serverRepos(), {})
  await state.setServerRepo('a', 'r1')
  assert.equal(await state.serverRepo('a'), 'r1')
  await state.setServerRepo('a', null)
  assert.equal(await state.serverRepo('a'), null)
  assert.deepEqual(await state.serverRepos(), {})
})

test('damaged project memory reads as empty', async () => {
  const state = createStateStore(fakeStorage({ projectRepos: { a: 'x', b: { DEMO: 5, OK: 'r1' } }, serverRepos: ['x'] }))
  assert.equal(await state.projectRepo('a', 'DEMO'), null)
  assert.equal(await state.projectRepo('b', 'DEMO'), null)
  assert.equal(await state.projectRepo('b', 'OK'), 'r1')
  assert.deepEqual(await state.serverRepos(), {})
  await state.rememberProjectRepo('a', 'DEMO', 'r2')
  assert.equal(await state.projectRepo('a', 'DEMO'), 'r2')
})
