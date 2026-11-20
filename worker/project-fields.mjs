// Custom fields of an issue (or a draft): their kind (a list, a typed-in value, or another), whether
// they are required, and the values one can choose, read without admin rights: the kind from the issue's own field, the values from the
// CLI's `issue field list-values` (the issue's field context, so only what this user may pick).
// Output is strict JSON: absent values are omitted, never set to undefined.

/** Values asked for one field; a full page means there may be more (`cut`). */
export const MAX_VALUES = 500
/** Longest field name and value the plugin passes to the CLI. */
export const MAX_FIELD_NAME = 100
export const MAX_VALUE_NAME = 200

/** Field types whose values come from a list the plugin can offer. */
const LISTED = new Set(['enum', 'state', 'user', 'version', 'ownedField', 'build'])
/** Field types whose value is typed in, with the CLI's `--type` for each. */
export const TYPED = Object.freeze({ string: 'string', integer: 'int', period: 'period' })
const kindOf = (type) => (LISTED.has(type) || type in TYPED ? type : 'other')

const named = (v, max) => (typeof v === 'string' && v !== '' && v.length <= max ? v : null)

/** Kind, multi and required of one `customFields` entry with `projectCustomField(canBeEmpty,field(fieldType(id)))`. */
export function toFieldMeta(f) {
  const type = typeof f?.projectCustomField?.field?.fieldType?.id === 'string' ? f.projectCustomField.field.fieldType.id : ''
  const base = type.replace(/\[[1*]\]$/, '')
  return { kind: kindOf(base), multi: type.endsWith('[*]'), required: f?.projectCustomField?.canBeEmpty === false }
}

/** Kind, multi and required of one entry of `issue field list`. */
export function toListedMeta(f) {
  const type = typeof f?.valueType === 'string' ? f.valueType : ''
  return { kind: kindOf(type), multi: f?.multiValue === true, required: f?.required === true }
}

/** A field whose value the panel can change: one value from a list. */
export const pickable = (meta) => LISTED.has(meta.kind) && !meta.multi

/** A field whose value the panel can change by typing it: one string, whole number or period. */
export const typed = (meta) => meta.kind in TYPED && !meta.multi

/** The values of `issue field list-values`: users by login (with their name), the rest by name. */
export function toValues(raw, limit) {
  const list = Array.isArray(raw) ? raw : []
  const values = []
  for (const v of list) {
    if (!v || typeof v !== 'object' || v.archived === true || v.banned === true) continue
    const login = named(v.login, MAX_VALUE_NAME)
    if (login) {
      values.push(typeof v.fullName === 'string' && v.fullName && v.fullName !== login ? { name: login, label: v.fullName.slice(0, MAX_VALUE_NAME) } : { name: login })
      continue
    }
    const name = named(v.name, MAX_VALUE_NAME)
    if (name) values.push({ name })
  }
  return { values, cut: list.length >= limit }
}
