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
  /** Text of the custom fields shown as columns, by column key (`field:` and the name in lower case). */
  fields?: Record<string, string>
}
export type IssueDetail = IssueRow & {
  /** Every custom field of the issue as display strings, in the order YouTrack lists them, with how it is changed. */
  fields: ({ name: string; value: string } & Partial<Omit<FieldMeta, 'name'>>)[]
  project: { shortName: string; name: string }; type?: Value; descriptionMd: string; comments: Comment[]
  /** Who created the issue, when the CLI says. */
  reporter?: User
  /** Tag names, in the order YouTrack lists them. */
  tags: string[]
  /** Linked issues by how they relate ("depends on"); missing when they could not be loaded. */
  links?: { type: string; issues: { id: string; summary: string; resolved: boolean }[] }[]
  /** Set when only the linked issues could not be loaded. */
  linksError?: string
  /** Knowledge base articles the issue mentions. */
  articles?: { id: string; summary: string }[]
  /** Description or comments were cut (long text, only the newest 200 comments kept). */
  truncated?: true
  /** Number of older comments left out. */
  commentsOmitted?: number
  /** Set when only the comments could not be loaded; `comments` is then empty. */
  commentsError?: string
}
/** How a field is changed: `kind` other means free text, numbers or periods (changed with a command). */
/**
 * How a field is changed: from a list (`enum` ... `build`), by typing (`string`, `integer`, `period`),
 * or with a command (`other`). `empty`: a typed field has no value (`value` is then its empty text).
 */
export type FieldMeta = {
  name: string; value?: string
  kind: 'enum' | 'state' | 'user' | 'version' | 'ownedField' | 'build' | 'string' | 'integer' | 'period' | 'other'
  multi: boolean; required: boolean; empty?: true
}
/** Values a field offers on one issue or draft (users by login, `label` their name); `cut`: there may be more. */
export type FieldValues = { values: { name: string; label?: string }[]; cut: boolean }
export type IssueComments = { comments: Comment[]; commentsOmitted?: number; truncated?: true }
/** `favorite`: starred by the user in YouTrack (left out when the YouTrack CLI does not say). */
export type SavedQuery = { id: string; name: string; query: string; favorite?: boolean }
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
  /** Articles the issue mentions, by id; the prompt can ask the agent to read them. */
  articles?: string[]
  /** Whether the "Include mentioned articles" switch starts on. */
  includeArticles?: boolean
  /** Start the agent with no prompt (the setting's choice; the Start view can change it). */
  withoutPrompt?: boolean
  /** The prompt templates to choose from; the default one is chosen first. */
  templates: { id: string; name: string; body: string }[]
  defaultTemplateId: string | null
  /** Text of the default template. */
  /** Template variables; render with ../worker/prompt.mjs. `branch` is ''. */
  vars: Record<string, string>
  workspaces: WorkspaceItem[]
  defaultWorkspaceId: string | null
  /**
   * What the prompt asks the agent to do when it is done: comment a summary, then set one of `fields`
   * (the issue's state and enum fields) to one of its `values`. `field` is the one shown first (null
   * when there are none); each field's `state` is its value offered first, '' for no change.
   */
  finish?: { comment: boolean; field: string | null; fields: FinishField[] }
}

export type FinishField = { name: string; values: string[]; state: string }

/** An agent in the focused workspace; `title` and `agent` are '' when Orca does not say. */
export type Agent = { terminalId: string; title: string; agent: string }

/** An article in the tree or a search, without its content; `parent` only in searches. */
export type ArticleNode = { id: string; summary: string; hasChildren: boolean; starred: boolean; parent?: { id: string; summary: string } }
/** `cut`: more articles than one answer holds were left out. */
export type ArticleNodes = { articles: ArticleNode[]; cut?: true }
/** An article as its card shows it; `path` runs from the root down to its parent. */
export type ArticleDetail = {
  id: string; summary: string; url: string; project: { shortName: string; name: string }; contentMd: string
  path: { id: string; summary: string }[]
  children: ArticleNode[]
  mentionedArticles: { id: string; summary: string }[]
  mentionedIssues: { id: string; summary: string; resolved: boolean }[]
  /** Attachment names. */
  attachments: string[]
  comments: Comment[]
  reporter?: User
  updated: number
  updatedBy?: User
  /** Content or comments were cut (long text, only the newest comments kept). */
  truncated?: true
  commentsOmitted?: number
}

