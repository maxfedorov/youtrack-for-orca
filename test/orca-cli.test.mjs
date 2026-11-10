import { test, assert } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { resolveOrcaCli, createOrcaCli } from '../worker/orca-cli.mjs'
import { fakeRun } from './helpers.mjs'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const errors = JSON.parse(fixture('orca-errors.json'))

test('darwin path from resourcesPath', () => {
  const p = resolveOrcaCli({
    resourcesPath: '/Applications/Orca.app/Contents/Resources', platform: 'darwin', env: { PATH: '' },
    exists: (f) => f === '/Applications/Orca.app/Contents/Resources/bin/orca'
  })
  assert.equal(p, '/Applications/Orca.app/Contents/Resources/bin/orca')
})

test('linux uses orca-ide, never bare orca from PATH', () => {
  const bundled = resolveOrcaCli({
    resourcesPath: '/opt/Orca/resources', platform: 'linux', env: { PATH: '/usr/bin' },
    exists: (f) => f === '/opt/Orca/resources/bin/orca-ide'
  })
  assert.equal(bundled, '/opt/Orca/resources/bin/orca-ide')
  const onPath = resolveOrcaCli({
    resourcesPath: '/opt/Orca/resources', platform: 'linux', env: { PATH: '/usr/bin' },
    exists: (f) => f === '/usr/bin/orca-ide' || f === '/usr/bin/orca'
  })
  assert.equal(onPath, '/usr/bin/orca-ide')
  const bare = resolveOrcaCli({
    resourcesPath: '/opt/Orca/resources', platform: 'linux', env: { PATH: '/usr/bin' },
    exists: (f) => f === '/usr/bin/orca'
  })
  assert.equal(bare, null)
})

test('win32 path and PATH fallback', () => {
  const p = resolveOrcaCli({
    resourcesPath: 'C:\\Orca\\resources', platform: 'win32', env: { PATH: '' },
    exists: (f) => f === 'C:\\Orca\\resources\\bin\\orca.exe'
  })
  assert.equal(p, 'C:\\Orca\\resources\\bin\\orca.exe')
  const q = resolveOrcaCli({
    resourcesPath: 'C:\\Orca\\resources', platform: 'win32', env: { PATH: 'C:\\bin', PATHEXT: '.EXE' },
    exists: (f) => f === 'C:\\bin\\orca.EXE'
  })
  assert.equal(q, 'C:\\bin\\orca.EXE')
})

test('darwin falls back to orca on PATH, else null', () => {
  const base = { resourcesPath: '/x', platform: 'darwin', env: { PATH: '/usr/local/bin' } }
  assert.equal(resolveOrcaCli({ ...base, exists: (f) => f === '/usr/local/bin/orca' }), '/usr/local/bin/orca')
  assert.equal(resolveOrcaCli({ ...base, exists: () => false }), null)
  assert.equal(resolveOrcaCli({ ...base, resourcesPath: undefined, exists: () => false }), null)
})

const input = {
  repoId: 'r1', name: 'demo-1-x', agent: 'claude', prompt: 'P',
  issueId: 'DEMO-1', issueUrl: 'https://example.youtrack.cloud/issue/DEMO-1'
}
const created = { 'worktree create': { stdout: fixture('orca-worktree-create.json') } }

test('createWorktree argv', async () => {
  const run = fakeRun(created)
  await createOrcaCli({ run }).createWorktree(input)
  assert.deepEqual(run.calls[0].args, [
    'worktree', 'create', '--repo', 'id:r1', '--name=demo-1-x', '--no-parent', '--activate',
    '--comment=DEMO-1 https://example.youtrack.cloud/issue/DEMO-1',
    '--agent', 'claude', '--prompt=P', '--json'
  ])
  assert.equal(run.calls[0].opts.timeoutMs, 60_000)
})

test('createWorktree adds --base-branch after --name; never --branch or --reference', async () => {
  const run = fakeRun(created)
  await createOrcaCli({ run }).createWorktree({ ...input, baseBranch: 'origin/release' })
  const a = run.calls[0].args
  assert.equal(a[a.indexOf('--name=demo-1-x') + 1], '--base-branch=origin/release')
  assert.ok(!a.includes('--branch'))
  assert.ok(!a.includes('--reference'))
})

test('createWorktree without agent sends neither --agent nor --prompt', async () => {
  const run = fakeRun(created)
  await createOrcaCli({ run }).createWorktree({ ...input, agent: undefined })
  const a = run.calls[0].args
  assert.ok(!a.includes('--agent'))
  assert.ok(!a.some((x) => x.startsWith('--prompt')))
})

