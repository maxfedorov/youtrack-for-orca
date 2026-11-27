// Checks that a worker answer has the shape the screens read, so data of any other shape is shown as
// an error instead of breaking a render. Only fields the panel reads are checked. Answers made of
// independent parts (issue rows, issue fields, comments) are repaired part by part instead.

type Check = (v: unknown) => boolean
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str: Check = (v) => typeof v === 'string'
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const bool: Check = (v) => typeof v === 'boolean'
const any: Check = () => true
const optional = (c: Check): Check => (v) => v === undefined || c(v)
const list = (c: Check): Check => (v) => Array.isArray(v) && v.every(c)
const shape = (fields: Record<string, Check>): Check => (v) => isObj(v) && Object.entries(fields).every(([k, c]) => c(v[k]))

const value = shape({ name: str })
const user = shape({ login: str, fullName: str })
const server = shape({ alias: str, url: str, status: str })
const savedQuery = shape({ id: str, name: str, query: str })

const CHECKS: Record<string, Check> = {
  'yt.savedQueries.create': savedQuery,
  'yt.start.run': shape({ workspaceId: str, warning: optional(str) }),
  'yt.runInExisting': shape({ warning: optional(str) }),
  'yt.servers.remove': shape({ warning: optional(str) }),
  'yt.article.send': shape({ accepted: bool }),
  'yt.cli.update': (v) => isObj(v) && (v.available === false || (v.available === true && str(v.current) && str(v.latest) && str(v.url)))
}

/** Shown for a value of a shape the panel cannot read. */
export const NOT_AVAILABLE = 'n/a'
export const COMMENTS_FAILED = 'Comments could not be loaded.'

const id = (v: unknown) => typeof v === 'string' && v !== ''
const or = <T,>(c: Check, v: unknown, fallback: T) => (c(v) ? v : fallback)

/** A part of an answer of an unexpected shape becomes n/a (or is left out); the other parts stay. */
function fixRow(v: Obj): Obj {
  const out: Obj = {
    ...v,
    summary: or(str, v.summary, NOT_AVAILABLE),
    created: or(num, v.created, 0),
    updated: or(num, v.updated, 0),
    resolved: v.resolved === true
  }
  for (const key of ['state', 'priority'] as const) {
    if (v[key] === undefined) delete out[key]
    else if (!value(v[key])) out[key] = { name: NOT_AVAILABLE }
  }
  if (v.assignee === undefined) delete out.assignee
  else if (!user(v.assignee)) out.assignee = { login: '', fullName: NOT_AVAILABLE }
  if (v.fields === undefined) delete out.fields
  else out.fields = strings(v.fields)
  return out
}

const fixComments = (v: unknown[]) =>
  v.filter((c): c is Obj => isObj(c) && str(c.textMd)).map((c) => ({
    ...c,
    id: or(str, c.id, ''),
    author: or(user, c.author, { login: '', fullName: '' }),
    created: or(num, c.created, 0)
  }))

const KINDS = ['enum', 'state', 'user', 'version', 'ownedField', 'build', 'string', 'integer', 'period', 'other']
/** A field's name with how it is changed; an unknown kind is changed with a command. */
const fixMeta = (f: Obj): Obj => {
  const meta: Obj = { name: f.name, kind: KINDS.includes(f.kind as string) ? f.kind : 'other', multi: f.multi === true, required: f.required === true }
  if (f.empty === true) meta.empty = true
  return meta
}

const titled = (v: unknown): v is Obj => isObj(v) && id(v.id) && str(v.summary)
/** A readable article id, as the worker checks it. */
const ARTICLE = /^[A-Za-z0-9_]+-A-\d+$/

