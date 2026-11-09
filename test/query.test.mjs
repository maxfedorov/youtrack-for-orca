import { test, assert } from 'orca/testing'
import { SORT_FIELDS, parseSort, applySort } from '../worker/query.mjs'

test('applySort appends a clause and toggles direction on the same column', () => {
  const a = applySort('for: me', 'updated')
  assert.equal(a, 'for: me sort by: updated asc')
  const b = applySort(a, 'updated')
  assert.equal(b, 'for: me sort by: updated desc')
  assert.equal(applySort(b, 'updated'), 'for: me sort by: updated asc')
})

test('applySort replaces the previous clause when the column changes', () => {
  assert.equal(
    applySort('for: me sort by: updated desc', 'state'),
    'for: me sort by: State asc'
  )
})

test('created is a sortable column', () => {
  assert.equal(SORT_FIELDS.created, 'created')
  assert.equal(applySort('for: me', 'created'), 'for: me sort by: created asc')
  assert.deepEqual(parseSort('for: me sort by: created desc'), { column: 'created', direction: 'desc' })
})

test('applySort wraps the field with a space in braces', () => {
  assert.equal(SORT_FIELDS.id, '{issue id}')
  assert.equal(applySort('', 'id'), 'sort by: {issue id} asc')
})

test('parseSort reads column and direction', () => {
  assert.deepEqual(parseSort('#Unresolved sort by: {issue id} desc'), { column: 'id', direction: 'desc' })
  assert.deepEqual(parseSort('x sort by: issue id'), { column: 'id', direction: 'asc' })
  assert.deepEqual(parseSort('x  Sort   By:   Priority   DESC '), { column: 'priority', direction: 'desc' })
})

test('parseSort returns null for unknown or missing sort', () => {
  assert.equal(parseSort('sort by: votes'), null)
  assert.equal(parseSort('for: me'), null)
})

test('applySort removes every existing clause', () => {
  assert.equal(
    applySort('a sort by: summary asc sort by: State desc', 'priority'),
    'a sort by: Priority asc'
  )
})
