import { test, assert } from 'orca/testing'
import { workspaceItems, shortPath } from '../worker/workspaces.mjs'

const HOME = '/Users/demo'
const REPOS = [
  { id: 'r1', name: 'alpha', path: '/Users/demo/code/alpha' },
  { id: 'r2', name: 'beta', path: '/Users/demo/code/beta' }
]

test('the project is the listed one when the workspace list names it', () => {
  const [item] = workspaceItems([{ id: 'w1', name: 'main', project: 'gamma', path: '/Users/demo/code/alpha', branch: 'refs/heads/main' }], REPOS, HOME)
  assert.deepEqual(item, { id: 'w1', name: 'main', project: 'gamma', branch: 'main', path: '~/code/alpha' })
})

test('without a listed project the repository holding the path names it', () => {
  const items = workspaceItems(
    [
      { id: 'w1', name: 'main', path: '/Users/demo/code/alpha', branch: 'main' },
      { id: 'w2', name: 'master', project: '', path: '/Users/demo/code/beta/sub', branch: 'master' },
      { id: 'w3', name: 'other', project: null, path: '/Users/demo/code/alphabet', branch: 'main' }
    ],
    REPOS,
    HOME
  )
  assert.deepEqual(items.map((i) => i.project), ['alpha', 'beta', 'alphabet'])
})

test('a worktree in a folder named after its repository takes that repository', () => {
  const [item] = workspaceItems([{ id: 'w1', name: 'demo-1-fix', path: '/Users/demo/orca/workspaces/beta/demo-1-fix', branch: 'demo-1-fix' }], REPOS, HOME)
  assert.equal(item.project, 'beta')
  assert.equal(item.path, '~/…/beta/demo-1-fix')
})

test('without a repository the folder name stands for the project', () => {
  const [folder, bare] = workspaceItems(
    [
      { id: 'w1', kind: 'folder', name: 'notes', project: null, path: '/srv/notes', branch: null },
      { id: 'w2', name: 'x' }
    ],
    [],
    HOME
  )
  assert.deepEqual(folder, { id: 'w1', name: 'notes', project: 'notes', path: '/srv/notes' })
  assert.deepEqual(bare, { id: 'w2', name: 'x' })
})

test('a workspace without a name is named by its id', () => {
  assert.equal(workspaceItems([{ id: 'w1', name: '' }], [], HOME)[0].name, 'w1')
})

test('paths are shortened: home becomes ~ and deep paths keep their last two folders', () => {
  assert.equal(shortPath('/Users/demo/code/alpha', HOME), '~/code/alpha')
  assert.equal(shortPath('/Users/demo', HOME), '~')
  assert.equal(shortPath('/Users/demox/code', HOME), '/Users/demox/code')
  assert.equal(shortPath('/a/b/c/d/e', HOME), '/…/d/e')
  assert.equal(shortPath('C:\\Users\\demo\\code\\a\\b\\c', 'C:\\Users\\demo'), '~\\…\\b\\c')
})
