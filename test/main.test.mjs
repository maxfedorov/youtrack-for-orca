import { test, assert, mountWorker } from 'orca/testing'
import * as main from '../worker/main.mjs'

test('activates without refusals and registers yt.env', async () => {
  const worker = await mountWorker(main)
  const r = await worker.request('yt.env')
  assert.equal(typeof r, 'object')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a removed workspace drops its stored links and tells the panel', async () => {
  const { mockHost } = await import('orca/testing')
  const host = mockHost({
    storage: { links: { 'one|DEMO-1': [{ workspaceId: 'identity:gone', createdAt: 1 }] } },
    results: { 'workspace.list': { workspaces: [], truncated: false } }
  })
  const worker = await mountWorker(main, { host })
  await worker.emit('workspace.removed', { workspaceId: 'identity:gone', kind: 'worktree', path: '/w/gone' })
  assert.deepEqual(host.data().storage.links, {})
  assert.ok(worker.posts.some((p) => p.event === 'yt.linksChanged'))
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
