/** Requests about servers, issues and saved queries (everything answered by the YouTrack CLI). */
import { ok, fail, CODES } from '../result.mjs'
import { customFields, parseColumns } from '../query.mjs'
import { toValues, pickable, typed, TYPED, MAX_FIELD_NAME, MAX_VALUE_NAME, MAX_VALUES } from '../project-fields.mjs'
import { toListedFields, toIssueRow, toIssueDetail, toComments, toLinks, toSavedQuery, toSavedQueries, toServers } from '../mapping.mjs'
import { safeHandle, safePost, shortMessage, unexpected, hasId, invalid, ISSUE_ID, MAX_QUERY, MAX_NAME, MAX_COMMAND, MAX_NEW_COMMENT, MAX_SUMMARY, MAX_NEW_DESCRIPTION, isPlainUrl, normalizeUrl, settingString, capDetail, attempt, fallback, readSetting, INSTALL } from './common.mjs'

const MAX_LIMIT = 50
/** A YouTrack project short name, as it starts an issue id. */
export const PROJECT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
/** A draft's opaque id, such as 3-41 (drafts have no readable id). */
const DRAFT_ID = /^\d{1,9}-\d{1,12}$/
const projectOf = (id) => id.slice(0, id.lastIndexOf('-'))
/** Fields set when an issue is created, at most. */
const MAX_NEW_FIELDS = 20
/** Longest tag name the panel removes. */
const MAX_TAG = 200
/** Longest value typed into a string, number or period field. */
const MAX_TYPED = 1000
/** A whole number the CLI reads (64 bits). */
const WHOLE = /^-?\d{1,18}$/
/** A YouTrack period: weeks, days, hours and minutes, such as `1w 2d 3h 30m`. */
const PERIOD = /^\s*(\d{1,6}\s*[wdhm]\s*)+$/i
/** Saved searches shown as quick views per server, and the shape of a saved search id. */
const MAX_QUICK_VIEWS = 12
const SAVED_SEARCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** The summary trimmed, or the reason it cannot be used. */
function checkSummary(summary) {
  const text = typeof summary === 'string' ? summary.trim() : ''
  if (!text) return { error: 'Enter a summary' }
  if (/[\r\n]/.test(text)) return { error: 'A summary is one line' }
  if (text.length > MAX_SUMMARY) return { error: `A summary is at most ${MAX_SUMMARY} characters` }
  return { text }
}
const MAX_WINDOW = 500
const COMMENTS_FAILED = 'Comments could not be loaded.'
const TOKEN_KEPT = 'The server was removed, but its sign-in token may still be stored in the system keyring:'
const NOT_FORGOTTEN = 'The server was removed, but the plugin could not forget all of its saved searches, links and projects.'
/** Table rows need unique keys; the first row of an id wins. */
const unique = (rows) => rows.filter((r, i) => rows.findIndex((o) => o.idReadable === r.idReadable) === i)

const LINKS_FAILED = 'Linked issues could not be loaded.'
/** Linked issues shown at most; a summary is cut to a line. */
const MAX_LINKED = 100
const MAX_LINKED_SUMMARY = 200

function capLinks(links) {
  let room = MAX_LINKED
  const out = []
  for (const link of links) {
    if (room <= 0) break
    const issues = link.issues.slice(0, room).map((i) => ({ ...i, summary: i.summary.slice(0, MAX_LINKED_SUMMARY) }))
    room -= issues.length
    out.push({ ...link, issues })
  }
  return out
}

