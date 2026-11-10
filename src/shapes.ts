// Checks that a worker answer has the shape the screens read, so data of any other shape is shown as
// an error instead of breaking a render. Only fields the panel reads are checked.

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
const row = shape({ id: str, summary: str, created: num, updated: num, url: str, state: optional(value), priority: optional(value), assignee: optional(user) })
const comment = shape({ id: str, author: user, created: num, textMd: str })
const savedQuery = shape({ id: str, name: str, query: str })

const detail: Check = (v) =>
  row(v) &&
  shape({
    fields: list(shape({ name: str, value: str })), descriptionMd: str, comments: list(comment), commentsOmitted: optional(num),
    commentsError: optional(str)
  })(v)

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
  'yt.issues.search': shape({ issues: list(row), hasMore: bool, total: optional(num) }),
  'yt.issue.get': detail,
  'yt.issue.comments': shape({ comments: list(comment), commentsOmitted: optional(num) }),
  'yt.savedQueries': list(savedQuery),
  'yt.savedQueries.create': savedQuery,
  'yt.start.prepare': shape({
    repos: list(shape({ id: str, name: str, worktreeBaseRef: optional(str) })),
    reposError: optional(str),
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

/** True when `data` can be shown for an answer to `name`; answers the panel does not read always pass. */
export function validAnswer(name: string, data: unknown): boolean {
  return (CHECKS[name] ?? any)(data)
}

/** A worker post `{ url }` with a string url, or null. */
export const postedUrl = (payload: unknown): string | null => (isObj(payload) && typeof payload.url === 'string' ? payload.url : null)
