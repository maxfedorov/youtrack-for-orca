// Pure mappers from youtrack CLI JSON to the plugin's UI models.
// Output is strict JSON: absent values are omitted, never set to undefined.

/** @typedef {{ name: string, color?: string }} Value */
/** @typedef {{ login: string, fullName: string }} User */
/** @typedef {{ id: string, author: User, created: number, textMd: string }} Comment */
/** @typedef {{ id: string, summary: string, state?: Value, priority?: Value, assignee?: User, updated: number, resolved: boolean, url: string }} IssueRow */
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
  return { login: v.login, fullName: v.fullName ?? v.login }
}

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
  /** @type {IssueRow} */
  const row = {
    id: raw.idReadable,
    summary: raw.summary,
    updated: raw.updated,
    resolved: raw.resolved != null,
    url: issueUrl(baseUrl, raw.idReadable)
  }
  const state = toValue(fieldValue(raw, 'State'))
  if (state) row.state = state
  const priority = toValue(fieldValue(raw, 'Priority'))
  if (priority) row.priority = priority
  const assignee = toUser(fieldValue(raw, 'Assignee'))
  if (assignee) row.assignee = assignee
  return row
}

/**
 * @param {any} rawView `issue view --json`
 * @param {any[] | null} rawComments `issue comment list --json`, or null
 * @param {string} baseUrl
 * @returns {IssueDetail}
 */
export function toIssueDetail(rawView, rawComments, baseUrl) {
  const comments = (rawComments ?? [])
    .map((c) => ({
      id: c.id,
      author: toUser(c.author) ?? { login: '', fullName: '' },
      created: c.created,
      textMd: c.text ?? ''
    }))
    .sort((a, b) => a.created - b.created)
  /** @type {IssueDetail} */
  const detail = {
    ...toIssueRow(rawView, baseUrl),
    project: {
      shortName: rawView.project?.shortName ?? '',
      name: rawView.project?.name ?? ''
    },
    descriptionMd: rawView.description ?? '',
    comments
  }
  const type = toValue(fieldValue(rawView, 'Type'))
  if (type) detail.type = type
  return detail
}

/** @param {any} raw @returns {{ id: string, name: string, query: string }} */
export function toSavedQuery(raw) {
  return { id: raw.id, name: raw.name, query: raw.query }
}

/** @param {any} raw item of `instance list --json` @returns {Server} */
export function toServer(raw) {
  return { alias: raw.alias, url: raw.url, active: raw.active, status: raw.status }
}
