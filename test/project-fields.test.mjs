import { test, assert } from 'orca/testing'
import { toProjectFields, MAX_VALUES } from '../worker/project-fields.mjs'

const pf = (name, type, over = {}) => ({ $type: 'X', canBeEmpty: true, field: { name, fieldType: { id: type } }, ...over })

test('project fields are read with their kind, whether they hold many values, and whether they are required', () => {
  const fields = toProjectFields([
    pf('Priority', 'enum[1]', { canBeEmpty: false, emptyFieldText: 'No priority', bundle: { values: [{ name: 'Major' }, { name: 'Old', archived: true }, { name: 'Minor' }] } }),
    pf('Stage', 'state[1]', { canBeEmpty: false, bundle: { values: [{ name: 'Open', isResolved: false }, { name: 'Done', isResolved: true }] } }),
    pf('Assignee', 'user[1]', { bundle: { aggregatedUsers: [{ login: 'jane', fullName: 'Jane Doe' }, { login: 'bob' }, { fullName: 'no login' }] } }),
    pf('Sprints', 'version[*]', { bundle: { values: [{ name: '1.0' }] } }),
    pf('Estimation', 'period'),
    pf('Component', 'ownedField[1]', { bundle: { values: [{ name: 'UI' }] } }),
    { field: { name: '' } }, null, 'junk'
  ])
  assert.deepEqual(fields, [
    { name: 'Priority', kind: 'enum', multi: false, required: true, emptyText: 'No priority', values: [{ name: 'Major' }, { name: 'Minor' }] },
    { name: 'Stage', kind: 'state', multi: false, required: true, values: [{ name: 'Open' }, { name: 'Done', resolved: true }] },
    { name: 'Assignee', kind: 'user', multi: false, required: false, values: [{ name: 'jane', label: 'Jane Doe' }, { name: 'bob' }] },
    { name: 'Sprints', kind: 'version', multi: true, required: false, values: [{ name: '1.0' }] },
    { name: 'Estimation', kind: 'other', multi: false, required: false, values: [] },
    { name: 'Component', kind: 'ownedField', multi: false, required: false, values: [{ name: 'UI' }] }
  ])
  assert.deepEqual(toProjectFields(null), [])
})

test('a long value list is cut and marked', () => {
  const many = Array.from({ length: MAX_VALUES + 10 }, (_, i) => ({ login: `u${i}` }))
  const [f] = toProjectFields([pf('Assignee', 'user[1]', { bundle: { aggregatedUsers: many } })])
  assert.equal(f.values.length, MAX_VALUES)
  assert.equal(f.valuesCut, true)
})
