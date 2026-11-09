import { test, assert } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { resolveYoutrack, createYoutrack, classifyCliError } from '../worker/youtrack-cli.mjs'
import { findOnPath, runProcess } from '../worker/exec.mjs'
import { fakeRun } from './helpers.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const errors = fixture('yt-errors.json')
const errText = (k) => JSON.stringify(errors[k].stderr)

test('resolveYoutrack prefers existing setting path', () => {
  const p = resolveYoutrack({
    settingPath: '/custom/youtrack', env: { PATH: '/usr/bin' }, platform: 'linux', homedir: '/home/u',
    exists: (f) => f === '/custom/youtrack' || f === '/usr/bin/youtrack'
  })
  assert.equal(p, '/custom/youtrack')
})

test('resolveYoutrack falls back to PATH, then well-known dirs', () => {
  const base = { settingPath: '', env: { PATH: '/usr/bin:/bin' }, platform: 'linux', homedir: '/home/u' }
  assert.equal(resolveYoutrack({ ...base, exists: (f) => f === '/bin/youtrack' }), '/bin/youtrack')
  assert.equal(resolveYoutrack({ ...base, exists: (f) => f === '/home/u/.local/bin/youtrack' }), '/home/u/.local/bin/youtrack')
})

test('finds youtrack.exe via PATHEXT on win32', () => {
  const p = resolveYoutrack({
    settingPath: '', env: { PATH: 'C:\\bin', PATHEXT: '.COM;.EXE' }, platform: 'win32', homedir: 'C:\\Users\\u',
    exists: (f) => f === 'C:\\bin\\youtrack.EXE'
  })
  assert.equal(p, 'C:\\bin\\youtrack.EXE')
})

test('findOnPath reads Path on win32 and defaults PATHEXT', () => {
  const p = findOnPath('orca', { env: { Path: 'C:\\a;C:\\b' }, platform: 'win32', exists: (f) => f === 'C:\\b\\orca.EXE' })
  assert.equal(p, 'C:\\b\\orca.EXE')
})

test('findOnPath prefers .EXE and never returns shell-only shims on win32', () => {
  const env = { Path: 'C:\\a', PATHEXT: '.CMD;.BAT;.EXE;.COM' }
  assert.equal(findOnPath('youtrack', { env, platform: 'win32', exists: (f) => f === 'C:\\a\\youtrack.CMD' || f === 'C:\\a\\youtrack.EXE' }), 'C:\\a\\youtrack.EXE')
  assert.equal(findOnPath('youtrack', { env, platform: 'win32', exists: (f) => f === 'C:\\a\\youtrack.CMD' || f === 'C:\\a\\youtrack.BAT' }), null)
  assert.equal(findOnPath('claude', { env, platform: 'win32', exists: (f) => f === 'C:\\a\\claude.CMD', shims: true }), 'C:\\a\\claude.CMD')
})

test('resolveYoutrack returns null when nothing exists', () => {
  assert.equal(resolveYoutrack({ settingPath: '', env: { PATH: '/usr/bin' }, platform: 'linux', homedir: '/h', exists: () => false }), null)
  assert.equal(resolveYoutrack({ settingPath: '', env: {}, platform: 'win32', homedir: 'C:\\u', exists: () => false }), null)
})

test('listIssues builds argv', async () => {
  const run = fakeRun({ '--server work issue list': { stdout: '[]' } })
  const yt = createYoutrack({ bin: 'youtrack', run })
  const r = await yt.listIssues('work', 'for: me', 0, 50)
  assert.deepEqual(r, { ok: true, data: [] })
  assert.deepEqual(run.calls[0].args, ['--server', 'work', 'issue', 'list', '--query', 'for: me', '--limit', '50', '--offset', '0', '--fields', 'idReadable,summary,updated,resolved,State,Priority,Assignee', '--json', '--quiet'])
  assert.equal(run.calls[0].opts.timeoutMs, 15000)
})

test('passes hostile query as a single argv element', async () => {
  const q = `a" ; rm -rf ~ $(x) 'b' задача`
  const run = fakeRun({ '': { stdout: '[]' } })
  const yt = createYoutrack({ bin: 'youtrack', run })
  await yt.listIssues('work', q, 0, 50)
  assert.equal(run.calls[0].args.filter((a) => a === q).length, 1)
})

