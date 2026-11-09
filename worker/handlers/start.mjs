/** Requests about starting work: repos, workspaces, agent launches, terminals. */
import { ok, fail, CODES } from '../result.mjs'
import { toIssueDetail } from '../mapping.mjs'
import { issueVars, workspaceName, PROMPT_LIMIT } from '../prompt.mjs'
import { guard, invalid, token, issueUrl, ISSUE_ID, settingString, isPlainUrl, capDetail, AGENT_ID } from './common.mjs'

const DEFAULT_BRANCH_TEMPLATE = '{{id_lower}}-{{summary_slug}}'
const INSTALL = {
  darwin: 'brew install jetbrains/utils/youtrack',
  linux: 'brew install jetbrains/utils/youtrack',
  win32: 'winget install JetBrains.YouTrackCLI'
}
const noOrcaCli = () => fail(CODES.ORCA_CLI_NOT_FOUND, 'The Orca CLI was not found.')
const tooLong = () => fail(CODES.PROMPT_TOO_LONG, `Prompt is longer than ${PROMPT_LIMIT} characters`)
const shortBranch = (b) => String(b ?? '').replace(/^refs\/heads\//, '')

const inside = (dir, p) => p === dir || p.startsWith(dir.replace(/[\\/]+$/, '') + '/') || p.startsWith(dir.replace(/[\\/]+$/, '') + '\\')

export function registerStartHandlers(ctx) {
  const { orca, youtrack, orcaCli, links, launches, detectAgents, now, platform, resolveServer } = ctx
  const handle = (name, fn) => orca.panels.handle(name, guard(fn))
  const host = (method, params) => orca.host.call(method, params)

  async function listWorkspaces() {
    const r = await host('workspace.list', {})
    return { list: Array.isArray(r?.workspaces) ? r.workspaces : [], truncated: r?.truncated === true }
  }

  /** The focused workspace: readContext has no id, so match branch and name against the list. */
  async function activeWorkspace(list) {
    let c = null
    try {
      c = await host('workspace.readContext', {})
    } catch {
      return null
    }
    if (!c) return null
    return list.find((w) => shortBranch(w.branch) === shortBranch(c.branch) && w.name === c.displayName) ?? null
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
    const [view, repos, ws] = await Promise.all([
      youtrack.viewIssue(s.data.alias, id),
      orcaCli ? orcaCli.repos() : Promise.resolve(ok([])),
      listWorkspaces()
    ])
    if (!view.ok) return view
    const issue = capDetail(toIssueDetail(view.data, null, s.data.url))
    const vars = issueVars({ issue, server: s.data.alias, branch: '' })
    const get = (k) => orca.settings.get(k)
    const agents = detectAgents()
    const defaultAgent = settingString(await get('defaultAgent'), '')
    const active = await activeWorkspace(ws.list)
    const repoList = repos.ok ? repos.data : []
    const repo =
      active &&
      (repoList.find((r) => r.path && active.path && inside(r.path, active.path)) ??
        repoList.find((r) => active.project && r.name === active.project))
    const data = {
      repos: repoList,
      orcaCli: orcaCli != null,
      defaultRepoId: repo ? repo.id : null,
      name: workspaceName(settingString(await get('branchTemplate'), DEFAULT_BRANCH_TEMPLATE), vars),
      agents,
      defaultAgent: AGENT_ID.test(defaultAgent) ? defaultAgent : '',
      launchMode: (await get('defaultLaunchMode')) === 'current' ? 'current' : 'worktree',
      includeDescription: (await get('includeDescription')) === true,
      promptTemplate: settingString(await get('promptTemplate'), ''),
      vars,
      workspaces: ws.list.map((w) => {
        const item = { id: w.id, name: w.name }
        if (typeof w.project === 'string') item.project = w.project
        if (typeof w.branch === 'string') item.branch = shortBranch(w.branch)
        return item
      }),
      defaultWorkspaceId: active ? active.id : null
    }
    if (!repos.ok) data.reposError = repos.error.message
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

  handle('yt.start.run', async ({ server, id, repoId, name, baseBranch, agent, prompt }) => {
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
    const { workspaceId } = r.data
    await links.add(s.data.alias, id, workspaceId, now())
    // createWorktree does not expose the agent's terminal id, so the workspace id is stored as the
    // terminal id; the finished-notification matches `agent.status.changed` by terminal or workspace.
    if (input.agent) await launches.track({ terminalId: workspaceId, server: s.data.alias, issueId: id, workspaceId, at: now() })
    return ok({ workspaceId })
  })

  handle('yt.runInExisting', async ({ server, id, workspaceId, agent, prompt }) => {
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
    const r = await host('agent.launch', params)
    // Without a terminal id the launch is tracked by workspace id (the notifier matches either).
    const terminalId = typeof r?.terminalId === 'string' ? r.terminalId : null
    await launches.track({ terminalId: terminalId ?? workspaceId, server: s.data.alias, issueId: id, workspaceId, at: now() })
    return ok(terminalId ? { terminalId } : {})
  })

  handle('yt.links', async ({ server }) => {
    const s = await resolveServer(server)
    if (!s.ok) return s
    const { list, truncated } = await listWorkspaces()
    const live = new Set(list.map((w) => w.id))
    if (!truncated) await links.prune(live)
    return ok(await links.forServer(s.data.alias, live))
  })

  handle('yt.workspace.open', async ({ workspaceId }) => {
    const bad = token(workspaceId, 'workspace')
    if (bad) return invalid(bad)
    await host('workspace.open', { workspaceId })
    return ok({})
  })

  handle('yt.terminal.run', async ({ command, url }) => {
    let line
    if (command === 'install') {
      line = INSTALL[platform]
      if (!line) return invalid('Automatic install is not supported on this system.')
    } else if (command === 'login') {
      if (!isPlainUrl(url)) return invalid('Enter a server address like https://example.youtrack.cloud')
      line = `youtrack auth login ${url}`
    } else {
      return invalid('Unknown terminal command')
    }
    const { list } = await listWorkspaces()
    const active = await activeWorkspace(list)
    if (!active) return invalid('Open a workspace first.')
    await host('terminal.create', { workspaceId: active.id, title: 'YouTrack', command: line })
    return ok({})
  })
}
