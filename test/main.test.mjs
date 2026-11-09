import { test, assert, mountWorker } from 'orca/testing'
import * as main from '../worker/main.mjs'

test('activates without refusals and registers yt.env', async () => {
  const worker = await mountWorker(main)
  const r = await worker.request('yt.env')
  assert.equal(typeof r, 'object')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
