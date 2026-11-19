// The custom fields of a YouTrack project: kind, required or not, and the values one can choose.
// Output is strict JSON: absent values are omitted, never set to undefined.

/** Values offered for one field at most; a larger bundle is cut and marked `valuesCut`. */
export const MAX_VALUES = 500
export const MAX_PROJECT_FIELDS = 100
/** Longest field name and value the plugin passes to the CLI. */
export const MAX_FIELD_NAME = 100
export const MAX_VALUE_NAME = 200

/** Field types whose values come from a list the plugin can offer. */
const LISTED = new Set(['enum', 'state', 'user', 'version', 'ownedField', 'build'])

const named = (v, max) => (typeof v === 'string' && v !== '' && v.length <= max ? v : null)

/** One value of a bundle; null when it cannot be offered (archived, no name). */
function toValue(v, kind) {
  if (!v || typeof v !== 'object' || v.archived === true) return null
  if (kind === 'user') {
    const login = named(v.login, MAX_VALUE_NAME)
    if (!login) return null
    return typeof v.fullName === 'string' && v.fullName && v.fullName !== login ? { name: login, label: v.fullName } : { name: login }
  }
  const name = named(v.name, MAX_VALUE_NAME)
  if (!name) return null
  return kind === 'state' && v.isResolved === true ? { name, resolved: true } : { name }
}

/** @param {any} raw the project's `customFields` with `field(name,fieldType(id))` and its bundle */
export function toProjectFields(raw) {
  const out = []
  for (const f of Array.isArray(raw) ? raw : []) {
    const name = named(f?.field?.name, MAX_FIELD_NAME)
    if (!name || out.length >= MAX_PROJECT_FIELDS) continue
    const type = typeof f.field.fieldType?.id === 'string' ? f.field.fieldType.id : ''
    const base = type.replace(/\[[1*]\]$/, '')
    const kind = LISTED.has(base) ? base : 'other'
    const source = kind === 'user' ? f.bundle?.aggregatedUsers : kind === 'other' ? [] : f.bundle?.values
    const all = (Array.isArray(source) ? source : []).map((v) => toValue(v, kind)).filter(Boolean)
    const field = { name, kind, multi: type.endsWith('[*]'), required: f.canBeEmpty === false }
    if (typeof f.emptyFieldText === 'string' && f.emptyFieldText) field.emptyText = f.emptyFieldText.slice(0, MAX_VALUE_NAME)
    field.values = all.slice(0, MAX_VALUES)
    if (all.length > MAX_VALUES) field.valuesCut = true
    out.push(field)
  }
  return out
}

/** A field whose value the panel can change: one value from the project's list. */
export const pickable = (field) => field.kind !== 'other' && !field.multi
