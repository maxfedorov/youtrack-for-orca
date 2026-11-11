// Sorting the issue list by rewriting the `sort by:` clause of the query.

/** Column id → YouTrack field name used in `sort by:`, for the columns every list has. */
export const SORT_FIELDS = {
  id: '{issue id}',
  summary: 'summary',
  created: 'created',
  updated: 'updated',
}

/** The fields shown as columns when the setting names none. */
export const DEFAULT_COLUMNS = 'State, Priority, Assignee'
/** Columns of custom fields at most, and the longest field name. */
export const MAX_COLUMNS = 8
const MAX_COLUMN_NAME = 60

/** The column key of a custom field: `field:` and its name in lower case. */
export const columnKey = (name) => `field:${norm(name)}`

/**
 * The custom fields the columns setting names, in its order: trimmed, each once, without the columns
 * every list has, at most MAX_COLUMNS. Names a project lacks stay; their columns are left out when empty.
 * @param {unknown} setting comma-separated field names
 * @returns {string[]}
 */
export function parseColumns(setting) {
  const raw = typeof setting === 'string' ? setting : DEFAULT_COLUMNS
  const fixed = new Set(['id', 'issue id', 'summary', 'created', 'updated'])
  const seen = new Set()
  const out = []
  for (const part of raw.split(',')) {
    const name = part.trim().replace(/\s+/g, ' ')
    const key = norm(name)
    if (!name || name.length > MAX_COLUMN_NAME || /[{}]/.test(name) || fixed.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length === MAX_COLUMNS) break
  }
  return out
}

const CLAUSE = /\bsort\s+by\s*:.*$/is
const PARSE = /\bsort\s+by\s*:\s*(\{[^}]*\}|.*?)\s*(asc|desc)?\s*$/is

const norm = (s) => s.replace(/^\{|\}$/g, '').trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * @param {string} query
 * @returns {{ column: string, direction: 'asc' | 'desc' } | null}
 */
export function parseSort(query) {
  const idx = String(query ?? '').search(/\bsort\s+by\s*:/i)
  if (idx < 0) return null
  // With several clauses the last one is the effective one; applySort drops all of them.
  const clauses = String(query).slice(idx).split(/(?=\bsort\s+by\s*:)/i)
  const m = PARSE.exec(clauses[clauses.length - 1])
  if (!m) return null
  const field = norm(m[1])
  if (!field) return null
  // A field that is not one of the fixed columns is a custom field's column.
  const column = Object.keys(SORT_FIELDS).find((k) => norm(SORT_FIELDS[k]) === field) ?? columnKey(field)
  return { column, direction: /** @type {'asc' | 'desc'} */ ((m[2] || 'asc').toLowerCase()) }
}

/**
 * @param {string} query
 * @param {string} column key of SORT_FIELDS, or a custom field's column key
 * @param {string} [name] the custom field's name as written in the setting
 * @returns {string}
 */
export function applySort(query, column, name) {
  const custom = column.startsWith('field:') ? (name ?? column.slice('field:'.length)) : null
  const field = custom ? (/\s/.test(custom) ? `{${custom}}` : custom) : SORT_FIELDS[/** @type {keyof typeof SORT_FIELDS} */ (column)]
  if (!field) throw new Error(`Unknown sort column: ${column}`)
  const current = parseSort(query)
  const direction = current && current.column === column && current.direction === 'asc' ? 'desc' : 'asc'
  const base = String(query ?? '').replace(CLAUSE, '').trim()
  return `${base ? base + ' ' : ''}sort by: ${field} ${direction}`
}
