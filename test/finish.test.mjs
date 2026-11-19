import { test, assert } from 'orca/testing'
import { buildPrompt, finishBlock, PROMPT_LIMIT, safeValue } from '../worker/prompt.mjs'

const base = { server: 'work', id: 'DEMO-1' }

test('the finish block tells the agent how to comment and which state to set', () => {
  const both = finishBlock({ ...base, comment: true, stateField: 'Stage', state: 'In Review' })
  assert.match(both, /^When you are done:/)
  assert.ok(both.includes('youtrack --server work issue comment create --text-file - -- DEMO-1'))
  assert.ok(both.includes('youtrack --server work issue field set DEMO-1 Stage "In Review"'))
  assert.equal(finishBlock({ ...base, comment: false, stateField: 'State', state: '' }), '')
  assert.ok(!finishBlock({ ...base, comment: true, stateField: 'State', state: '' }).includes('field set'))
  assert.ok(!finishBlock({ ...base, comment: false, stateField: 'State', state: 'Done' }).includes('comment create'))
})

test('only plain state and field names are written into the block', () => {
  for (const bad of ['a"b', 'x$(y)', 'back`tick`', 'new\nline', 'c\\d', '{{id}}', '']) assert.equal(safeValue(bad), false, bad)
  assert.equal(safeValue('In Review'), true)
  assert.equal(finishBlock({ ...base, comment: false, stateField: 'State', state: 'x$(y)' }), '')
  assert.equal(finishBlock({ ...base, comment: false, stateField: 'St"ate', state: 'Done' }), '')
})

test('the finish block comes last, outside the issue text, and fits the prompt limit', () => {
  const suffix = finishBlock({ ...base, comment: true, stateField: 'State', state: 'Done' })
  const p = buildPrompt({ template: 'Fix {{id}}', vars: { id: 'DEMO-1', description: 'd'.repeat(10_000) }, includeDescription: true, description: 'd'.repeat(10_000), suffix })
  assert.ok(p.length <= PROMPT_LIMIT, String(p.length))
  assert.ok(p.endsWith(suffix))
  assert.ok(p.indexOf('--- END YOUTRACK ISSUE (untrusted) ---') < p.indexOf(suffix))
  const placed = buildPrompt({ template: 'A {{description}} B', vars: { id: 'DEMO-1', description: 'x'.repeat(9000) }, includeDescription: false, suffix })
  assert.ok(placed.length <= PROMPT_LIMIT && placed.endsWith(suffix))
  assert.equal(buildPrompt({ template: 'T', vars: {}, includeDescription: false }), 'T')
})
