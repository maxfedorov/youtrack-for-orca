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
const nullable = (c: Check): Check => (v) => v === null || c(v)
const optional = (c: Check): Check => (v) => v === undefined || c(v)
const list = (c: Check): Check => (v) => Array.isArray(v) && v.every(c)
const record = (c: Check): Check => (v) => isObj(v) && Object.values(v).every(c)
const shape = (fields: Record<string, Check>): Check => (v) => isObj(v) && Object.entries(fields).every(([k, c]) => c(v[k]))

const value = shape({ name: str })
const user = shape({ login: str, fullName: str })
const server = shape({ alias: str, url: str, status: str })
const savedQuery = shape({ id: str, name: str, query: str })

const CHECKS: Record<string, Check> = {
  'yt.env': shape({
    cli: shape({ found: bool, version: optional(str), installCommand: optional(str) }),
    orcaCli: shape({ found: bool }),
    servers: list(server),
    server: nullable(str),
    query: str,
    defaultQuery: optional(str),
    error: optional(str)
  }),
  'yt.savedQueries': list(savedQuery),
  'yt.savedQueries.create': savedQuery,
  'yt.start.prepare': shape({
    repos: list(shape({ id: str, name: str, worktreeBaseRef: optional(str) })),
    reposError: optional(str),
    workspacesError: optional(str),
    agentsError: optional(str),
    orcaCli: bool,
    defaultRepoId: nullable(str),
    name: str,
    agents: shape({ installed: list(str), other: list(str) }),
    defaultAgent: str,
    launchMode: (v) => v === 'worktree' || v === 'current',
    includeDescription: bool,
    promptTemplate: str,
    vars: record(str),
    workspaces: list(shape({ id: str, name: str, project: optional(str) })),
    defaultWorkspaceId: nullable(str)
  }),
  'yt.refs.search': shape({ refs: list(str) }),
  'yt.start.run': shape({ workspaceId: str, warning: optional(str) }),
  'yt.runInExisting': shape({ warning: optional(str) }),
  'yt.links': record(str)
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
  return out
}

const fixComments = (v: unknown[]) =>
  v.filter((c): c is Obj => isObj(c) && str(c.textMd)).map((c) => ({
    ...c,
    id: or(str, c.id, ''),
    author: or(user, c.author, { login: '', fullName: '' }),
    created: or(num, c.created, 0)
  }))

function fixDetail(v: Obj): Obj {
  const out: Obj = { ...fixRow(v) }
  out.fields = (Array.isArray(v.fields) ? v.fields : [])
    .filter((f): f is Obj => isObj(f) && id(f.name))
    .map((f) => ({ name: f.name, value: str(f.value) ? f.value : NOT_AVAILABLE }))
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
  return out
}

/** Answers whose parts can be repaired: the core the screen needs is checked, the rest is fixed. */
const REPAIRS: Record<string, { core: Check; fix: (v: Obj) => unknown }> = {
  'yt.issues.search': { core: shape({ issues: Array.isArray, hasMore: bool }), fix: fixIssues },
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
