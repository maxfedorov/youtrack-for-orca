import { test, assert } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { toIssueRow, toIssueDetail, toSavedQuery, toServer, toServers, toSavedQueries } from '../worker/mapping.mjs'

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
  assert.equal(row.created, issues[0].created)
  assert.equal('assignee' in row, false)
  assert.equal('type' in row, false)
})

test('missing created becomes 0', () => {
  assert.equal(toIssueRow({ idReadable: 'DEMO-9' }, BASE).created, 0)
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
  assert.deepEqual(Object.keys(row).sort(), ['created', 'id', 'resolved', 'summary', 'updated', 'url'])
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

const strict = (v) => assert.deepEqual(JSON.parse(JSON.stringify(v)), v)
const noUndefined = (v) => assert.equal(JSON.stringify(v).includes('undefined'), false)

test('an empty raw issue maps to defaults, never undefined', () => {
  const row = toIssueRow({}, BASE)
  assert.deepEqual(row, { id: '', summary: '', created: 0, updated: 0, resolved: false, url: BASE + '/issue/' })
  strict(row)
  const partial = toIssueRow({ idReadable: 'DEMO-2' }, BASE)
  assert.equal(partial.summary, '')
  assert.equal(partial.updated, 0)
  strict(toIssueRow({ idReadable: 'DEMO-2', summary: null, updated: null }, BASE))
})

test('a partial detail and partial comments map to defaults', () => {
  const d = toIssueDetail({ idReadable: 'DEMO-3' }, [{ created: 5 }, {}], BASE)
  assert.equal(d.descriptionMd, '')
  assert.deepEqual(d.project, { shortName: '', name: '' })
  assert.deepEqual(d.comments.map((c) => [c.id, c.created, c.textMd]), [['', 0, ''], ['', 5, '']])
  strict(d)
  noUndefined(d)
})

test('a user without a full name falls back to the login', () => {
  const d = toIssueDetail({ idReadable: 'DEMO-3', customFields: [{ name: 'Assignee', value: { login: 'jo' } }] }, [], BASE)
  assert.deepEqual(d.assignee, { login: 'jo', fullName: 'jo' })
})

test('deleted comments are left out', () => {
  const live = { id: 'a', author: { login: 'demo' }, created: 1, text: 'keep', deleted: false }
  const gone = { id: 'b', author: { login: 'demo' }, created: 2, text: 'gone', deleted: true }
  assert.deepEqual(toIssueDetail(view, [live, gone], BASE).comments.map((c) => c.id), ['a'])
})

test('an instance with missing fields gets defaults', () => {
  assert.deepEqual(toServer({ alias: 'x' }), { alias: 'x', url: '', active: false, status: 'unknown' })
  strict(toServer({}))
})

test('instances without an alias are dropped', () => {
  assert.deepEqual(toServers([{ alias: 'a' }, { url: 'u' }, null, { alias: '' }]).map((s) => s.alias), ['a'])
  assert.deepEqual(toServers(null), [])
})

test('saved searches without a query are skipped', () => {
  assert.equal(toSavedQuery({ id: '1', name: 'n' }), null)
  assert.deepEqual(toSavedQuery({ query: 'q' }), { id: '', name: '', query: 'q' })
  assert.deepEqual(toSavedQueries([{ id: '1', name: 'n' }, { id: '2', query: 'q' }, null, { id: '3', name: 'ok', query: 'q' }]), [{ id: '3', name: 'ok', query: 'q' }])
})

const types = load('yt-issue-view-field-types.json')
const fieldsOf = (raw) => toIssueDetail(raw, [], BASE).fields
const fieldMap = () => Object.fromEntries(fieldsOf(types).map((f) => [f.name, f.value]))

test('detail fields keep YouTrack order and include every custom field', () => {
  assert.deepEqual(
    fieldsOf(types).map((f) => f.name),
    ['Priority', 'State', 'Assignee', 'Reviewers', 'Fix versions', 'Affected versions', 'Subsystem', 'Notes', 'Empty note', 'Due date', 'Checked at', 'Estimation', 'Points', 'Label']
  )
})

test('field values: enum, state and version use the name', () => {
  const m = fieldMap()
  assert.equal(m.Priority, 'Major')
  assert.equal(m.State, 'In Progress')
  assert.equal(m['Fix versions'], '1.0, 1.1')
})

test('field values: users use the full name, multi users are comma separated', () => {
  const m = fieldMap()
  assert.equal(m.Assignee, 'Demo User')
  assert.equal(m.Reviewers, 'Ann Demo, Bob Demo')
})

test('field values: text, period and simple values are readable strings', () => {
  const m = fieldMap()
  assert.equal(m.Notes, 'Demo note text')
  assert.equal(m.Estimation, '2h 30m')
  assert.equal(m.Points, '5')
  assert.equal(m.Label, 'demo-label')
})

test('field values: dates are formatted as YYYY-MM-DD (UTC)', () => {
  assert.equal(fieldMap()['Due date'], '2026-11-09')
})

test('empty field values use the empty text of the project field, else a dash', () => {
  const m = fieldMap()
  assert.equal(m.Subsystem, 'No Subsystem')
  assert.equal(m['Affected versions'], 'Unknown')
  assert.equal(m['Checked at'], '\u2014')
  assert.equal(m['Empty note'], '\u2014')
})

test('missing customFields gives no fields', () => {
  assert.deepEqual(fieldsOf({ idReadable: 'DEMO-3' }), [])
})

test('fields without a name are skipped and values are always strings', () => {
  const f = fieldsOf({ idReadable: 'DEMO-3', customFields: [{ value: 'x' }, { name: 'N', value: { weird: true } }, null] })
  assert.deepEqual(f, [{ name: 'N', value: '\u2014' }])
})
