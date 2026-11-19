import { test, assert } from 'orca/testing'
import { issueIdFromBranch, createContextWatcher } from '../worker/branch-issue.mjs'

test('the issue id is read from a branch, in upper case', () => {
  assert.equal(issueIdFromBranch('demo-4-fix-login'), 'DEMO-4')
  assert.equal(issueIdFromBranch('feat/DEMO-12-x'), 'DEMO-12')
  assert.equal(issueIdFromBranch('refs/heads/jt_core-77'), 'JT_CORE-77')
  assert.equal(issueIdFromBranch('users/jane/abc-9'), 'ABC-9')
})

test('a branch without an issue id gives none', () => {
  for (const b of ['main', 'feature/login', '', null, undefined, 42, '123-4', 'demo-', 'x'.repeat(300) + '-1']) {
    assert.equal(issueIdFromBranch(b), null, String(b))
  }
})

test('the context watcher reports only real changes of the focused workspace', () => {
  const seen = []
  const watch = createContextWatcher(() => seen.push(1))
  watch({ context: { branch: 'a', displayName: 'a', terminals: [] } })
  watch({ context: { branch: 'a', displayName: 'a', terminals: [{ id: 't1' }] } })
  assert.equal(seen.length, 1)
  watch({ context: { branch: 'b', displayName: 'a', terminals: [] } })
  watch({ context: null })
  watch({ context: null })
  watch('junk')
  assert.equal(seen.length, 3)
})
