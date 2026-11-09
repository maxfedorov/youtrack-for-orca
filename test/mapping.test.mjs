import { test, assert } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { toIssueRow, toIssueDetail, toSavedQuery, toServer } from '../worker/mapping.mjs'

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

const issues = load('yt-issue-list.json')
const view = load('yt-issue-view-custom-fields.json')
const comments = load('yt-issue-comment-list.json')
const searches = load('yt-search-list.json')
const instances = load('yt-instance-list.json')
const BASE = 'https://example.youtrack.cloud'

test('maps customFields by name', () => {
  const row = toIssueRow(issues[0], BASE)
  assert.equal(row.id, 'DEMO-1')
  assert.equal(row.summary, 'Demo issue 1')
  assert.deepEqual(row.state, { name: 'Done' })
  assert.deepEqual(row.priority, { name: 'Show-stopper' })
  assert.equal(row.resolved, true)
  assert.equal(typeof row.updated, 'number')
  assert.equal('assignee' in row, false)
  assert.equal('type' in row, false)
})

test('rows are strict JSON without undefined values', () => {
  for (const raw of issues) {
    const row = toIssueRow(raw, BASE)
    assert.deepEqual(JSON.parse(JSON.stringify(row)), row)
    assert.equal(Object.values(row).includes(undefined), false)
  }
})

test('maps assignee, color and unresolved', () => {
  const raw = {
    idReadable: 'DEMO-9',
    summary: 's',
    updated: 5,
    resolved: null,
    customFields: [
      { name: 'Assignee', value: { login: 'demo', fullName: 'Demo User', id: 'x' } },
      { name: 'State', value: { name: 'Open', color: { id: '1' } } },
      { name: 'Priority', value: { name: 'Major', color: '#fff' } }
    ]
  }
  const row = toIssueRow(raw, BASE)
  assert.deepEqual(row.assignee, { login: 'demo', fullName: 'Demo User' })
  assert.equal(row.resolved, false)
  assert.deepEqual(row.priority, { name: 'Major', color: '#fff' })
  assert.deepEqual(row.state, { name: 'Open' })
})

test('missing customFields yields no optional keys', () => {
  const row = toIssueRow({ idReadable: 'DEMO-2', summary: 's', updated: 1, resolved: null }, BASE)
  assert.deepEqual(Object.keys(row).sort(), ['id', 'resolved', 'summary', 'updated', 'url'])
})

test('builds browser url without double slash', () => {
  assert.equal(toIssueRow(issues[0], BASE + '/').url, BASE + '/issue/DEMO-1')
  assert.equal(toIssueRow(issues[0], BASE).url, BASE + '/issue/DEMO-1')
})

test('issue detail maps description, project, type and comments', () => {
  const d = toIssueDetail(view, comments, BASE)
  assert.equal(d.id, 'DEMO-1')
  assert.deepEqual(d.type, { name: 'Task' })
  assert.deepEqual(d.project, { shortName: 'DEMO', name: 'Demo project' })
  assert.equal(d.descriptionMd, 'Demo description with **Markdown**.\n\nSecond paragraph.')
  assert.equal(d.comments.length, 1)
  assert.deepEqual(d.comments[0], {
    id: '0-3',
    author: { login: 'demo', fullName: 'Demo User' },
    created: 1794215334060,
    textMd: 'Demo comment with **Markdown**.'
  })
})

test('comments sorted ascending by created; null text becomes empty', () => {
  const a = { id: 'a', author: { login: 'demo', fullName: 'Demo User' }, created: 20, text: 'b' }
  const b = { id: 'b', author: { login: 'demo', fullName: 'Demo User' }, created: 10, text: null }
  const d = toIssueDetail(view, [a, b], BASE)
  assert.deepEqual(d.comments.map((c) => c.id), ['b', 'a'])
  assert.equal(d.comments[0].textMd, '')
})

test('null comments -> []', () => {
  assert.deepEqual(toIssueDetail(view, null, BASE).comments, [])
})

test('null description -> empty string', () => {
  assert.equal(toIssueDetail({ ...view, description: null }, [], BASE).descriptionMd, '')
})

test('saved searches keep name and query', () => {
  assert.deepEqual(toSavedQuery(searches[0]), {
    id: '0-4',
    name: 'Demo search 0',
    query: 'for: me #Unresolved'
  })
})

test('instances map status', () => {
  assert.deepEqual(toServer(instances[0]), {
    alias: 'example',
    url: 'https://example.youtrack.cloud',
    active: true,
    status: 'authenticated'
  })
})