test('other methods build argv', async () => {
  const run = fakeRun({ '': { stdout: '{}' } })
  const yt = createYoutrack({ bin: 'youtrack', run })
  await yt.viewIssue('work', 'DEMO-1')
  await yt.listComments('work', 'DEMO-1')
  await yt.savedSearches('work')
  await yt.createSavedSearch('work', 'My "s"', 'for: me')
  await yt.version()
  await yt.instances()
  assert.deepEqual(run.calls.map((c) => c.args), [
    ['--server', 'work', 'issue', 'view', 'DEMO-1', '-f', 'customFields(name,value(name,login,fullName))', '--json', '--quiet'],
    ['--server', 'work', 'issue', 'comment', 'list', 'DEMO-1', '--json', '--quiet'],
    ['--server', 'work', 'search', 'list', '--json', '--quiet'],
    ['--server', 'work', 'search', 'create', '--name', 'My "s"', '--query', 'for: me', '--json', '--quiet'],
    ['--version'],
    ['instance', 'list', '--json', '--quiet']
  ])
  assert.equal(run.calls[3].opts.timeoutMs, 30000)
})

test('instances returns parsed list', async () => {
  const run = fakeRun({ 'instance list': { stdout: JSON.stringify(fixture('yt-instance-list.json')) } })
  const r = await createYoutrack({ bin: 'youtrack', run }).instances()
  assert.equal(r.data[0].alias, 'example')
})

test('classifies parse error', () => {
  const stderr = errText('query-invalid-400')
  const r = classifyCliError({ exitCode: 1, stderr, timedOut: false })
  assert.equal(r.code, 'QUERY_INVALID')
  assert.equal(r.message, errors['query-invalid-400'].stderr.error.message)
})

test('classifies CLI errors by code', () => {
  const c = (k, extra = {}) => classifyCliError({ exitCode: 1, stderr: errText(k), timedOut: false, ...extra }).code
  assert.equal(c('unauthorized-401'), 'AUTH_FAILED')
  assert.equal(c('not-found-404'), 'NOT_FOUND')
  assert.equal(c('network-refused'), 'NETWORK')
  assert.equal(c('network-dns'), 'NETWORK')
  assert.equal(c('unknown-alias'), 'NO_SERVERS')
  assert.equal(c('saved-search-duplicate'), 'UNKNOWN')
  assert.equal(c('token-origin-refused'), 'UNKNOWN')
  assert.equal(classifyCliError({ exitCode: 1, stderr: '{"error":{"code":"forbidden","message":"HTTP 403: nope"}}' }).code, 'FORBIDDEN')
  assert.equal(classifyCliError({ exitCode: 1, stderr: '{"error":{"code":"api_error","message":"HTTP 403: nope"}}' }).code, 'FORBIDDEN')
  assert.equal(classifyCliError({ exitCode: 1, stderr: '{"error":{"code":"api_error","message":"HTTP 401: x"}}' }).code, 'AUTH_FAILED')
})

test('duplicate saved search keeps the CLI message', () => {
  const r = classifyCliError({ exitCode: 1, stderr: errText('saved-search-duplicate') })
  assert.equal(r.message, errors['saved-search-duplicate'].stderr.error.message)
})

test('parses stderr line by line past a warning line', () => {
  const stderr = errors['timeout-killed-by-caller'].stderr[0] + '\n' + errText('not-found-404') + '\r\n'
  assert.equal(classifyCliError({ exitCode: 1, stderr }).code, 'NOT_FOUND')
})

test('classifies timeout, ENOENT and the rest', () => {
  assert.equal(classifyCliError({ exitCode: 1, stderr: '', timedOut: true }).code, 'TIMEOUT')
  assert.equal(classifyCliError({ exitCode: null, stderr: '', timedOut: false, spawnError: 'ENOENT' }).code, 'CLI_NOT_FOUND')
  assert.equal(classifyCliError({ exitCode: 2, stderr: 'garbage', timedOut: false }).code, 'UNKNOWN')
})

test('method maps failures through classifyCliError', async () => {
  const run = fakeRun({ '': { exitCode: 1, stderr: errText('unauthorized-401') } })
  const r = await createYoutrack({ bin: 'youtrack', run }).countIssues('work', 'x')
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'AUTH_FAILED')
})

test('invalid JSON on success yields UNKNOWN, not a throw', async () => {
  const run = fakeRun({ '': { stdout: 'not json' } })
  const r = await createYoutrack({ bin: 'youtrack', run }).listIssues('w', 'q', 0, 1)
  assert.equal(r.error.code, 'UNKNOWN')
})

test('env has YOUTRACK_NO_UPDATE and no token', async () => {
  const run = fakeRun({ '': { stdout: '[]' } })
  await createYoutrack({ bin: 'youtrack', run }).savedSearches('work')
  const env = run.calls[0].opts.env
  assert.equal(env.YOUTRACK_NO_UPDATE, '1')
  assert.equal(env.NO_COLOR, '1')
  assert.equal('YOUTRACK_TOKEN' in env, false)
  assert.equal('YOUTRACK_BASE_URL' in env, false)
})

