// The panel <-> worker contract, declared once: src/panel.tsx and worker/main.mjs both read it.
// Every request answers with a Result: domain errors are returned, never thrown.
export {}

export type ErrorCode =
  | 'CLI_NOT_FOUND' | 'NO_SERVERS' | 'AUTH_FAILED' | 'NETWORK' | 'NOT_FOUND' | 'FORBIDDEN' | 'QUERY_INVALID'
  | 'ORCA_CLI_NOT_FOUND' | 'ORCA_CLI_FAILED' | 'TIMEOUT' | 'PROMPT_TOO_LONG' | 'UNKNOWN'
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } }

export type Value = { name: string; color?: string }
export type User = { login: string; fullName: string }
/** `truncated`: the text was cut; the UI can offer "Open in browser". */
export type Comment = { id: string; author: User; created: number; textMd: string; truncated?: true }
export type Server = { alias: string; url: string; active: boolean; status: string }
export type IssueRow = {
  id: string; summary: string; state?: Value; priority?: Value; assignee?: User
  created: number; updated: number; resolved: boolean; url: string
}
export type IssueDetail = IssueRow & {
  /** Every custom field of the issue as display strings, in the order YouTrack lists them. */
  fields: { name: string; value: string }[]
  project: { shortName: string; name: string }; type?: Value; descriptionMd: string; comments: Comment[]
  /** Description or comments were cut (long text, only the newest 200 comments kept). */
  truncated?: true
  /** Number of older comments left out. */
  commentsOmitted?: number
}
export type SavedQuery = { id: string; name: string; query: string }
export type Repo = { id: string; name: string; path?: string; worktreeBaseRef?: string }
export type WorkspaceItem = { id: string; name: string; project?: string; branch?: string }
export type StartPrepare = {
  repos: Repo[]
  /** Set when the repository list could not be read. */
  reposError?: string
  orcaCli: boolean
  defaultRepoId: string | null
  /** Suggested workspace name from the branch template. */
  name: string
  agents: { installed: string[]; other: string[] }
  /** An installed agent id, or '' for terminal only. */
  defaultAgent: string
  launchMode: 'worktree' | 'current'
  includeDescription: boolean
  promptTemplate: string
  /** Template variables; render with ../worker/prompt.mjs. `branch` is ''. */
  vars: Record<string, string>
  workspaces: WorkspaceItem[]
  defaultWorkspaceId: string | null
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Without the youtrack CLI: `cli.found` false and no servers (not an error). */
    'yt.env': {
      input: Record<string, never>
      output: Result<{
        cli: { found: boolean; version?: string; installCommand?: string }
        orcaCli: { found: boolean }
        servers: Server[]
        server: string | null
        /** The last working query of that server, or the default. */
        query: string
        /** Set when the instance list failed (CLI present, no usable server list). */
        error?: string
        /** The `defaultQuery` setting. */
        defaultQuery: string
        /** Set when the instance list failed (CLI present, no usable server list). */
        error?: string
      }>
    }
    /** Remember the chosen server. */
    'yt.setServer': { input: { server: string }; output: Result<Record<string, never>> }
    /** Remember the last query of a server; call after a search succeeded. */
    'yt.setQuery': { input: { server: string; query: string }; output: Result<Record<string, never>> }
    /** limit <= 50, offset + limit <= 500; `total` only when offset is 0. */
    'yt.issues.search': {
      input: { server: string; query: string; offset: number; limit: number }
      output: Result<{ issues: IssueRow[]; hasMore: boolean; total?: number }>
    }
    'yt.issue.get': { input: { server: string; id: string }; output: Result<IssueDetail> }
    'yt.savedQueries': { input: { server: string }; output: Result<SavedQuery[]> }
    /** name <= 60 characters. */
    'yt.savedQueries.create': { input: { server: string; name: string; query: string }; output: Result<SavedQuery> }
    'yt.start.prepare': { input: { server: string; id: string }; output: Result<StartPrepare> }
    'yt.refs.search': { input: { repoId: string; query: string }; output: Result<{ refs: string[] }> }
    /** New worktree. Without `agent` no prompt is sent. */
    'yt.start.run': {
      input: { server: string; id: string; repoId: string; name: string; baseBranch?: string; agent?: string; prompt?: string }
      output: Result<{ workspaceId: string }>
    }
    /** Agent in an existing workspace; no issue-to-workspace link is stored. */
    'yt.runInExisting': {
      input: { server: string; id: string; workspaceId: string; agent: string; prompt: string }
      output: Result<{ terminalId?: string }>
    }
    /** Issue id -> newest live workspace id. */
    'yt.links': { input: { server: string }; output: Result<Record<string, string>> }
    'yt.workspace.open': { input: { workspaceId: string }; output: Result<Record<string, never>> }
    /** Opens a terminal in the active workspace; `url` is required for 'login'. */
    'yt.terminal.run': { input: { command: 'install' | 'login'; url?: string }; output: Result<Record<string, never>> }
    /** Answer arrives as 'yt.servers.added'; the sign-in link as 'yt.servers.authUrl'. */
    'yt.servers.add': { input: { url: string }; output: Result<{ started: true }> }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    /** The browser sign-in link of a running 'yt.servers.add'. */
    'yt.servers.authUrl': { url: string }
    /** Outcome of 'yt.servers.add': the alias of the new server. */
    'yt.servers.added': Result<{ alias: string }>
    /** An agent started by the plugin finished. */
    'yt.agentFinished': { server: string; issueId: string; workspaceId: string | null }
  }
}
