import { test, assert, mountWorker, mockHost } from 'orca/testing'
import * as main from '../worker/main.mjs'

test('activates without refusals and registers yt.env', async () => {
  const worker = await mountWorker(main)
  const r = await worker.request('yt.env')
  assert.equal(typeof r, 'object')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('registers the open-panel command', async () => {
  const host = mockHost({ results: { 'commands.run': { ran: true } } })
  const worker = await mountWorker(main, { host })
  await worker.command('youtrack.openPanel')
  // Without a usable Orca CLI the panel is opened through the sidebar toggle.
  assert.deepEqual(worker.refusals, [])
  assert.ok(host.callsOf('commands.run').length <= 1)
  await worker.deactivate()
})