test('countIssues parses plain number', async () => {
  const run = fakeRun({ '--server work issue count': { stdout: '20\n' } })
  const r = await createYoutrack({ bin: 'youtrack', run }).countIssues('work', 'for: me')
  assert.deepEqual(r, { ok: true, data: 20 })
  assert.deepEqual(run.calls[0].args, ['--server', 'work', 'issue', 'count', '--query', 'for: me', '--json', '--quiet'])
})

test('loginWeb reports authorizationUrl from stderr', async () => {
  const url = 'https://example.youtrack.cloud/hub/auth?x'
  const seen = []
  const run = async (args, opts) => {
    run.args = args
    run.opts = opts
    opts.onStderrLine('warning: something')
    opts.onStderrLine(JSON.stringify({ authorizationUrl: url }))
    return { exitCode: 0, stdout: '{"alias":"example"}', stderr: '', timedOut: false }
  }
  const r = await createYoutrack({ bin: 'youtrack', run }).loginWeb('https://example.youtrack.cloud', (u) => seen.push(u))
  assert.deepEqual(seen, [url])
  assert.deepEqual(r, { ok: true, data: { alias: 'example' } })
  assert.deepEqual(run.args, ['auth', 'login', 'https://example.youtrack.cloud', '--web', '--json'])
  assert.equal(run.opts.timeoutMs, 600000)
})

test('loginWeb without stdout JSON gives empty object; failure is classified', async () => {
  const yt = (res) => createYoutrack({ bin: 'youtrack', run: async () => ({ timedOut: false, stderr: '', stdout: '', exitCode: 0, ...res }) })
  assert.deepEqual(await yt({}).loginWeb('u', () => {}), { ok: true, data: {} })
  const r = await yt({ exitCode: 1, stderr: errText('auth-login-web-invalid-url') }).loginWeb('u', () => {})
  assert.equal(r.ok, false)
})

test('runProcess limits concurrency to 4 and reports exit/timeouts', async () => {
  let active = 0
  let max = 0
  const impl = (file, args, opts, cb) => {
    active++
    max = Math.max(max, active)
    setTimeout(() => { active--; cb(null, 'out', '') }, 10)
    return { stderr: null, stdin: { end() {} } }
  }
  const rs = await Promise.all(Array.from({ length: 10 }, () => runProcess('x', [], { timeoutMs: 1000 }, impl)))
  assert.equal(max, 4)
  assert.deepEqual(rs[0], { exitCode: 0, stdout: 'out', stderr: '', timedOut: false })

  const killed = await runProcess('x', [], { timeoutMs: 1 }, (f, a, o, cb) => {
    cb(Object.assign(new Error('x'), { killed: true, code: null, signal: 'SIGTERM' }), '', 'e')
    return {}
  })
  assert.equal(killed.timedOut, true)
  const enoent = await runProcess('x', [], { timeoutMs: 1 }, (f, a, o, cb) => {
    cb(Object.assign(new Error('x'), { code: 'ENOENT' }), '', '')
    return {}
  })
  assert.equal(enoent.spawnError, 'ENOENT')
})

test('runProcess passes args array, input and a token-free env', async () => {
  process.env.YOUTRACK_TOKEN = 'secret'
  let seen
  await runProcess('bin', ['a b', '$(x)'], { timeoutMs: 5, input: 'in', env: { NO_COLOR: '1' } }, (file, args, opts, cb) => {
    seen = { file, args, opts }
    cb(null, '', '')
    return { stdin: { end(d) { seen.input = d } } }
  })
  delete process.env.YOUTRACK_TOKEN
  assert.deepEqual(seen.args, ['a b', '$(x)'])
  assert.equal(seen.opts.timeout, 5)
  assert.equal(seen.opts.shell, undefined)
  assert.equal(seen.opts.env.NO_COLOR, '1')
  assert.equal('YOUTRACK_TOKEN' in seen.opts.env, false)
  assert.equal(seen.input, 'in')
})

test('an indented JSON error on stderr is classified', () => {
  const stderr = JSON.stringify(
    { error: { code: 'api_error', message: "HTTP 400: Can't parse search query, please check and update query syntax" } },
    null,
    2
  )
  const r = classifyCliError({ exitCode: 1, stderr: `warning: something\n${stderr}\n` })
  assert.equal(r.code, 'QUERY_INVALID')
  assert.match(r.message, /Can't parse search query/)
})