/** The field and value the agent was asked to set when done; remembered for the issue's project. */
export type FinishChoice = { field: string; state: string }

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Without the YouTrack CLI: `cli.found` false and no servers (not an error). */
    'yt.env': {
      input: Record<string, never>
      output: Result<{
        cli: { found: boolean; version?: string }
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
      output: Result<{ issues: IssueRow[]; hasMore: boolean; total?: number; columns?: string[] }>
    }
    /** Fails only when the issue itself cannot be read; failed comments are reported in `commentsError`. */
    'yt.issue.get': { input: { server: string; id: string }; output: Result<IssueDetail> }
    /** The comments of an issue alone, to load them again after they failed. */
    'yt.issue.comments': { input: { server: string; id: string }; output: Result<IssueComments> }
    /** Applies a YouTrack command such as "State Done" to the issue; command <= 500 characters. */
    'yt.issue.command': { input: { server: string; id: string; command: string }; output: Result<Record<string, never>> }
    /** Installs or updates the YouTrack CLI's skill for every coding agent found; `messages`: what the CLI did. */
    'yt.skill.install': { input: Record<string, never>; output: Result<{ messages: string[] }> }
    /** A newer YouTrack CLI release than the installed one, checked at most once a day; skipped releases are left out. */
    'yt.cli.update': {
      input: Record<string, never>
      output: Result<{ available: false } | { available: true; current: string; latest: string; url: string }>
    }
    /** Stops offering this release until a newer one comes out. */
    'yt.cli.update.skip': { input: { version: string }; output: Result<Record<string, never>> }
    /** Starts `youtrack update`; the outcome arrives as 'yt.cli.upgraded'. */
    'yt.cli.upgrade': { input: Record<string, never>; output: Result<{ started: true }> }
    /** The projects of the server the account can see (at most 500). */
    'yt.projects': { input: { server: string }; output: Result<{ projects: { shortName: string; name: string }[] }> }
    /**
     * The draft the new-issue form fills for a project (an earlier one is reused) and its fields.
     * Fails with FORBIDDEN when the user cannot create issues there.
     */
    'yt.issue.draft': { input: { server: string; project: string }; output: Result<{ draftId: string; fields: FieldMeta[] }> }
    /** Fills the form's draft and submits it as an issue; fields are values the draft offers (at most 20). */
    'yt.issue.create': {
      input: { server: string; draftId: string; summary: string; description?: string; fields?: Record<string, string> }
      output: Result<{ id: string }>
    }
    /** Deletes the form's draft (Back, or another project); drafts the plugin did not start are left alone. */
    'yt.issue.draft.discard': { input: { server: string; draftId: string }; output: Result<Record<string, never>> }
    /** The values a field offers on an issue or a draft, as `issue field list-values` reads them. */
    'yt.issue.fieldValues': { input: { server: string; id: string; field: string }; output: Result<FieldValues> }
    /** Sets a single-value field to one of the values it offers; null empties a field that may be empty. */
    'yt.issue.setField': { input: { server: string; id: string; field: string; value: string | null }; output: Result<Record<string, never>> }
    /** Changes the summary (one line, <= 255) and/or the description (<= 60000; '' clears it). */
    'yt.issue.update': { input: { server: string; id: string; summary?: string; description?: string }; output: Result<Record<string, never>> }
    /** Adds a comment to the issue, with the server's default visibility; text <= 10000 characters. */
    /** Removes a tag from the issue by its exact name. */
    'yt.issue.removeTag': { input: { server: string; id: string; tag: string }; output: Result<Record<string, never>> }
    'yt.issue.comment': { input: { server: string; id: string; text: string }; output: Result<Record<string, never>> }
    /** The top-level articles of a project, in YouTrack's order; at most 500. */
    'yt.articles.roots': { input: { server: string; project: string }; output: Result<ArticleNodes> }
    /** The sub-articles of an article. */
    'yt.articles.children': { input: { server: string; id: string }; output: Result<ArticleNodes> }
    /** Articles of a project matching a query (<= 2000 characters), only starred ones with `favorites`; at most 200. */
    'yt.articles.search': { input: { server: string; project: string; query: string; favorites: boolean }; output: Result<ArticleNodes> }
    /** One article with its comments; content and comments are cut to what the panel can draw. */
    'yt.article.get': { input: { server: string; id: string }; output: Result<ArticleDetail> }
    /** Adds a comment to an article; text <= 10000 characters. */
    'yt.article.comment': { input: { server: string; id: string; text: string }; output: Result<Record<string, never>> }
    /** The agents of the focused workspace that have a terminal (at most 20). */
    'yt.agents': { input: Record<string, never>; output: Result<{ agents: Agent[] }> }
    /**
     * Types a line asking the agent to read the article (its id and a YouTrack CLI command, no title)
     * into that agent's terminal, without Enter; fails when the terminal is no longer an agent's.
     */
    'yt.article.send': { input: { server: string; id: string; terminalId: string }; output: Result<{ accepted: boolean }> }
    /** The project whose articles were shown last on the server. */
    'yt.articles.project': { input: { server: string }; output: Result<{ project: string | null }> }
    'yt.articles.setProject': { input: { server: string; project: string }; output: Result<Record<string, never>> }
    /** Puts every setting of the plugin back to its default. */
    'yt.settings.reset': { input: Record<string, never>; output: Result<Record<string, never>> }
    'yt.savedQueries': { input: { server: string }; output: Result<SavedQuery[]> }
    /** The ids of the saved searches shown as quick view buttons on the server, in order. */
    'yt.quickViews': { input: { server: string }; output: Result<{ ids: string[] }> }
    /** Replaces them; at most 12. */
    'yt.quickViews.set': { input: { server: string; ids: string[] }; output: Result<{ ids: string[] }> }
    /** name <= 60 characters. */
    'yt.savedQueries.create': { input: { server: string; name: string; query: string }; output: Result<SavedQuery> }
    'yt.start.prepare': { input: { server: string; id: string }; output: Result<StartPrepare> }
    'yt.refs.search': { input: { repoId: string; query: string }; output: Result<{ refs: string[] }> }
    /** New worktree. Without `agent` no prompt is sent. */
    'yt.start.run': {
      input: { server: string; id: string; repoId: string; name: string; baseBranch?: string; agent?: string; prompt?: string; finish?: FinishChoice }
      /** `warning`: it started, but the plugin could not save the link or the launch. */
      output: Result<{ workspaceId: string; warning?: string }>
    }
    /** Agent in an existing workspace; no issue-to-workspace link is stored. */
    'yt.runInExisting': {
      input: { server: string; id: string; workspaceId: string; agent: string; prompt: string; finish?: FinishChoice }
      output: Result<{ terminalId?: string; warning?: string }>
    }
    /** The issue of the focused workspace (started there by the plugin, or named in its branch); `issue` null when none. */
    'yt.current': { input: { server: string }; output: Result<{ issue: { id: string; summary: string; url: string } | null; workspaceId?: string }> }
    /** Issue id -> newest live workspace id; workspaces whose branch names an issue count too. */
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
    /** The focused workspace or its branch changed; load 'yt.current' again. */
    'yt.currentChanged': Record<string, never>
    /** Outcome of 'yt.cli.upgrade': the version now installed ('' when it cannot be read). */
    'yt.cli.upgraded': Result<{ version: string }>
    /** An agent started by the plugin finished. */
    'yt.agentFinished': { server: string; issueId: string; workspaceId: string | null }
  }
}
