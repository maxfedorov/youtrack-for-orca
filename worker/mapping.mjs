// Pure mappers from youtrack CLI JSON to the plugin's UI models.
// Output is strict JSON: absent values are omitted, never set to undefined.

/** @typedef {{ name: string, color?: string }} Value */
/** @typedef {{ login: string, fullName: string }} User */
/** @typedef {{ id: string, author: User, created: number, textMd: string }} Comment */
/** @typedef {{ id: string, summary: string, state?: Value, priority?: Value, assignee?: User, created: number, updated: number, resolved: boolean, url: string }} IssueRow */
/** @typedef {IssueRow & { project: { shortName: string, name: string }, type?: Value, descriptionMd: string, comments: Comment[] }} IssueDetail */
/** @typedef {{ alias: string, url: string, active: boolean, status: string }} Server */

/** @param {any} raw @param {string} name */
function fieldValue(raw, name) {
  const fields = Array.isArray(raw?.customFields) ? raw.customFields : []
  const f = fields.find((x) => x?.name === name)
  return f?.value ?? null
}

/** @param {any} v @returns {Value | undefined} */
function toValue(v) {
  if (v == null || typeof v.name !== 'string') return undefined
  /** @type {Value} */
  const out = { name: v.name }
  if (typeof v.color === 'string') out.color = v.color
  return out
}

/** @param {any} v @returns {User | undefined} */
function toUser(v) {
  if (v == null || typeof v.login !== 'string') return undefined
  return { login: v.login, fullName: typeof v.fullName === 'string' ? v.fullName : v.login }
}

const text = (v) => (v == null ? '' : String(v))
const count = (v) => Number(v) || 0

/** @param {string} baseUrl @param {string} id */
function issueUrl(baseUrl, id) {
  return baseUrl.replace(/\/+$/, '') + '/issue/' + id
}

/**
 * @param {any} raw one item of `issue list --json`
 * @param {string} baseUrl
 * @returns {IssueRow}
 */
export function toIssueRow(raw, baseUrl) {
  const id = text(raw?.idReadable)
  /** @type {IssueRow} */
  const row = {
    id,
    summary: text(raw?.summary),
    created: count(raw?.created),
    updated: count(raw?.updated),
    resolved: raw?.resolved != null,
    url: issueUrl(baseUrl, id)
  }
  const state = toValue(fieldValue(raw, 'State'))
  if (state) row.state = state
  const priority = toValue(fieldValue(raw, 'Priority'))
  if (priority) row.priority = priority
  const assignee = toUser(fieldValue(raw, 'Assignee'))
  if (assignee) row.assignee = assignee
  return row
}

const EMPTY = '\u2014'
const MAX_FIELDS = 100
const MAX_FIELD_VALUE = 1000

/** @param {string} v */
const clip = (v) => (v.length <= MAX_FIELD_VALUE ? v : v.slice(0, MAX_FIELD_VALUE - 1).replace(/[\ud800-\udbff]$/, '') + '\u2026')

/** Readable text of one value of a custom field; '' when there is nothing to show. @param {any} v @param {string} type */
function fieldText(v, type) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map((x) => fieldText(x, type)).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    for (const key of ['presentation', 'text', 'fullName', 'name', 'login']) {
      if (typeof v[key] === 'string' && v[key] !== '') return v[key]
    }
    return ''
  }
  if (typeof v === 'number' && /^Date/.test(type) && Number.isFinite(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, type.startsWith('DateTime') ? 16 : 10).replace('T', ' ')
  }
  return String(v)
}

/** All custom fields of an issue as display strings, in YouTrack order. @param {any} raw @returns {{ name: string, value: string }[]} */
function toFields(raw) {
  const list = Array.isArray(raw?.customFields) ? raw.customFields : []
  return list
    .filter((f) => typeof f?.name === 'string' && f.name !== '')
    .slice(0, MAX_FIELDS)
    .map((f) => {
      const shown = fieldText(f.value, text(f.$type).replace(/^(Single|Multi)/, ''))
      const empty = f.projectCustomField?.emptyFieldText
      return { name: f.name, value: clip(shown || (typeof empty === 'string' && empty ? empty : EMPTY)) }
    })
}

/**
 * @param {any} rawView `issue view --json`
 * @param {any[] | null} rawComments `issue comment list --json`, or null
 * @param {string} baseUrl
 * @returns {IssueDetail}
 */
export function toIssueDetail(rawView, rawComments, baseUrl) {
  const comments = (Array.isArray(rawComments) ? rawComments : [])
    .filter((c) => c && c.deleted !== true)
    .map((c) => ({
      id: text(c.id),
      author: toUser(c.author) ?? { login: '', fullName: '' },
      created: count(c.created),
      textMd: text(c.text)
    }))
    .sort((a, b) => a.created - b.created)
  /** @type {IssueDetail} */
  const detail = {
    ...toIssueRow(rawView, baseUrl),
    fields: toFields(rawView),
    project: {
      shortName: text(rawView.project?.shortName),
      name: text(rawView.project?.name)
    },
    descriptionMd: text(rawView.description),
    comments
  }
  const type = toValue(fieldValue(rawView, 'Type'))
  if (type) detail.type = type
  return detail
}

/** @param {any} raw @returns {{ id: string, name: string, query: string } | null} null when there is no query */
export function toSavedQuery(raw) {
  if (typeof raw?.query !== 'string') return null
  return { id: text(raw.id), name: text(raw.name), query: raw.query }
}

/** Saved searches that can be offered: a query, an id and a name. @param {any} list `search list --json` */
export const toSavedQueries = (list) =>
  (Array.isArray(list) ? list : []).map(toSavedQuery).filter((q) => q !== null && q.id !== '' && q.name !== '')

/** @param {any} raw item of `instance list --json` @returns {Server} */
export function toServer(raw) {
  return {
    alias: text(raw?.alias),
    url: text(raw?.url),
    active: raw?.active === true,
    status: typeof raw?.status === 'string' && raw.status ? raw.status : 'unknown'
  }
}

/** Servers of `instance list --json`; entries without an alias are dropped. @param {any} list @returns {Server[]} */
export const toServers = (list) => (Array.isArray(list) ? list : []).map(toServer).filter((s) => s.alias !== '')