function fixDetail(v: Obj): Obj {
  const out: Obj = { ...fixRow(v) }
  out.fields = (Array.isArray(v.fields) ? v.fields : [])
    .filter((f): f is Obj => isObj(f) && id(f.name))
    .map((f) => ({ ...fixMeta(f), value: str(f.value) ? f.value : NOT_AVAILABLE }))
  out.tags = (Array.isArray(v.tags) ? v.tags : []).filter((t): t is string => id(t))
  if (!user(v.reporter)) delete out.reporter
  if (Array.isArray(v.links)) {
    out.links = v.links
      .filter((l): l is Obj => isObj(l) && str(l.type) && Array.isArray(l.issues))
      .map((l) => ({
        type: l.type,
        issues: (l.issues as unknown[])
          .filter((i): i is Obj => isObj(i) && id(i.id))
          .map((i) => ({ id: i.id, summary: or(str, i.summary, ''), resolved: i.resolved === true }))
      }))
      .filter((l) => l.issues.length > 0)
  } else delete out.links
  if (!str(v.linksError)) delete out.linksError
  const articles = keep(v.articles, (x) => titled(x) && ARTICLE.test((x as Obj).id as string)).map((x) => ({ id: (x as Obj).id, summary: (x as Obj).summary }))
  if (articles.length > 0) out.articles = articles
  else delete out.articles
  out.descriptionMd = or(str, v.descriptionMd, '')
  out.comments = Array.isArray(v.comments) ? fixComments(v.comments) : []
  if (!Array.isArray(v.comments)) out.commentsError = str(v.commentsError) ? v.commentsError : COMMENTS_FAILED
  else if (!str(v.commentsError)) delete out.commentsError
  if (!num(v.commentsOmitted)) delete out.commentsOmitted
  if (v.truncated !== true) delete out.truncated
  return out
}

const fixIssues = (v: Obj): Obj => {
  const out: Obj = { ...v, issues: (v.issues as unknown[]).filter((r): r is Obj => isObj(r) && id(r.id) && str(r.url)).map(fixRow) }
  if (!num(v.total)) delete out.total
  if (Array.isArray(v.columns)) out.columns = (v.columns as unknown[]).filter((c): c is string => id(c))
  else delete out.columns
  return out
}

const template = shape({ id, name: str, body: str })
/** Templates of an unexpected shape are left out; the default falls to the first one left. */
function fixTemplates(v: Obj): Obj {
  const templates = keep(v.templates, template)
  const defaultId = templates.some((t) => (t as Obj).id === v.defaultId) ? v.defaultId : ((templates[0] as Obj | undefined)?.id ?? '')
  return { ...v, templates, defaultId }
}

/** Only the entries of the expected shape; the list itself must be a list. */
const keep = (v: unknown, c: Check) => (Array.isArray(v) ? v.filter(c) : [])
/** Only the string values of a record. */
const strings = (v: unknown) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => str(x))) : {})

function fixEnv(v: Obj): Obj {
  const cli = v.cli as Obj
  const out: Obj = {
    ...v,
    cli: { found: cli.found, ...(str(cli.version) ? { version: cli.version } : {}) },
    orcaCli: { found: isObj(v.orcaCli) && v.orcaCli.found === true },
    servers: keep(v.servers, (x) => server(x) && id((x as Obj).alias)),
    server: or(str, v.server, null),
    defaultQuery: or(str, v.defaultQuery, '')
  }
  out.query = or(str, v.query, out.defaultQuery)
  if (!str(v.error)) delete out.error
  return out
}

function fixPrepare(v: Obj): Obj {
  const agents = isObj(v.agents) ? v.agents : {}
  const detected = list(str)(agents.installed) && list(str)(agents.other)
  const out: Obj = {
    ...v,
    repos: keep(v.repos, shape({ id, name: str, worktreeBaseRef: optional(str) })),
    workspaces: keep(v.workspaces, shape({ id, name: str, project: optional(str), branch: optional(str), path: optional(str) })),
    vars: strings(v.vars),
    agents: detected ? agents : { installed: [], other: [...keep(agents.installed, str), ...keep(agents.other, str)] },
    defaultRepoId: or(str, v.defaultRepoId, null),
    defaultWorkspaceId: or(str, v.defaultWorkspaceId, null),
    templates: keep(v.templates, template).map((t) => ({ id: (t as Obj).id, name: (t as Obj).name, body: (t as Obj).body }))
  }
  const templates = out.templates as Obj[]
  out.defaultTemplateId = templates.some((t) => t.id === v.defaultTemplateId) ? v.defaultTemplateId : (templates[0]?.id ?? null)
  const f = isObj(v.finish) ? v.finish : {}
  const fields = keep(f.fields, shape({ name: id })).map((x) => {
    const values = keep((x as Obj).values, id) as string[]
    return { name: (x as Obj).name, values, state: values.includes((x as Obj).state as string) ? (x as Obj).state : '' }
  }).filter((x) => x.values.length > 0)
  out.finish = {
    comment: f.comment === true,
    field: fields.some((x) => x.name === f.field) ? f.field : (fields[0]?.name ?? null),
    fields
  }
  out.articles = keep(v.articles, (x) => str(x) && ARTICLE.test(x as string)).slice(0, 20)
  out.includeArticles = v.includeArticles === true
  for (const key of ['reposError', 'workspacesError', 'agentsError']) if (!str(v[key])) delete out[key]
  if (!detected && !str(v.agentsError)) out.agentsError = 'Installed agents could not be detected.'
  return out
}

