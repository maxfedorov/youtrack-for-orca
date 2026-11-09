import { test, assert } from 'orca/testing'
import { createYoutrackHolder } from '../worker/cli-holder.mjs'

function setup({ files = new Set(), setting = '' } = {}) {
  const state = { setting }
  const holder = createYoutrackHolder({
    getSetting: async () => state.setting,
    env: { PATH: '/bin' },
    platform: 'linux',
    homedir: '/home/demo',
    exists: (p) => files.has(p),
    create: ({ bin }) => ({ bin }),
  })
  return { holder, files, state }
}

test('starts without a CLI and finds it after an install', async () => {
  const { holder, files } = setup()
  assert.equal(await holder.refresh(), null)
  assert.equal(holder.get(), null)
  files.add('/bin/youtrack')
  assert.deepEqual(await holder.refresh(), { bin: '/bin/youtrack' })
  assert.deepEqual(holder.get(), { bin: '/bin/youtrack' })
})

test('keeps the same instance while the binary is unchanged', async () => {
  const { holder, files } = setup({ files: new Set(['/bin/youtrack']) })
  const first = await holder.refresh()
  assert.equal(await holder.refresh(), first)
})

test('follows the path setting and a removed binary', async () => {
  const { holder, files, state } = setup({ files: new Set(['/bin/youtrack', '/opt/yt']) })
  await holder.refresh()
  state.setting = '/opt/yt'
  assert.deepEqual(await holder.refresh(), { bin: '/opt/yt' })
  files.clear()
  assert.equal(await holder.refresh(), null)
  assert.equal(holder.get(), null)
})
