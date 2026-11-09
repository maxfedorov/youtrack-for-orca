import { test, assert } from 'orca/testing'
import { ok, fail, CODES } from '../worker/result.mjs'

test('ok wraps data', () => {
  assert.deepEqual(ok(1), { ok: true, data: 1 })
})

test('fail wraps code and message', () => {
  assert.deepEqual(fail('CLI_NOT_FOUND', 'x'), {
    ok: false,
    error: { code: 'CLI_NOT_FOUND', message: 'x' }
  })
})

test('CODES is frozen and has the expected keys', () => {
  assert.equal(Object.isFrozen(CODES), true)
  for (const k of ['CLI_NOT_FOUND', 'NO_SERVERS', 'AUTH_FAILED', 'NETWORK', 'NOT_FOUND', 'FORBIDDEN', 'QUERY_INVALID', 'ORCA_CLI_NOT_FOUND', 'ORCA_CLI_FAILED', 'TIMEOUT', 'UNKNOWN', 'PROMPT_TOO_LONG']) {
    assert.equal(CODES[k], k)
  }
})
