import { test, assert } from 'orca/testing'
import { AGENTS, detectAgents } from '../worker/agents.mjs'

const envWith = (names, platform = 'linux') => {
  const dir = platform === 'win32' ? 'C:\\bin' : '/bin'
  const sep = platform === 'win32' ? '\\' : '/'
  const present = new Set(names.map((n) => dir + sep + n))
  return {
    env: platform === 'win32' ? { Path: dir, PATHEXT: '.EXE;.CMD' } : { PATH: dir },
    platform,
    exists: (p) => present.has(p),
  }
}

test('installed first', () => {
  const r = detectAgents(envWith(['claude', 'codex']))
  assert.deepEqual(r.installed, ['claude', 'codex'])
  assert.equal(r.other.length, AGENTS.length - 2)
  assert.ok(r.other.includes('gemini'))
  assert.ok(!r.other.includes('claude'))
})

test('win32 uses PATHEXT', () => {
  assert.deepEqual(detectAgents(envWith(['claude.EXE'], 'win32')).installed, ['claude'])
  assert.deepEqual(detectAgents(envWith(['claude'], 'win32')).installed, [])
})

test('any alias command counts as installed', () => {
  assert.deepEqual(detectAgents(envWith(['cbc'])).installed, ['codebuddy'])
})

test('required commands must be present too', () => {
  assert.deepEqual(detectAgents(envWith(['dst'])).installed, [])
  assert.deepEqual(detectAgents(envWith(['dst', 'dsh'])).installed, ['dsh'])
  assert.deepEqual(detectAgents(envWith(['orca'])).installed, [])
  assert.deepEqual(detectAgents(envWith(['orca', 'claude'])).installed, ['claude', 'claude-agent-teams'])
  assert.deepEqual(detectAgents(envWith(['orca.EXE', 'claude.EXE'], 'win32')).installed, ['claude'])
})

test('every AGENTS entry has id, label, commands', () => {
  for (const a of AGENTS) {
    assert.ok(a.id && a.label)
    assert.ok(Array.isArray(a.commands) && a.commands.length > 0)
    assert.ok(a.commands.every((c) => typeof c === 'string' && c))
  }
})

test('ids are unique', () => {
  assert.equal(new Set(AGENTS.map((a) => a.id)).size, AGENTS.length)
})