/** Articles of an unexpected shape are left out; a broken parent is dropped. */
const fixNodes = (v: Obj): Obj => {
  const out: Obj = {
    articles: keep(v.articles, titled).map((a) => {
      const n = a as Obj
      const node: Obj = { id: n.id, summary: n.summary, hasChildren: n.hasChildren === true, starred: n.starred === true }
      if (titled(n.parent)) node.parent = { id: n.parent.id, summary: n.parent.summary }
      return node
    })
  }
  if (v.cut === true) out.cut = true
  return out
}

function fixArticle(v: Obj): Obj {
  const pairs = (x: unknown) => keep(x, titled).map((p) => ({ id: (p as Obj).id, summary: (p as Obj).summary }))
  const out: Obj = {
    ...v,
    summary: or(str, v.summary, NOT_AVAILABLE),
    project: isObj(v.project) && str(v.project.shortName) && str(v.project.name) ? v.project : { shortName: '', name: '' },
    contentMd: or(str, v.contentMd, ''),
    path: pairs(v.path),
    children: (fixNodes({ articles: v.children }).articles as unknown[]),
    mentionedArticles: pairs(v.mentionedArticles),
    mentionedIssues: keep(v.mentionedIssues, titled).map((i) => ({ id: (i as Obj).id, summary: (i as Obj).summary, resolved: (i as Obj).resolved === true })),
    attachments: keep(v.attachments, id),
    comments: Array.isArray(v.comments) ? fixComments(v.comments) : [],
    created: or(num, v.created, 0),
    updated: or(num, v.updated, 0)
  }
  for (const key of ['reporter', 'updatedBy']) if (!user(v[key])) delete out[key]
  if (!num(v.commentsOmitted)) delete out.commentsOmitted
  if (v.truncated !== true) delete out.truncated
  return out
}

