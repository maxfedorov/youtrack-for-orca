import { test, assert } from 'orca/testing'
import { readFileSync } from 'node:fs'
import {
  PROMPT_LIMIT, slugify, issueVars, renderTemplate, workspaceName, buildPrompt,
} from '../worker/prompt.mjs'

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
const settings = manifest.contributes.settings
const defaultOf = (key) => settings.find((s) => s.key === key).default
const TEMPLATE = defaultOf('promptTemplate')

const issue = {
  id: 'DEMO-1',
  summary: 'Crash on login: Ошибка!',
  url: 'https://example.youtrack.cloud/issue/DEMO-1',
  project: { shortName: 'DEMO' },
  state: { name: 'Open' },
  priority: { name: 'Major' },
  assignee: { fullName: 'Ann Lee' },
  descriptionMd: 'Steps to reproduce',
}

test('default template renders server and id', () => {
  const vars = issueVars({ issue, server: 'work', branch: 'b' })
  const { text, unknown } = renderTemplate(TEMPLATE, vars)
  assert.ok(text.includes('youtrack --server work issue view DEMO-1'))
  assert.ok(text.includes('issue link list DEMO-1'))
  assert.deepEqual(unknown, [])
})

test('issueVars fills every key and defaults missing values to empty', () => {
  const v = issueVars({ issue, server: 'work', branch: 'x' })
  assert.equal(v.id_lower, 'demo-1')
  assert.equal(v.project, 'DEMO')
  assert.equal(v.assignee, 'Ann Lee')
  assert.equal(v.summary_slug, 'crash-on-login')
  assert.equal(v.branch, 'x')
  const e = issueVars({ issue: { id: 'A-1', summary: 's', url: 'u' }, server: 's', branch: '' })
  assert.equal(e.state, '')
  assert.equal(e.priority, '')
  assert.equal(e.assignee, '')
  assert.equal(e.description, '')
  assert.equal(e.project, '')
})

test('unknown placeholder kept and reported', () => {
  const r = renderTemplate('a {{id}} {{nope}} {{nope}}', { id: 'X-1' })
  assert.equal(r.text, 'a X-1 {{nope}} {{nope}}')
  assert.deepEqual(r.unknown, ['nope'])
})

test('slugify drops non-ASCII and collapses dashes', () => {
  assert.equal(slugify('Crash on login: Ошибка!'), 'crash-on-login')
  assert.equal(slugify('  --A__b  c--'), 'a-b-c')
  assert.equal(slugify('x'.repeat(100)).length, 40)
  assert.equal(slugify('abc-def-ghi', 5), 'abc-d')
  assert.equal(slugify('abc-def', 4), 'abc')
})

test('workspaceName default', () => {
  const vars = issueVars({ issue, server: 'work', branch: '' })
  assert.equal(workspaceName(defaultOf('branchTemplate'), vars), 'demo-1-crash-on-login')
})

test('workspaceName falls back to id_lower when empty', () => {
  assert.equal(workspaceName('{{summary}}', { id_lower: 'demo-1', summary: 'Ошибка' }), 'demo-1')
})

test('truncates description and keeps END marker', () => {
  const out = buildPrompt({
    template: 'Do it', vars: {}, includeDescription: true, description: 'x'.repeat(10000),
  })
  assert.ok(out.length <= PROMPT_LIMIT)
  assert.ok(out.endsWith('--- END YOUTRACK ISSUE (untrusted) ---'))
  assert.ok(out.includes('[truncated]'))
  assert.ok(out.includes('--- BEGIN YOUTRACK ISSUE (untrusted) ---\n'))
})

test('short description is appended untouched', () => {
  const out = buildPrompt({ template: 'T', vars: {}, includeDescription: true, description: 'hello' })
  assert.equal(out, 'T\n\n--- BEGIN YOUTRACK ISSUE (untrusted) ---\nhello\n--- END YOUTRACK ISSUE (untrusted) ---')
})

test('includeDescription false adds nothing', () => {
  assert.equal(buildPrompt({ template: 'T {{id}}', vars: { id: 'A-1' }, includeDescription: false, description: 'zzz' }), 'T A-1')
})

test('template over the limit is returned unchanged', () => {
  const t = 'y'.repeat(PROMPT_LIMIT + 10)
  assert.equal(buildPrompt({ template: t, vars: {}, includeDescription: true, description: 'd' }), t)
})

test('description placeholder in the template is truncated to fit', () => {
  const out = buildPrompt({
    template: 'Head\n{{description}}', vars: { description: 'x'.repeat(9000) }, includeDescription: false, description: '',
  })
  assert.ok(out.length <= PROMPT_LIMIT)
  assert.ok(out.includes('[truncated]'))
})
