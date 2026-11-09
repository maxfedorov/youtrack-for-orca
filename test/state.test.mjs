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
