/** Requests about starting work: repos, workspaces, agent launches, terminals. */
import { ok, fail, CODES } from '../result.mjs'
import { toIssueDetail } from '../mapping.mjs'
import { issueVars, workspaceName, PROMPT_LIMIT } from '../prompt.mjs'
import { AGENTS } from '../agents.mjs'
import { inside, shortBranch, workspaceItems } from '../workspaces.mjs'
import { BUILT_IN } from '../templates.mjs'
import { issueIdFromBranch } from '../branch-issue.mjs'
import { toListedMeta, toValues, MAX_VALUES } from '../project-fields.mjs'
import { safeValue } from '../prompt.mjs'
import { safeHandle, shortMessage, unexpected, hasId, invalid, token, issueUrl, ISSUE_ID, ARTICLE_ID, settingString, capDetail, AGENT_ID, attempt, fallback, readSetting } from './common.mjs'

/** How long the project list of a server is reused for matching branches. */
const PROJECTS_MS = 10 * 60_000
const DEFAULT_BRANCH_TEMPLATE = '{{id_lower}}-{{summary_slug}}'
const noOrcaCli = () => fail(CODES.ORCA_CLI_NOT_FOUND, 'The Orca CLI was not found.')
const tooLong = () => fail(CODES.PROMPT_TOO_LONG, `Prompt is longer than ${PROMPT_LIMIT} characters`)

const NOT_SAVED = 'Started, but the plugin could not save it: this issue may not show its workspace or a finished notice.'

/** The YouTrack project of an issue: the short name its readable id starts with. */
const projectOf = (id) => id.slice(0, id.lastIndexOf('-'))

/** Fields the Start view offers for the agent to set when done; each one's values are read. */
const MAX_FINISH_FIELDS = 6
/** The names of the "State when done" setting, in order: `In Review, Review`. */
const finishNames = (setting) => settingString(setting, '').split(',').map((n) => n.trim()).filter(safeValue)
/** A finish choice sent with a start: a field name and a value name, or '' for no change. */
const finishChoice = (v) =>
  v && typeof v === 'object' && safeValue(v.field) && (v.state === '' || safeValue(v.state)) ? { field: v.field, state: v.state } : null

