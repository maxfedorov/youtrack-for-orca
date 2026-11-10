import { assert, mount, mockHost, test } from 'orca/testing'
import * as panel from '../src/panel'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
const issue = (n: number) => ({
  id: `DEMO-${n}`, summary: `Issue ${n}`, state: { name: 'Open' },
  created: 1_690_000_000_000 + n, updated: 1_700_000_000_000 + n, resolved: false,
  url: `https://main.example.youtrack.cloud/issue/DEMO-${n}`
})
const comment = (n: number) => ({ id: `c${n}`, author: { login: 'bob', fullName: 'Bob Roe' }, created: 1_700_000_100_000 + n, textMd: `Comment ${n}` })
const env = ok({
  cli: { found: true }, orcaCli: { found: true },
  servers: [{ alias: 'main', url: 'https://main.example.youtrack.cloud', active: true, status: 'authenticated' }],
  server: 'main', query: 'for: me', defaultQuery: 'for: me'
})
/** A fake server: an added comment is in the comments the next reads answer. */
function setup(post?: (input: any) => unknown) {
  const posted: any[] = []
  const host = mockHost({
    requests: {
      'yt.env': env,
      'yt.issues.search': ok({ issues: [issue(1)], hasMore: false, total: 1 }),
      'yt.savedQueries': ok([]),
      'yt.links': ok({}),
      'yt.setQuery': ok({}),
      'yt.issue.get': (i: any) => ok({ ...issue(1), id: i.id, project: { shortName: 'DEMO', name: 'Demo' }, fields: [], descriptionMd: '', comments: posted.map((_, n) => comment(n + 1)) }),
      'yt.issue.comments': () => ok({ comments: posted.map((_, n) => comment(n + 1)) }),
      'yt.issue.comment': post ?? ((input: any) => (posted.push(input), ok({})))
    }
  })
  return { host, posted }
}
const calls = (host: any, name: string) => host.callsOf('plugin.request').filter((c: any) => c.name === name)
const box = { type: 'Textarea', label: 'Add comment' }
const send = { role: 'button', text: 'Send' }
const open = async (host: any) => {
  const view = await mount(panel, { host })
  await view.activateRow(view.find({ type: 'Table' }), 'DEMO-1')
  return view
}
const clean = (view: any) => {
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
}

test('send adds the comment, clears the box and loads the comments again', async () => {
  const { host } = setup()
  const view = await open(host)
  assert.ok(view.find({ text: 'No comments' }))
  assert.equal(view.find(send).props.disabled, true)
  await view.type(box, '  Looks good  ')
  await view.press(send)
  await view.settled()
  assert.deepEqual(calls(host, 'yt.issue.comment')[0].input, { server: 'main', id: 'DEMO-1', text: 'Looks good' })
  assert.equal(calls(host, 'yt.issue.comments').length, 1)
  assert.ok(view.find({ type: 'Markdown', content: 'Comment 1' }))
  assert.equal(view.valueOf(view.find(box)), '')
  clean(view)
  await view.unmount()
})

test('Cmd+Enter in the box sends the comment', async () => {
  const { host } = setup()
  const view = await open(host)
  await view.type(box, 'Via keyboard', { submit: true })
  await view.settled()
  assert.deepEqual(calls(host, 'yt.issue.comment')[0].input, { server: 'main', id: 'DEMO-1', text: 'Via keyboard' })
  assert.ok(view.find({ type: 'Markdown', content: 'Comment 1' }))
  clean(view)
  await view.unmount()
})

test('a failed comment keeps the text and shows why', async () => {
  const { host } = setup(() => fail('FORBIDDEN', 'HTTP 403: Forbidden'))
  const view = await open(host)
  await view.type(box, 'Not allowed')
  await view.press(send)
  await view.settled()
  assert.ok(view.find({ text: 'HTTP 403: Forbidden' }))
  assert.equal(view.valueOf(view.find(box)), 'Not allowed')
  assert.equal(calls(host, 'yt.issue.comments').length, 0)
  await view.unmount()
})

test('a timed-out comment warns it may have been added and loads the comments', async () => {
  const { host } = setup(() => fail('TIMEOUT', 'Timed out'))
  const view = await open(host)
  await view.type(box, 'Slow')
  await view.press(send)
  await view.settled()
  assert.ok(view.find({ text: /may have been added/ }))
  assert.equal(view.valueOf(view.find(box)), 'Slow')
  assert.equal(calls(host, 'yt.issue.comments').length, 1)
  await view.unmount()
})