export function registerYoutrackHandlers(ctx) {
  const { orca, orcaCli, state, links, launches, resolveServer } = ctx
  const handle = (name, fn) => safeHandle(orca, name, fn)

  handle('yt.env', async () => {
    const defaultQuery = settingString(await readSetting(orca, 'defaultQuery'), '')
    const base = { orcaCli: { found: orcaCli != null }, query: defaultQuery, defaultQuery }
    const installCommand = INSTALL[ctx.platform]
    const withInstall = (cli) => (installCommand ? { ...cli, installCommand } : cli)
    const notFound = () => ok({ cli: withInstall({ found: false }), servers: [], server: null, ...base })
    await ctx.refreshYoutrack()
    const youtrack = ctx.youtrack
    if (!youtrack) return notFound()
    // Version, server list and stored choices are separate parts: only the server list is required.
    const [version, inst] = await Promise.all([attempt(() => youtrack.version()), attempt(() => youtrack.instances())])
    if (!inst.ok) {
      if (inst.error.code === CODES.CLI_NOT_FOUND) {
        await ctx.refreshYoutrack()
        return notFound()
      }
      return ok({ ...base, cli: withInstall({ found: true }), servers: [], server: null, error: shortMessage(inst.error.message) })
    }
    const servers = toServers(inst.data)
    const stored = await fallback(() => state.getServer(), null)
    const chosen = servers.find((s) => s.alias === stored) ?? servers.find((s) => s.active) ?? servers[0]
    const cli = withInstall({ found: true })
    if (version.ok) cli.version = version.data
    const server = chosen ? chosen.alias : null
    return ok({ ...base, cli, servers, server, query: server ? await fallback(() => state.getQuery(server, defaultQuery), defaultQuery) : defaultQuery })
  })

  handle('yt.setServer', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setServer(s.data.alias)
    return ok({})
  })

  handle('yt.setQuery', async ({ server, query }) => {
    if (typeof query !== 'string' || query.length > MAX_QUERY) return invalid('Invalid query')
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setQuery(s.data.alias, query)
    return ok({})
  })

  handle('yt.issues.search', async ({ server, query, offset, limit }) => {
    if (typeof query !== 'string' || query.length > MAX_QUERY) return invalid('Invalid query')
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return invalid('Invalid paging')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const room = MAX_WINDOW - offset
    if (room <= 0) return ok({ issues: [], hasMore: false })
    const size = Math.min(limit, MAX_LIMIT, room)
    const columns = parseColumns(await readSetting(orca, 'columns'))
    const fields = customFields(columns)
    // The count is optional: without it the panel shows "N+ issues".
    const [list, count] = await Promise.all([
      ctx.youtrack.listIssues(s.data.alias, query, offset, Math.min(size + 1, room), fields),
      offset === 0 ? attempt(() => ctx.youtrack.countIssues(s.data.alias, query)) : Promise.resolve(null)
    ])
    if (!list.ok) return list
    if (!Array.isArray(list.data)) return unexpected()
    const data = {
      issues: unique(list.data.slice(0, size).filter(hasId)).map((r) => toIssueRow(r, s.data.url, fields)),
      hasMore: list.data.length > size,
      columns
    }
    if (count?.ok) data.total = count.data
    return ok(data)
  })

  handle('yt.issue.get', async ({ server, id }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const [view, comments, links] = await Promise.all([
      attempt(() => ctx.youtrack.viewIssue(s.data.alias, id)),
      attempt(() => ctx.youtrack.listComments(s.data.alias, id)),
      attempt(() => ctx.youtrack.listLinks(s.data.alias, id))
    ])
    if (!view.ok) return view
    if (!hasId(view.data)) return unexpected()
    // The issue is shown without its comments or links when only they fail; the panel can load comments again.
    const loaded = comments.ok && Array.isArray(comments.data)
    const issue = toIssueDetail(view.data, loaded ? comments.data : null, s.data.url)
    if (links.ok && Array.isArray(links.data)) issue.links = capLinks(toLinks(links.data))
    else issue.linksError = LINKS_FAILED
    const detail = capDetail(issue)
    return ok(loaded ? detail : { ...detail, commentsError: COMMENTS_FAILED })
  })

  handle('yt.issue.comments', async ({ server, id }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await attempt(() => ctx.youtrack.listComments(s.data.alias, id))
    if (!r.ok) return r
    if (!Array.isArray(r.data)) return unexpected()
    const capped = capDetail({ descriptionMd: '', comments: toComments(r.data) })
    const data = { comments: capped.comments }
    if (capped.commentsOmitted) data.commentsOmitted = capped.commentsOmitted
    if (capped.truncated) data.truncated = true
    return ok(data)
  })

  // Issue writes: run only when the person presses Apply or Send.
  handle('yt.issue.command', async ({ server, id, command }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const text = typeof command === 'string' ? command.trim() : ''
    if (!text) return invalid('Enter a command')
    if (text.length > MAX_COMMAND) return invalid(`A command is at most ${MAX_COMMAND} characters`)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.applyCommand(s.data.alias, id, text)
    return r.ok ? ok({}) : r
  })

  handle('yt.issue.comment', async ({ server, id, text }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return invalid('Enter a comment')
    if (body.length > MAX_NEW_COMMENT) return invalid(`A comment is at most ${MAX_NEW_COMMENT} characters`)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.addComment(s.data.alias, id, body)
    return r.ok ? ok({}) : r
  })

  // Runs only when the cross of a tag is pressed.
  handle('yt.issue.removeTag', async ({ server, id, tag }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    if (typeof tag !== 'string' || !tag.trim() || tag.length > MAX_TAG || /[\r\n]/.test(tag)) return invalid('Invalid tag')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.removeTag(s.data.alias, id, tag)
    return r.ok ? ok({}) : r
  })

  // Writes skill files into the coding agents' folders: runs only when the button is pressed.
  handle('yt.skill.install', async () => {
    if (!ctx.youtrack) return fail(CODES.CLI_NOT_FOUND, 'The YouTrack CLI was not found.')
    return ctx.youtrack.updateSkill()
  })

  handle('yt.projects', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.listProjects(s.data.alias)
    return r.ok ? ok({ projects: r.data }) : r
  })

  /** The fields of an issue or draft: value as shown, kind, whether required, in YouTrack order. */
  async function fieldsOf(alias, id) {
    const r = await ctx.youtrack.issueFields(alias, id)
    if (!r.ok) return r
    if (!Array.isArray(r.data)) return unexpected()
    return ok(toListedFields(r.data).filter((f) => f.name.length <= MAX_FIELD_NAME))
  }

  /** Checks a value typed into a field: one line of text, a whole number, or a period such as `1w 2d 3h 30m`. */
  function checkTyped(field, value) {
    if (value === null) return field.required ? invalid(`${field.name} cannot be empty`) : ok(field)
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_TYPED || /[\r\n]/.test(value)) return invalid('Invalid value')
    if (field.kind === 'integer' && !WHOLE.test(value)) return invalid(`${field.name} takes a whole number`)
    if (field.kind === 'period' && !PERIOD.test(value)) return invalid(`${field.name} takes a period such as 1w 2d 3h 30m`)
    return ok(field)
  }

  /** Checks a field name and value for a write: the field takes one value from a list, and the value is one it offers. */
  async function checkValue(alias, id, fields, name, value) {
    const field = fields.find((f) => f.name === name)
    if (field && typed(field)) return checkTyped(field, value)
    if (!field || !pickable(field)) return invalid(`${name} cannot be changed here. Use a command.`)
    if (value === null) return field.required ? invalid(`${name} cannot be empty`) : ok(field)
    if (typeof value !== 'string' || !value || value.length > MAX_VALUE_NAME) return invalid('Invalid value')
    const values = await ctx.youtrack.fieldValues(alias, id, name)
    if (!values.ok) return values
    return toValues(values.data, MAX_VALUES).values.some((v) => v.name === value) ? ok(field) : invalid(`${value} is not a value of ${name}`)
  }

  handle('yt.issue.fieldValues', async ({ server, id, field }) => {
    if (typeof id !== 'string' || !(ISSUE_ID.test(id) || DRAFT_ID.test(id))) return invalid('Invalid issue id')
    if (typeof field !== 'string' || !field || field.length > MAX_FIELD_NAME) return invalid('Invalid field')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.fieldValues(s.data.alias, id, field)
    return r.ok ? ok(toValues(r.data, MAX_VALUES)) : r
  })

  // Runs only when a value is chosen in the panel; the value must be one the field offers.
  handle('yt.issue.setField', async ({ server, id, field, value }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    if (typeof field !== 'string' || !field || field.length > MAX_FIELD_NAME) return invalid('Invalid field')
    if (value !== null && typeof value !== 'string') return invalid('Invalid value')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const fields = await fieldsOf(s.data.alias, id)
    if (!fields.ok) return fields
    const checked = await checkValue(s.data.alias, id, fields.data, field, value)
    if (!checked.ok) return checked
    const kind = checked.data.kind
    const how = value === null ? { clear: true } : kind === 'user' ? { value, user: true } : typed(checked.data) ? { value, type: TYPED[kind] } : { value }
    const r = await ctx.youtrack.setField(s.data.alias, id, field, how)
    return r.ok ? ok({}) : r
  })

  /**
   * The draft the new-issue form fills for a project, and its fields. The draft of an earlier form is
   * reused while it still exists. Starting one is a write (YouTrack keeps the user's drafts), so it runs
   * only when the form opens or another project is chosen.
   */
  handle('yt.issue.draft', async ({ server, project }) => {
    if (typeof project !== 'string' || !PROJECT.test(project)) return invalid('Invalid project')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const alias = s.data.alias
    const stored = await fallback(() => ctx.drafts.get(alias, project), null)
    if (stored) {
      const fields = await fieldsOf(alias, stored)
      if (fields.ok) return ok({ draftId: stored, fields: fields.data })
      await fallback(() => ctx.drafts.forget(alias, stored), null)
    }
    const made = await ctx.youtrack.draftCreate(alias, project)
    if (!made.ok) return made.error.code === CODES.FORBIDDEN ? fail(CODES.FORBIDDEN, `You cannot create issues in ${project}.`) : made
    await fallback(() => ctx.drafts.set(alias, project, made.data.id), null)
    const fields = await fieldsOf(alias, made.data.id)
    return fields.ok ? ok({ draftId: made.data.id, fields: fields.data }) : fields
  })

  // Runs only when Create is pressed: fills the plugin's own draft, then submits it as the new issue.
  handle('yt.issue.create', async ({ server, draftId, summary, description = '', fields = {} }) => {
    if (typeof draftId !== 'string' || !DRAFT_ID.test(draftId)) return invalid('Invalid draft')
    const checked = checkSummary(summary)
    if (checked.error) return invalid(checked.error)
    if (typeof description !== 'string' || description.length > MAX_NEW_DESCRIPTION) return invalid(`A description is at most ${MAX_NEW_DESCRIPTION} characters`)
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return invalid('Invalid fields')
    const entries = Object.entries(fields)
    if (entries.length > MAX_NEW_FIELDS) return invalid(`At most ${MAX_NEW_FIELDS} fields can be set`)
    const s = await resolveServer(server)
    if (!s.ok) return s
    const alias = s.data.alias
    if (!(await fallback(() => ctx.drafts.has(alias, draftId), false))) return fail(CODES.NOT_FOUND, 'This form is out of date. Open New issue again.')
    if (entries.length > 0) {
      const known = await fieldsOf(alias, draftId)
      if (!known.ok) return known
      for (const [name, value] of entries) {
        // The new-issue form offers only fields set from a list.
        if (known.data.some((f) => f.name === name && typed(f))) return invalid(`${name} cannot be set here. Set it after creating the issue.`)
        const v = await checkValue(alias, draftId, known.data, name, value)
        if (!v.ok) return v
      }
    }
    const filled = await ctx.youtrack.draftUpdate(alias, draftId, { summary: checked.text, description, fields: Object.fromEntries(entries) })
    if (!filled.ok) return filled
    const r = await ctx.youtrack.draftSubmit(alias, draftId)
    if (!r.ok) return r
    await fallback(() => ctx.drafts.forget(alias, draftId), null)
    return ok({ id: r.data.id })
  })

  // Back from the form, or another project: the form's draft is deleted. Only the plugin's own drafts.
  handle('yt.issue.draft.discard', async ({ server, draftId }) => {
    if (typeof draftId !== 'string' || !DRAFT_ID.test(draftId)) return invalid('Invalid draft')
    const s = await resolveServer(server)
    if (!s.ok) return s
    if (!(await fallback(() => ctx.drafts.has(s.data.alias, draftId), false))) return ok({})
    const r = await ctx.youtrack.draftDelete(s.data.alias, draftId)
    if (r.ok || r.error.code === CODES.NOT_FOUND) await fallback(() => ctx.drafts.forget(s.data.alias, draftId), null)
    return r.ok ? ok({}) : r
  })

  handle('yt.issue.update', async ({ server, id, summary, description }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    if (summary === undefined && description === undefined) return invalid('Nothing to change')
    const change = {}
    if (summary !== undefined) {
      const checked = checkSummary(summary)
      if (checked.error) return invalid(checked.error)
      change.summary = checked.text
    }
    if (description !== undefined) {
      if (typeof description !== 'string') return invalid('Invalid description')
      if (description.length > MAX_NEW_DESCRIPTION) return invalid(`A description is at most ${MAX_NEW_DESCRIPTION} characters`)
      change.description = description
    }
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.updateIssue(s.data.alias, id, change)
    return r.ok ? ok({}) : r
  })

  handle('yt.savedQueries', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.savedSearches(s.data.alias)
    return r.ok ? ok(toSavedQueries(r.data)) : r
  })

  handle('yt.quickViews', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    return ok({ ids: (await state.quickViews(s.data.alias)).filter((id) => SAVED_SEARCH_ID.test(id)).slice(0, MAX_QUICK_VIEWS) })
  })

  handle('yt.quickViews.set', async ({ server, ids }) => {
    if (!Array.isArray(ids) || ids.length > MAX_QUICK_VIEWS) return invalid(`Up to ${MAX_QUICK_VIEWS} saved searches can be quick views`)
    if (!ids.every((id) => typeof id === 'string' && SAVED_SEARCH_ID.test(id))) return invalid('Invalid saved search')
    const s = await resolveServer(server)
    if (!s.ok) return s
    await state.setQuickViews(s.data.alias, ids)
    return ok({ ids: await state.quickViews(s.data.alias) })
  })

  handle('yt.savedQueries.create', async ({ server, name, query }) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n || n.length > MAX_NAME) return invalid(`Name must be 1 to ${MAX_NAME} characters`)
    if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY) return invalid('Invalid query')
    const s = await resolveServer(server)
    if (!s.ok) return s
    const r = await ctx.youtrack.createSavedSearch(s.data.alias, n, query)
    return r.ok ? ok(toSavedQuery(r.data) ?? { id: '', name: n, query }) : r
  })

  handle('yt.servers.add', async ({ url }) => {
    if (!isPlainUrl(url)) return invalid('Enter a server address like https://youtrack.example.com')
    if (!ctx.youtrack) return fail(CODES.CLI_NOT_FOUND, 'The YouTrack CLI was not found.')
    login(url)
      .catch((e) => fail(CODES.UNKNOWN, e instanceof Error ? e.message : String(e)))
      .then((result) => safePost(orca, 'yt.servers.added', result))
    return ok({ started: true })
  })

  // Signs the CLI out of the server: run only after the person confirmed it in the panel.
  handle('yt.servers.remove', async ({ server }) => {
    if (typeof server !== 'string' || !server) return invalid('Unknown server')
    if (!ctx.youtrack) return fail(CODES.CLI_NOT_FOUND, 'The YouTrack CLI was not found.')
    const inst = await ctx.youtrack.instances()
    if (!inst.ok) return inst
    const warnings = []
    // A server the CLI no longer lists was removed already (say, a removal that timed out after the
    // CLI finished): only what the plugin saved for it is left to forget.
    if (toServers(inst.data).some((s) => s.alias === server)) {
      const r = await ctx.youtrack.deleteInstance(server)
      if (!r.ok) return r
      if (typeof r.data?.warning === 'string' && r.data.warning) warnings.push(`${TOKEN_KEPT} ${r.data.warning}`)
    }
    // Each store is cleared on its own; a failure only warns.
    const cleared = await Promise.all(
      [() => state.forgetServer(server), () => links?.dropServer(server), () => launches?.dropServer(server)].map((fn) =>
        fallback(async () => (await fn(), true), false)
      )
    )
    if (!cleared.every(Boolean)) warnings.push(NOT_FORGOTTEN)
    return ok(warnings.length ? { warning: shortMessage(warnings.join(' ')) } : {})
  })

  /** Sign in through the browser, then find the alias the CLI gave the new server. */
  async function login(url) {
    const r = await ctx.youtrack.loginWeb(url, (authUrl) => safePost(orca, 'yt.servers.authUrl', { url: authUrl }))
    if (!r.ok) return r
    const inst = await ctx.youtrack.instances()
    if (!inst.ok) return inst
    const found = toServers(inst.data).find((i) => normalizeUrl(i.url) === normalizeUrl(url))
    return found ? ok({ alias: found.alias }) : fail(CODES.UNKNOWN, 'The server was added, but it is missing from the CLI list.')
  }
}