export function registerStartHandlers(ctx) {
  const { orca, orcaCli, links, launches, templates, detectAgents, now, resolveServer } = ctx
  const handle = (name, fn) => safeHandle(orca, name, fn)
  const host = (method, params) => orca.host.call(method, params)
  /**
   * Bookkeeping after the work already started: a failure must not report the start as failed (a
   * retry would start it twice), so it is logged and returned as a warning.
   */
  async function remember(what, write) {
    try {
      await write()
      return null
    } catch (e) {
      try {
        orca.log?.(`${what} failed after start: ${e instanceof Error ? e.name : typeof e}`)
      } catch {
        // logging is best effort
      }
      return NOT_SAVED
    }
  }

  /** Project short names of each server by upper case, read at most every PROJECTS_MS; null when unreadable. */
  const projectsByServer = new Map()
  async function serverProjects(alias) {
    const known = projectsByServer.get(alias)
    if (known && now() - known.at < PROJECTS_MS) return known.names
    const r = await attempt(() => ctx.youtrack.listProjects(alias))
    if (!r.ok || !Array.isArray(r.data)) return null
    const names = new Map(r.data.map((p) => [p.shortName.toUpperCase(), p.shortName]))
    projectsByServer.set(alias, { at: now(), names })
    return names
  }

  /**
   * The issue a workspace's branch names on this server: its project must be one of the server's, and
   * no other server may have started that workspace. The id takes the project's own spelling.
   */
  function branchIssue(branch, workspaceId, projects, owners) {
    const id = issueIdFromBranch(branch)
    if (!id || !projects) return null
    const others = owners.get(workspaceId)
    if (others && others.size > 0) return null
    const name = projects.get(id.slice(0, id.lastIndexOf('-')))
    return name ? `${name}${id.slice(id.lastIndexOf('-'))}` : null
  }

  async function listWorkspaces() {
    const r = await host('workspace.list', {})
    const list = (Array.isArray(r?.workspaces) ? r.workspaces : []).filter(
      (w) => w !== null && typeof w === 'object' && typeof w.id === 'string' && w.id !== ''
    )
    return { list, truncated: r?.truncated === true }
  }

  /**
   * The focused workspace: readContext has no id, so match branch and name against the list. When
   * several match (say `main` in two projects), the one in `repo` wins; otherwise none is guessed.
   */
  async function activeWorkspace(list, repo = null) {
    let c = null
    try {
      c = await host('workspace.readContext', {})
    } catch {
      return null
    }
    if (!c || typeof c !== 'object') return null
    const found = list.filter((w) => shortBranch(w.branch) === shortBranch(c.branch) && w.name === c.displayName)
    if (found.length <= 1) return found[0] ?? null
    const inRepo = found.filter((w) => repo && (w.project === repo.name || (repo.path && w.path && inside(repo.path, w.path))))
    return inRepo.length === 1 ? inRepo[0] : null
  }

  /**
   * What the agent may set when done: the issue's single-value state and enum fields (state fields
   * first) with the values this user may set. Each field comes with the value to offer first: the one
   * last chosen in this YouTrack project, else the first name of the setting the field has. The field
   * shown first is the one last chosen, else one with a value from the setting, else a state field.
   */
  async function finishFields(alias, id, listed, setting) {
    const candidates = (listed.ok && Array.isArray(listed.data) ? listed.data : [])
      .filter((f) => safeValue(f?.name) && !toListedMeta(f).multi && ['state', 'enum'].includes(toListedMeta(f).kind))
      .sort((a, b) => Number(toListedMeta(b).kind === 'state') - Number(toListedMeta(a).kind === 'state'))
      .slice(0, MAX_FINISH_FIELDS)
    const read = await Promise.all(candidates.map((f) => attempt(() => ctx.youtrack.fieldValues(alias, id, f.name))))
    const last = await fallback(() => ctx.state.finishChoice(alias, projectOf(id)), null)
    const wanted = finishNames(setting)
    const fields = []
    const stateKind = new Set()
    candidates.forEach((f, i) => {
      const values = read[i].ok ? toValues(read[i].data, MAX_VALUES).values.map((v) => v.name).filter(safeValue) : []
      if (values.length === 0) return
      const kept = last && last.field === f.name && (last.state === '' || values.includes(last.state))
      fields.push({ name: f.name, values, state: kept ? last.state : (wanted.find((w) => values.includes(w)) ?? '') })
      if (toListedMeta(f).kind === 'state') stateKind.add(f.name)
    })
    const first = fields.find((f) => last && f.name === last.field) ?? fields.find((f) => f.state) ?? fields.find((f) => stateKind.has(f.name)) ?? fields[0]
    return { field: first ? first.name : null, fields }
  }

  /** Remembers the finish choice of a start for its YouTrack project; one that is not names is skipped. */
  async function rememberFinish(alias, id, finish) {
    const choice = finishChoice(finish)
    if (choice) await fallback(() => ctx.state.rememberFinishChoice(alias, projectOf(id), choice), null)
  }

  /** Validate agent (empty means none) and prompt; returns `{ agent, prompt }` or a failed Result. */
  function checkLaunch({ agent, prompt }) {
    if (prompt != null && typeof prompt !== 'string') return invalid('Invalid prompt')
    if (prompt && prompt.length > PROMPT_LIMIT) return tooLong()
    if (agent != null && typeof agent !== 'string') return invalid('Invalid agent')
    if (agent && !AGENT_ID.test(agent)) return invalid('Invalid agent')
    return ok({ agent: agent || '', prompt: prompt && prompt.trim() ? prompt : '' })
  }

  handle('yt.start.prepare', async ({ server, id }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const s = await resolveServer(server)
    if (!s.ok) return s
    // Only the issue is required; repositories, workspaces, agents and settings each fall back alone.
    const [view, issueFields, repos, ws] = await Promise.all([
      attempt(() => ctx.youtrack.viewIssue(s.data.alias, id)),
      attempt(() => ctx.youtrack.issueFields(s.data.alias, id)),
      orcaCli ? attempt(() => orcaCli.repos()) : Promise.resolve(ok([])),
      attempt(async () => ok(await listWorkspaces()))
    ])
    if (!view.ok) return view
    if (!hasId(view.data)) return unexpected()
    const issue = capDetail(toIssueDetail(view.data, null, s.data.url))
    const vars = issueVars({ issue, server: s.data.alias, branch: '' })
    const get = (k) => readSetting(orca, k)
    const agents = await fallback(() => detectAgents(), null)
    // Templates that cannot be read fall back to the built-ins.
    const stored = await attempt(() => templates.list())
    const prompts = stored.ok ? stored.data : { templates: BUILT_IN, defaultId: BUILT_IN[0].id }
    const chosenTemplate = prompts.templates.find((t) => t.id === prompts.defaultId) ?? prompts.templates[0]
    const defaultAgent = settingString(await get('defaultAgent'), '')
    const workspaces = ws.ok ? ws.data.list : []
    const repoList = repos.ok && Array.isArray(repos.data) ? repos.data : []
    const listed = (repoId) => (repoId ? repoList.find((r) => r.id === repoId) : undefined)
    const remembered = listed(await fallback(() => ctx.state.projectRepo(s.data.alias, projectOf(id)), null))
    const active = await activeWorkspace(workspaces, remembered)
    // The workspace started for this issue last time, if it is still there; otherwise the focused one.
    const linked = await fallback(() => links.latest(s.data.alias, id, new Set(workspaces.map((w) => w.id))), null)
    const ofWorkspace =
      active &&
      (repoList.find((r) => typeof r.path === 'string' && r.path && typeof active.path === 'string' && active.path && inside(r.path, active.path)) ??
        repoList.find((r) => active.project && r.name === active.project))
    // The project last chosen for this YouTrack project, then the server's default, then the current
    // workspace's; one no longer in Orca is skipped. Unreadable memory only skips its step.
    const repo =
      remembered ??
      listed(await fallback(() => ctx.state.serverRepo(s.data.alias), null)) ??
      ofWorkspace
    const data = {
      repos: repoList,
      orcaCli: orcaCli != null,
      defaultRepoId: repo ? repo.id : null,
      name: workspaceName(settingString(await get('branchTemplate'), DEFAULT_BRANCH_TEMPLATE), vars),
      agents: agents ?? { installed: [], other: AGENTS.map((a) => a.id) },
      defaultAgent: AGENT_ID.test(defaultAgent) ? defaultAgent : '',
      launchMode: (await get('defaultLaunchMode')) === 'current' ? 'current' : 'worktree',
      includeDescription: (await get('includeDescription')) === true,
      // Articles the issue mentions, for the Start view's switch; on unless the setting is off.
      articles: (issue.articles ?? []).map((a) => a.id).filter((articleId) => ARTICLE_ID.test(articleId)).slice(0, 20),
      includeArticles: (await get('includeArticles')) !== false,
      withoutPrompt: (await get('startWithoutPrompt')) === true,
      templates: prompts.templates.map(({ id, name, body }) => ({ id, name, body })),
      defaultTemplateId: chosenTemplate ? chosenTemplate.id : null,
      vars,
      workspaces: workspaceItems(workspaces, repoList, ctx.homedir),
      defaultWorkspaceId: linked ?? (active ? active.id : null)
    }
    data.finish = { comment: (await get('finishComment')) === true, ...(await finishFields(s.data.alias, id, issueFields, await get('finishState'))) }
    if (!repos.ok) data.reposError = shortMessage(repos.error.message)
    if (!ws.ok) data.workspacesError = shortMessage(ws.error.message)
    if (!agents) data.agentsError = 'Installed agents could not be detected.'
    return ok(data)
  })

  handle('yt.refs.search', async ({ repoId, query }) => {
    const bad = token(repoId, 'repository')
    if (bad) return invalid(bad)
    if (query != null && (typeof query !== 'string' || query.length > 200)) return invalid('Invalid query')
    if (!orcaCli) return noOrcaCli()
    const r = await orcaCli.searchRefs(repoId, query ?? '')
    return r.ok ? ok({ refs: r.data }) : r
  })

  handle('yt.start.run', async ({ server, id, repoId, name, baseBranch, agent, prompt, finish }) => {
    if (!orcaCli) return noOrcaCli()
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const trimmed = typeof name === 'string' ? name.trim() : name
    const bad = token(repoId, 'repository') ?? token(trimmed, 'name') ?? (baseBranch ? token(baseBranch, 'base branch') : null)
    if (bad) return invalid(bad)
    const launch = checkLaunch({ agent, prompt })
    if (!launch.ok) return launch
    const s = await resolveServer(server)
    if (!s.ok) return s
    const input = { repoId, name: trimmed, issueId: id, issueUrl: issueUrl(s.data.url, id) }
    if (baseBranch) input.baseBranch = baseBranch
    if (launch.data.agent) {
      input.agent = launch.data.agent
      if (launch.data.prompt) input.prompt = launch.data.prompt
    }
    const r = await orcaCli.createWorktree(input)
    if (!r.ok) return r
    const { workspaceId, terminalId, paneKey } = r.data
    const saved = await remember('yt.start.run link', () => links.add(s.data.alias, id, workspaceId, now()))
    // Offered first next time for this YouTrack project; losing it is not worth a warning.
    await fallback(() => ctx.state.rememberProjectRepo(s.data.alias, projectOf(id), repoId), null)
    await rememberFinish(s.data.alias, id, finish)
    let tracked = null
    // The finished-notification matches `agent.status.changed` by terminal, pane or workspace, so keep
    // every id the answer has; without a terminal handle the workspace id stands in for it.
    if (input.agent) {
      const launch = { terminalId: terminalId ?? workspaceId, server: s.data.alias, issueId: id, workspaceId, at: now() }
      if (paneKey) launch.paneKey = paneKey
      tracked = await remember('yt.start.run launch', () => launches.track(launch))
    }
    const warning = saved ?? tracked
    return ok(warning ? { workspaceId, warning } : { workspaceId })
  })

  handle('yt.runInExisting', async ({ server, id, workspaceId, agent, prompt, finish }) => {
    if (typeof id !== 'string' || !ISSUE_ID.test(id)) return invalid('Invalid issue id')
    const bad = token(workspaceId, 'workspace')
    if (bad) return invalid(bad)
    if (typeof agent !== 'string' || !agent) return invalid('Choose an agent')
    const launch = checkLaunch({ agent, prompt })
    if (!launch.ok) return launch
    const s = await resolveServer(server)
    if (!s.ok) return s
    const params = { workspaceId, agent }
    if (launch.data.prompt) params.prompt = launch.data.prompt
    let terminalId = null
    let paneKey = null
    if (orcaCli) {
      // The CLI starts the agent with its prompt in one launch; the host launch hands the prompt over
      // separately, before the agent runs, and loses it.
      const r = await orcaCli.launchAgent(params)
      if (!r.ok) return r
      terminalId = typeof r.data?.terminalId === 'string' ? r.data.terminalId : null
      paneKey = typeof r.data?.paneKey === 'string' ? r.data.paneKey : null
    } else {
      const r = await host('agent.launch', params)
      terminalId = typeof r?.terminalId === 'string' ? r.terminalId : null
    }
    // Without a terminal id the launch is tracked by workspace id (the notifier matches either). With
    // one, other agents may already run in this workspace, so only the terminal or pane counts.
    const tracked = { terminalId: terminalId ?? workspaceId, server: s.data.alias, issueId: id, workspaceId, at: now() }
    if (paneKey) tracked.paneKey = paneKey
    if (terminalId || paneKey) tracked.shared = true
    const warning = await remember('yt.runInExisting launch', () => launches.track(tracked))
    await rememberFinish(s.data.alias, id, finish)
    const data = terminalId ? { terminalId } : {}
    if (warning) data.warning = warning
    return ok(data)
  })

  handle('yt.links', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const snapshotAt = now()
    const { list, truncated } = await listWorkspaces()
    const live = new Set(list.map((w) => w.id))
    if (!truncated) await links.prune(live, snapshotAt)
    const out = await links.forServer(s.data.alias, live)
    // Workspaces the plugin did not start count by the issue id in their branch; saved links win.
    const projects = await serverProjects(s.data.alias)
    const owners = projects ? await fallback(() => links.owners(live), new Map()) : new Map()
    for (const w of list) {
      const id = branchIssue(w.branch, w.id, projects, owners)
      if (id && !(id in out)) out[id] = w.id
    }
    return ok(out)
  })

  /**
   * The issue of the focused workspace: the one the plugin started there, else the one its branch is
   * named after, if this server has it. Never fails: without one the answer is `{ issue: null }`.
   */
  handle('yt.current', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const none = ok({ issue: null })
    let context = null
    try {
      context = await host('workspace.readContext', {})
    } catch {
      return none
    }
    if (!context || typeof context !== 'object') return none
    const { list } = await fallback(() => listWorkspaces(), { list: [] })
    const active = await activeWorkspace(list)
    let id = null
    if (active) {
      const linked = await fallback(() => links.forServer(s.data.alias, new Set([active.id])), {})
      id = Object.keys(linked).find((key) => linked[key] === active.id) ?? null
      // Started for another server's issue: its branch names nothing here.
      const owners = await fallback(() => links.owners(new Set([active.id])), new Map())
      if (!id && owners.get(active.id)?.size) return none
    }
    id ??= issueIdFromBranch(context.branch)
    if (!id) return none
    const view = await attempt(() => ctx.youtrack.viewIssue(s.data.alias, id))
    if (!view.ok || !hasId(view.data)) return none
    const issue = { id: view.data.idReadable, summary: String(view.data.summary ?? '').slice(0, 500), url: issueUrl(s.data.url, view.data.idReadable) }
    return ok(active ? { issue, workspaceId: active.id } : { issue })
  })

  handle('yt.workspace.open', async ({ workspaceId }) => {
    const bad = token(workspaceId, 'workspace')
    if (bad) return invalid(bad)
    try {
      await host('workspace.open', { workspaceId })
    } catch (e) {
      // A workspace removed since the links were read cannot open: forget it so the issue offers Start.
      const snapshotAt = now()
      const listed = await fallback(() => listWorkspaces(), null)
      if (!listed || listed.truncated || listed.list.some((w) => w.id === workspaceId)) throw e
      await links.prune(new Set(listed.list.map((w) => w.id)), snapshotAt)
      return fail(CODES.NOT_FOUND, 'That workspace no longer exists.')
    }
    return ok({})
  })
}