test('createWorktree parses workspace id from fixture', async () => {
  const r = await createOrcaCli({ run: fakeRun(created) }).createWorktree(input)
  assert.deepEqual(r, {
    ok: true,
    data: {
      workspaceId: 'identity:wt2:local:00000000-0000-4000-8000-0000000000aa',
      name: 'demo-1-fix-login',
      branch: 'demo/demo-1-fix-login',
      path: '/Users/demo/orca/workspaces/demo-repo/demo-1-fix-login',
      terminalId: 'term_00000000-0000-4000-8000-0000000000bb',
      paneKey: '00000000-0000-0000-0000-000000000000:00000000-0000-0000-0000-000000000000'
    }
  })
})

test('createWorktree maps an error envelope to ORCA_CLI_FAILED', async () => {
  const e = errors['prompt-requires-agent']
  const run = fakeRun({ 'worktree create': { exitCode: e.exitCode, stdout: JSON.stringify(e.stdout) } })
  const r = await createOrcaCli({ run }).createWorktree(input)
  assert.deepEqual(r, { ok: false, error: { code: 'ORCA_CLI_FAILED', message: '--prompt requires --agent' } })
})

test('failures without an envelope map to ORCA_CLI_FAILED or TIMEOUT', async () => {
  const bad = await createOrcaCli({ run: fakeRun({ repo: { exitCode: 1, stderr: 'boom' } }) }).repos()
  assert.equal(bad.error.code, 'ORCA_CLI_FAILED')
  const slow = await createOrcaCli({ run: fakeRun({ repo: { exitCode: null, timedOut: true } }) }).repos()
  assert.equal(slow.error.code, 'TIMEOUT')
  const junk = await createOrcaCli({ run: fakeRun({ repo: { stdout: 'nope' } }) }).repos()
  assert.equal(junk.error.code, 'ORCA_CLI_FAILED')
})

test('repos maps id, name, path and keeps worktreeBaseRef only when present', async () => {
  const run = fakeRun({ 'repo list': { stdout: fixture('orca-repo-list.json') } })
  const r = await createOrcaCli({ run }).repos()
  assert.deepEqual(run.calls[0].args, ['repo', 'list', '--json'])
  assert.deepEqual(r.data, [{ id: '00000000-0000-4000-8000-000000000001', name: 'demo-repo', path: '/Users/demo/projects/demo-repo' }])
  const withBase = JSON.stringify({ ok: true, result: { repos: [{ id: 'a', displayName: 'A', path: '/p', worktreeBaseRef: 'origin/dev' }] } })
  const r2 = await createOrcaCli({ run: fakeRun({ 'repo list': { stdout: withBase } }) }).repos()
  assert.deepEqual(r2.data, [{ id: 'a', name: 'A', path: '/p', worktreeBaseRef: 'origin/dev' }])
})

test('searchRefs sends a space for an empty query and returns refs', async () => {
  const run = fakeRun({ 'repo search-refs': { stdout: fixture('orca-repo-search-refs.json') } })
  const cli = createOrcaCli({ run })
  const r = await cli.searchRefs('r1', '')
  assert.deepEqual(run.calls[0].args, ['repo', 'search-refs', '--repo', 'id:r1', '--query= ', '--limit', '200', '--json'])
  assert.deepEqual(r.data, ['main', 'origin/main'])
  await cli.searchRefs('r1', 'rel')
  assert.ok(run.calls[1].args.includes('--query=rel'))
  await cli.searchRefs('r1', '--x')
  assert.ok(run.calls[2].args.includes('--query=--x'))
})

test('openPanel finds the plugin key and opens the panel', async () => {
  const list = JSON.stringify({ ok: true, result: { plugins: [{ pluginKey: 'other.thing' }, { pluginKey: 'local.youtrack-for-orca' }] } })
  const run = fakeRun({ 'plugin list': { stdout: list }, 'plugin open': { stdout: JSON.stringify({ ok: true, result: {} }) } })
  const r = await createOrcaCli({ run }).openPanel('youtrack-for-orca', 'issues')
  assert.equal(r.ok, true)
  assert.deepEqual(run.calls[0].args, ['plugin', 'list', '--json'])
  assert.deepEqual(run.calls[1].args, ['plugin', 'open', 'local.youtrack-for-orca', '--panel', 'issues', '--json'])
})

test('openPanel fails when the plugin is not listed', async () => {
  const list = JSON.stringify({ ok: true, result: { plugins: [{ pluginKey: 'notyoutrack' }] } })
  const r = await createOrcaCli({ run: fakeRun({ 'plugin list': { stdout: list } }) }).openPanel('youtrack-for-orca', 'issues')
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'ORCA_CLI_FAILED')
})

