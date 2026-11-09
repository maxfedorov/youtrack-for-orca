import { test, assert } from 'orca/testing'
import { createOpenPanelCommand } from '../worker/open-panel.mjs'
import { ok, fail } from '../worker/result.mjs'

function setup(orcaCli) {
  const calls = []
  const host = { call: async (method, params) => (calls.push({ method, params }), { ran: true }) }
  return { calls, run: createOpenPanelCommand({ orcaCli, host }) }
}

test('open panel through the Orca CLI needs no fallback', async () => {
  const opened = []
  const { calls, run } = setup({ openPanel: async (...a) => (opened.push(a), ok({})) })
  await run()
  assert.deepEqual(opened, [['youtrack', 'issues']])
  assert.deepEqual(calls, [])
})

test('failed openPanel toggles the right sidebar once', async () => {
  const { calls, run } = setup({ openPanel: async () => fail('ORCA_CLI_FAILED', 'x') })
  await run()
  assert.deepEqual(calls, [{ method: 'commands.run', params: { action: 'sidebar.right.toggle' } }])
})

test('thrown openPanel toggles the right sidebar once', async () => {
  const { calls, run } = setup({ openPanel: async () => { throw new Error('boom') } })
  await run()
  assert.equal(calls.length, 1)
})

test('no Orca CLI toggles the right sidebar once', async () => {
  const { calls, run } = setup(null)
  await run()
  assert.deepEqual(calls, [{ method: 'commands.run', params: { action: 'sidebar.right.toggle' } }])
})
