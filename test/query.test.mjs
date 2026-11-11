import { test, assert } from 'orca/testing'
import { SORT_FIELDS, parseSort, applySort, parseColumns, columnKey } from '../worker/query.mjs'

test('applySort appends a clause and toggles direction on the same column', () => {
  const a = applySort('for: me', 'updated')
  assert.equal(a, 'for: me sort by: updated asc')
  const b = applySort(a, 'updated')
  assert.equal(b, 'for: me sort by: updated desc')
  assert.equal(applySort(b, 'updated'), 'for: me sort by: updated asc')
})

test('applySort replaces the previous clause when the column changes', () => {
  assert.equal(
    applySort('for: me sort by: updated desc', 'field:state', 'State'),
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
  assert.deepEqual(parseSort('x  Sort   By:   Priority   DESC '), { column: 'field:priority', direction: 'desc' })
  assert.deepEqual(parseSort('x sort by: {Fix versions} asc'), { column: 'field:fix versions', direction: 'asc' })
})

test('parseSort reads any other field as a custom column, and null without a sort', () => {
  assert.deepEqual(parseSort('sort by: votes'), { column: 'field:votes', direction: 'asc' })
  assert.equal(parseSort('sort by:'), null)
  assert.equal(parseSort('for: me'), null)
})

test('applySort removes every existing clause', () => {
  assert.equal(
    applySort('a sort by: summary asc sort by: State desc', 'field:priority', 'Priority'),
    'a sort by: Priority asc'
  )
})

test('a custom column sorts by its field, in braces when the name has a space', () => {
  assert.equal(applySort('for: me', 'field:fix versions', 'Fix versions'), 'for: me sort by: {Fix versions} asc')
  assert.equal(applySort('for: me sort by: {Fix versions} asc', 'field:fix versions', 'Fix versions'), 'for: me sort by: {Fix versions} desc')
  assert.equal(applySort('', 'field:state'), 'sort by: state asc')
})

test('parseColumns keeps each named field once, in order, without the fixed columns, at most 8', () => {
  assert.deepEqual(parseColumns('State, , priority,Fix  versions,state,Created,{x},Assignee'), ['State', 'priority', 'Fix versions', 'Assignee'])
  assert.deepEqual(parseColumns(undefined), ['State', 'Priority', 'Assignee'])
  assert.deepEqual(parseColumns(''), [])
  assert.equal(parseColumns(Array.from({ length: 12 }, (_, i) => `F${i}`).join(',')).length, 8)
  assert.equal(parseColumns('x'.repeat(61)).length, 0)
  assert.equal(columnKey('Fix  Versions'), 'field:fix versions')
})
