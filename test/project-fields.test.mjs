import { test, assert } from 'orca/testing'
import { toFieldMeta, toValues, pickable, typed, MAX_VALUES } from '../worker/project-fields.mjs'

const cf = (type, canBeEmpty) => ({ projectCustomField: { canBeEmpty, field: { fieldType: { id: type } } } })

test('a field of an issue is read with its kind, whether it holds many values, and whether it is required', () => {
  assert.deepEqual(toFieldMeta(cf('enum[1]', false)), { kind: 'enum', multi: false, required: true })
  assert.deepEqual(toFieldMeta(cf('state[1]', false)), { kind: 'state', multi: false, required: true })
  assert.deepEqual(toFieldMeta(cf('user[1]', true)), { kind: 'user', multi: false, required: false })
  assert.deepEqual(toFieldMeta(cf('version[*]', true)), { kind: 'version', multi: true, required: false })
  assert.deepEqual(toFieldMeta(cf('ownedField[1]', true)), { kind: 'ownedField', multi: false, required: false })
  assert.deepEqual(toFieldMeta(cf('period', true)), { kind: 'period', multi: false, required: false })
  assert.deepEqual(toFieldMeta(cf('string[1]', false)), { kind: 'string', multi: false, required: true })
  assert.deepEqual(toFieldMeta(cf('integer', true)), { kind: 'integer', multi: false, required: false })
  for (const t of ['text', 'float', 'date', 'date and time']) assert.equal(toFieldMeta(cf(t, true)).kind, 'other', t)
  assert.equal(typed({ kind: 'integer', multi: false }), true)
  assert.equal(typed({ kind: 'enum', multi: false }), false)
  assert.equal(pickable({ kind: 'string', multi: false }), false)
  assert.deepEqual(toFieldMeta({}), { kind: 'other', multi: false, required: false })
  assert.deepEqual(toFieldMeta(null), { kind: 'other', multi: false, required: false })
  assert.equal(pickable({ kind: 'enum', multi: false }), true)
  assert.equal(pickable({ kind: 'version', multi: true }), false)
  assert.equal(pickable({ kind: 'other', multi: false }), false)
})

test('the values of list-values are read by name, users by login with their name', () => {
  const r = toValues([
    { name: 'Major' }, { name: 'Old', archived: true }, { login: 'jane', fullName: 'Jane Doe', name: 'jane' }, { login: 'gone', banned: true },
    { login: 'bob', name: 'bob' }, { name: '' }, null, 'junk', { name: 'x'.repeat(201) }
  ], 50)
  assert.deepEqual(r, { values: [{ name: 'Major' }, { name: 'jane', label: 'Jane Doe' }, { name: 'bob' }], cut: false })
  assert.deepEqual(toValues(null, 50), { values: [], cut: false })
})

test('a full page of values means there may be more', () => {
  const page = Array.from({ length: MAX_VALUES }, (_, i) => ({ name: `V${i}` }))
  assert.equal(toValues(page, MAX_VALUES).cut, true)
  assert.equal(toValues(page.slice(1), MAX_VALUES).cut, false)
})