/** Answers whose parts can be repaired: the core the screen needs is checked, the rest is fixed. */
const REPAIRS: Record<string, { core: Check; fix: (v: Obj) => unknown }> = {
  'yt.env': { core: shape({ cli: shape({ found: bool }), servers: Array.isArray }), fix: fixEnv },
  'yt.savedQueries': {
    core: Array.isArray,
    fix: (v) => keep(v, savedQuery).map((q) => ({ id: (q as Obj).id, name: (q as Obj).name, query: (q as Obj).query, ...((q as Obj).favorite === true ? { favorite: true } : {}) }))
  },
  'yt.quickViews': { core: isObj, fix: (v) => ({ ids: keep(v.ids, id) }) },
  'yt.quickViews.set': { core: isObj, fix: (v) => ({ ids: keep(v.ids, id) }) },
  'yt.links': { core: isObj, fix: strings },
  'yt.current': {
    core: isObj,
    fix: (v) => {
      const i = isObj(v.issue) ? v.issue : null
      if (!i || !id(i.id) || !str(i.url)) return { issue: null }
      const out: Obj = { issue: { id: i.id, summary: str(i.summary) ? i.summary : '', url: i.url } }
      if (id(v.workspaceId)) out.workspaceId = v.workspaceId
      return out
    }
  },
  'yt.refs.search': { core: shape({ refs: Array.isArray }), fix: (v) => ({ refs: keep(v.refs, id) }) },
  'yt.start.prepare': {
    core: shape({
      orcaCli: bool, name: str, defaultAgent: str, launchMode: (v) => v === 'worktree' || v === 'current', includeDescription: bool
    }),
    fix: fixPrepare
  },
  'yt.templates': { core: shape({ templates: Array.isArray }), fix: fixTemplates },
  'yt.templates.save': { core: shape({ templates: Array.isArray, id: str }), fix: fixTemplates },
  'yt.templates.delete': { core: shape({ templates: Array.isArray }), fix: fixTemplates },
  'yt.templates.setDefault': { core: shape({ templates: Array.isArray }), fix: fixTemplates },
  'yt.templates.restore': { core: shape({ templates: Array.isArray }), fix: fixTemplates },
  'yt.servers.defaults': {
    core: isObj,
    fix: (v) => {
      const out: Obj = { repos: keep(v.repos, shape({ id, name: str })), defaults: strings(v.defaults) }
      if (str(v.reposError)) out.reposError = v.reposError
      return out
    }
  },
  'yt.skill.install': { core: isObj, fix: (v) => ({ messages: keep(v.messages, id) }) },
  'yt.projects': {
    core: shape({ projects: Array.isArray }),
    fix: (v) => ({ projects: (v.projects as unknown[]).filter((p): p is Obj => isObj(p) && id(p.shortName)).map((p) => ({ shortName: p.shortName, name: str(p.name) ? p.name : p.shortName })) })
  },
  'yt.issue.create': { core: shape({ id }), fix: (v) => ({ id: v.id }) },
  'yt.issue.draft': {
    core: shape({ draftId: id, fields: Array.isArray }),
    fix: (v) => ({ draftId: v.draftId, fields: (v.fields as unknown[]).filter((f): f is Obj => isObj(f) && id(f.name)).map((f) => (str(f.value) ? { ...fixMeta(f), value: f.value } : fixMeta(f))) })
  },
  'yt.issue.fieldValues': {
    core: shape({ values: Array.isArray }),
    fix: (v) => ({
      values: (v.values as unknown[]).filter((x): x is Obj => isObj(x) && id(x.name)).map((x) => (id(x.label) ? { name: x.name, label: x.label } : { name: x.name })),
      cut: v.cut === true
    })
  },
  'yt.issues.search': { core: shape({ issues: Array.isArray, hasMore: bool }), fix: fixIssues },
  'yt.articles.roots': { core: shape({ articles: Array.isArray }), fix: fixNodes },
  'yt.articles.children': { core: shape({ articles: Array.isArray }), fix: fixNodes },
  'yt.articles.search': { core: shape({ articles: Array.isArray }), fix: fixNodes },
  'yt.article.get': { core: shape({ id, url: str }), fix: fixArticle },
  'yt.articles.project': { core: isObj, fix: (v) => ({ project: id(v.project) ? v.project : null }) },
  'yt.agents': {
    core: shape({ agents: Array.isArray }),
    fix: (v) => ({
      agents: (v.agents as unknown[]).filter((a): a is Obj => isObj(a) && id(a.terminalId)).map((a) => ({ terminalId: a.terminalId, title: or(str, a.title, ''), agent: or(str, a.agent, '') }))
    })
  },
  'yt.issue.get': { core: shape({ id, url: str }), fix: fixDetail },
  'yt.issue.comments': {
    core: shape({ comments: Array.isArray }),
    fix: (v) => {
      const out: Obj = { ...v, comments: fixComments(v.comments as unknown[]) }
      if (!num(v.commentsOmitted)) delete out.commentsOmitted
      if (v.truncated !== true) delete out.truncated
      return out
    }
  }
}

/** True when `data` can be shown for an answer to `name`; answers the panel does not read always pass. */
export function validAnswer(name: string, data: unknown): boolean {
  return (CHECKS[name] ?? any)(data)
}

/**
 * The answer as the screens can draw it, or null when its core is missing. Parts of an unexpected
 * shape are repaired (n/a, left out, or marked as not loaded) instead of failing the whole answer.
 */
export function fitAnswer(name: string, data: unknown): { data: unknown } | null {
  const repair = REPAIRS[name]
  if (repair) return repair.core(data) ? { data: repair.fix(data as Obj) } : null
  return validAnswer(name, data) ? { data } : null
}

/** A worker post `{ url }` with a string url, or null. */
export const postedUrl = (payload: unknown): string | null => (isObj(payload) && typeof payload.url === 'string' ? payload.url : null)