test('createWorktree treats a blank prompt as no prompt', async () => {
  const run = fakeRun(created)
  await createOrcaCli({ run }).createWorktree({ ...input, prompt: '  \n' })
  const a = run.calls[0].args
  assert.ok(a.includes('--agent'))
  assert.ok(!a.some((x) => x.startsWith('--prompt')))
})

test('results never carry undefined values', async () => {
  const wt = JSON.stringify({ ok: true, result: { worktree: { identity: { key: 'wt2:local:x' }, branch: 'refs/heads/b' } } })
  const r = await createOrcaCli({ run: fakeRun({ 'worktree create': { stdout: wt } }) }).createWorktree(input)
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r)
  assert.ok(!('path' in r.data))
  const repos = JSON.stringify({ ok: true, result: { repos: [{ id: 'r1' }] } })
  const l = await createOrcaCli({ run: fakeRun({ 'repo list': { stdout: repos } }) }).repos()
  assert.deepEqual(l.data, [{ id: 'r1', name: 'r1' }])
})

test('createWorktree returns the agent terminal handle and pane key', async () => {
  const r = await createOrcaCli({ run: fakeRun(created) }).createWorktree(input)
  assert.equal(r.data.terminalId, 'term_00000000-0000-4000-8000-0000000000bb')
  assert.equal(r.data.paneKey, '00000000-0000-0000-0000-000000000000:00000000-0000-0000-0000-000000000000')
})

test('createWorktree omits the terminal keys when the answer has no launch', async () => {
  const body = JSON.parse(created['worktree create'].stdout)
  delete body.result.launch
  const r = await createOrcaCli({ run: fakeRun({ 'worktree create': { stdout: JSON.stringify(body) } }) }).createWorktree(input)
  assert.equal(r.ok, true)
  assert.equal('terminalId' in r.data, false)
  assert.equal('paneKey' in r.data, false)
})

const launched = { 'agent launch': { stdout: fixture('orca-agent-launch.json') } }

test('launchAgent starts the agent with its prompt in one launch', async () => {
  const run = fakeRun(launched)
  const r = await createOrcaCli({ run }).launchAgent({ workspaceId: 'identity:wt2:local:w1', agent: 'claude', prompt: 'Line 1\nLine 2' })
  assert.deepEqual(run.calls[0].args, [
    'agent', 'launch', '--agent', 'claude', '--worktree', 'identity:wt2:local:w1', '--surface', 'terminal',
    '--prompt=Line 1\nLine 2', '--json'
  ])
  assert.equal(run.calls[0].opts.timeoutMs, 90_000)
  assert.deepEqual(r, {
    ok: true,
    data: {
      terminalId: 'term_00000000-0000-4000-8000-0000000000bb',
      paneKey: '00000000-0000-4000-8000-0000000000cc:00000000-0000-4000-8000-0000000000dd'
    }
  })
})

test('launchAgent without a prompt sends no --prompt and tolerates an answer without a terminal', async () => {
  const run = fakeRun({ 'agent launch': { stdout: JSON.stringify({ ok: true, result: { outcome: { kind: 'chat' } } }) } })
  const r = await createOrcaCli({ run }).launchAgent({ workspaceId: 'identity:w1', agent: 'codex', prompt: ' ' })
  assert.equal(run.calls[0].args.some((x) => x.startsWith('--prompt')), false)
  assert.deepEqual(r, { ok: true, data: {} })
})

test('launchAgent maps an error envelope to ORCA_CLI_FAILED', async () => {
  const run = fakeRun({ 'agent launch': { exitCode: 1, stdout: JSON.stringify({ ok: false, error: { message: 'no such worktree' } }) } })
  const r = await createOrcaCli({ run }).launchAgent({ workspaceId: 'identity:w1', agent: 'claude', prompt: 'P' })
  assert.deepEqual(r, { ok: false, error: { code: 'ORCA_CLI_FAILED', message: 'no such worktree' } })
})

test('values that start with dashes stay one argument, so the Orca CLI does not read them as flags', async () => {
  const prompt = '--- BEGIN YOUTRACK ISSUE ---\nText'
  const run = fakeRun({ ...created, ...launched })
  const cli = createOrcaCli({ run })
  await cli.createWorktree({ ...input, name: '-x', baseBranch: '--weird', prompt })
  await cli.launchAgent({ workspaceId: 'identity:w1', agent: 'claude', prompt })
  const [create, launch] = run.calls.map((c) => c.args)
  for (const arg of ['--name=-x', '--base-branch=--weird', `--prompt=${prompt}`]) assert.ok(create.includes(arg), arg)
  assert.ok(launch.includes(`--prompt=${prompt}`))
  for (const args of [create, launch]) assert.ok(!args.includes('--prompt') && !args.includes('--name') && !args.includes(prompt))
})
