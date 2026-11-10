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
  /** Set when only the comments could not be loaded; `comments` is then empty. */
  commentsError?: string
}
export type IssueComments = { comments: Comment[]; commentsOmitted?: number; truncated?: true }
export type SavedQuery = { id: string; name: string; query: string }
export type Repo = { id: string; name: string; path?: string; worktreeBaseRef?: string }
/** `project`: the listed project, the repository holding the folder, or the folder name; `path` is shortened for display. */
export type WorkspaceItem = { id: string; name: string; project?: string; branch?: string; path?: string }
/** A named prompt template; `builtIn`: one of the five the plugin ships (Restore puts them back). */
export type Template = { id: string; name: string; body: string; builtIn?: true }
export type Templates = { templates: Template[]; defaultId: string }
export type StartPrepare = {
  repos: Repo[]
  /** Set when the repository list could not be read; new worktrees are then unavailable. */
  reposError?: string
  /** Set when the workspace list could not be read; the current workspace is then unavailable. */
  workspacesError?: string
  /** Set when installed agents could not be detected; every agent is then in `other`. */
  agentsError?: string
  orcaCli: boolean
  defaultRepoId: string | null
  /** Suggested workspace name from the branch template. */
  name: string
  agents: { installed: string[]; other: string[] }
  /** An installed agent id, or '' for terminal only. */
  defaultAgent: string
  launchMode: 'worktree' | 'current'
  includeDescription: boolean
  /** The prompt templates to choose from; the default one is chosen first. */
  templates: { id: string; name: string; body: string }[]
  defaultTemplateId: string | null
  /** Text of the default template. */
  promptTemplate: string
  /** Template variables; render with ../worker/prompt.mjs. `branch` is ''. */
  vars: Record<string, string>
  workspaces: WorkspaceItem[]
  defaultWorkspaceId: string | null
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Without the YouTrack CLI: `cli.found` false and no servers (not an error). */
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
    /** Fails only when the issue itself cannot be read; failed comments are reported in `commentsError`. */
    'yt.issue.get': { input: { server: string; id: string }; output: Result<IssueDetail> }
    /** The comments of an issue alone, to load them again after they failed. */
    'yt.issue.comments': { input: { server: string; id: string }; output: Result<IssueComments> }
    /** Applies a YouTrack command such as "State Done" to the issue; command <= 500 characters. */
    'yt.issue.command': { input: { server: string; id: string; command: string }; output: Result<Record<string, never>> }
    /** Adds a comment to the issue, with the server's default visibility; text <= 10000 characters. */
    'yt.issue.comment': { input: { server: string; id: string; text: string }; output: Result<Record<string, never>> }
    'yt.savedQueries': { input: { server: string }; output: Result<SavedQuery[]> }
    /** name <= 60 characters. */
    'yt.savedQueries.create': { input: { server: string; name: string; query: string }; output: Result<SavedQuery> }
    'yt.start.prepare': { input: { server: string; id: string }; output: Result<StartPrepare> }
    'yt.refs.search': { input: { repoId: string; query: string }; output: Result<{ refs: string[] }> }
    /** New worktree. Without `agent` no prompt is sent. */
    'yt.start.run': {
      input: { server: string; id: string; repoId: string; name: string; baseBranch?: string; agent?: string; prompt?: string }
      /** `warning`: it started, but the plugin could not save the link or the launch. */
      output: Result<{ workspaceId: string; warning?: string }>
    }
    /** Agent in an existing workspace; no issue-to-workspace link is stored. */
    'yt.runInExisting': {
      input: { server: string; id: string; workspaceId: string; agent: string; prompt: string }
      output: Result<{ terminalId?: string; warning?: string }>
    }
    /** Issue id -> newest live workspace id. */
    'yt.links': { input: { server: string }; output: Result<Record<string, string>> }
    'yt.workspace.open': { input: { workspaceId: string }; output: Result<Record<string, never>> }
    /** The prompt templates; the built-ins (and a changed old prompt setting) are set up on first use. */
    'yt.templates': { input: Record<string, never>; output: Result<Templates> }
    /** Creates (no `id`) or changes a template; name 1..60, body 1..8000 characters, at most 30 templates. */
    'yt.templates.save': { input: { id?: string; name: string; body: string }; output: Result<Templates & { id: string }> }
    /** The last template cannot be deleted; the default moves to the first one left. */
    'yt.templates.delete': { input: { id: string }; output: Result<Templates> }
    'yt.templates.setDefault': { input: { id: string }; output: Result<Templates> }
    /** Puts back the five built-ins as shipped; the person's own templates stay. */
    'yt.templates.restore': { input: Record<string, never>; output: Result<Templates> }
    /** The Orca projects and each server's default project (alias -> repo id). */
    'yt.servers.defaults': { input: Record<string, never>; output: Result<{ repos: Repo[]; reposError?: string; defaults: Record<string, string> }> }
    /** Sets the project Start offers for a server when none was chosen before; null clears it. */
    'yt.servers.setDefaultRepo': { input: { server: string; repoId: string | null }; output: Result<Record<string, never>> }
    /**
     * Removes the server from the YouTrack CLI (signing it out) and forgets its saved query, links,
     * launches and projects. `warning`: removed, but some of that could not be forgotten.
     */
    'yt.servers.remove': { input: { server: string }; output: Result<{ warning?: string }> }
    /** Answer arrives as 'yt.servers.added'; the sign-in link as 'yt.servers.authUrl'. */
    'yt.servers.add': { input: { url: string }; output: Result<{ started: true }> }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    /** The browser sign-in link of a running 'yt.servers.add'. */
    'yt.servers.authUrl': { url: string }
    /** Outcome of 'yt.servers.add': the alias of the new server. */
    'yt.servers.added': Result<{ alias: string }>
    /** Workspace links changed (a linked workspace was removed); load 'yt.links' again. */
    'yt.linksChanged': Record<string, never>
    /** An agent started by the plugin finished. */
    'yt.agentFinished': { server: string; issueId: string; workspaceId: string | null }
  }
}
