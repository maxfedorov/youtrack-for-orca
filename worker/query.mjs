// Sorting the issue list by rewriting the `sort by:` clause of the query.

/** Column id → YouTrack field name used in `sort by:`. */
export const SORT_FIELDS = {
  id: '{issue id}',
  summary: 'summary',
  state: 'State',
  priority: 'Priority',
  assignee: 'Assignee',
  updated: 'updated',
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
  // Only the first clause matters once the rest is dropped; use the last as the effective one.
  const clauses = String(query).slice(idx).split(/(?=\bsort\s+by\s*:)/i)
  const m = PARSE.exec(clauses[clauses.length - 1])
  if (!m) return null
  const field = norm(m[1])
  const column = Object.keys(SORT_FIELDS).find((k) => norm(SORT_FIELDS[k]) === field)
  if (!column) return null
  return { column, direction: /** @type {'asc' | 'desc'} */ ((m[2] || 'asc').toLowerCase()) }
}

/**
 * @param {string} query
 * @param {string} column key of SORT_FIELDS
 * @returns {string}
 */
export function applySort(query, column) {
  const field = SORT_FIELDS[/** @type {keyof typeof SORT_FIELDS} */ (column)]
  if (!field) throw new Error(`Unknown sort column: ${column}`)
  const current = parseSort(query)
  const direction = current && current.column === column && current.direction === 'asc' ? 'desc' : 'asc'
  const base = String(query ?? '').replace(CLAUSE, '').trim()
  return `${base ? base + ' ' : ''}sort by: ${field} ${direction}`
}
