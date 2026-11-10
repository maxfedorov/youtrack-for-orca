/** Wrapper around the bundled Orca CLI: locating the binary, listing repos and branches, creating worktrees, launching agents. */
import path from 'node:path'
import { ok, fail, CODES } from './result.mjs'
import { findOnPath, runProcess } from './exec.mjs'

const READ_MS = 15_000
const CREATE_MS = 60_000
// The launch waits until the prompt is handed to the agent; the panel waits up to two minutes.
const LAUNCH_MS = 90_000
const REFS_LIMIT = '200'

/**
 * Locate the Orca CLI: bundled in the app resources, else on PATH
 * (linux: `orca-ide` only, the bare `orca` name belongs to a screen reader there).
 * @param {{ resourcesPath?: string, platform: string, env: Record<string, string | undefined>, exists: (p: string) => boolean }} o
 * @returns {string | null}
 */
export function resolveOrcaCli({ resourcesPath, platform, env, exists }) {
  const win = platform === 'win32'
  const linux = platform === 'linux'
  const name = win ? 'orca.exe' : linux ? 'orca-ide' : 'orca'
  if (resourcesPath) {
    const bundled = (win ? path.win32 : path.posix).join(resourcesPath, 'bin', name)
    if (exists(bundled)) return bundled
  }
  return findOnPath(linux ? 'orca-ide' : 'orca', { env, platform, exists })
}

/**
 * @param {{ bin?: string, run?: (args: string[], opts: { timeoutMs: number }) => Promise<import('./exec.mjs').ProcResult> }} o
 */
/**
 * A flag and its free-text value as one `--flag=value` argument: the Orca CLI reads a separate value
 * that starts with `--` as the next flag, which would fail on a prompt opening with `---`.
 */
const value = (flag, text) => `--${flag}=${text}`

export function createOrcaCli({ bin, run = (args, opts) => runProcess(bin, args, opts) }) {
  /** Run a command and unwrap the `{ ok, result }` envelope printed on stdout. */
  async function exec(args, timeoutMs) {
    const r = await run(args, { timeoutMs })
    if (r.timedOut) return fail(CODES.TIMEOUT, 'The Orca CLI did not answer in time.')
    if (r.spawnError) return fail(CODES.ORCA_CLI_NOT_FOUND, 'The Orca CLI could not be started.')
    let env = null
    try {
      env = JSON.parse(r.stdout)
    } catch {
      // not an envelope
    }
    if (env && env.ok === true && r.exitCode === 0) return ok(env.result ?? {})
    const message = env?.error?.message || String(r.stderr ?? '').trim() || 'The Orca CLI failed.'
    return fail(CODES.ORCA_CLI_FAILED, message)
  }

  const mapOk = (res, fn) => (res.ok ? ok(fn(res.data)) : res)
  /** The CLI's JSON may be missing a list or hold another shape there. */
  const arrayOf = (v) => (Array.isArray(v) ? v : [])

  return {
    repos: async () =>
      mapOk(await exec(['repo', 'list', '--json'], READ_MS), (d) =>
        arrayOf(d?.repos)
          .filter((r) => r !== null && typeof r === 'object' && typeof r.id === 'string' && r.id !== '')
          .map((r) => {
            const item = { id: r.id, name: typeof r.displayName === 'string' && r.displayName ? r.displayName : r.id }
            if (typeof r.path === 'string') item.path = r.path
            if (typeof r.worktreeBaseRef === 'string' && r.worktreeBaseRef) item.worktreeBaseRef = r.worktreeBaseRef
            return item
          })
      ),

    searchRefs: async (repoId, query) =>
      mapOk(
        await exec(['repo', 'search-refs', '--repo', `id:${repoId}`, value('query', query || ' '), '--limit', REFS_LIMIT, '--json'], READ_MS),
        (d) => arrayOf(d?.refs).filter((ref) => typeof ref === 'string' && ref !== '')
      ),

    createWorktree: async ({ repoId, name, baseBranch, agent, prompt, issueId, issueUrl }) => {
      const args = ['worktree', 'create', '--repo', `id:${repoId}`, value('name', name)]
      if (baseBranch) args.push(value('base-branch', baseBranch))
      args.push('--no-parent', '--activate', value('comment', `${issueId} ${issueUrl}`))
      if (agent) {
        args.push('--agent', agent)
        if (typeof prompt === 'string' && prompt.trim()) args.push(value('prompt', prompt))
      }
      args.push('--json')
      const res = await exec(args, CREATE_MS)
      if (!res.ok) return res
      const wt = res.data.worktree
      if (!wt?.identity?.key) return fail(CODES.ORCA_CLI_FAILED, 'The Orca CLI returned an unexpected answer.')
      const out = {
        workspaceId: `identity:${wt.identity.key}`,
        name: wt.displayName ?? name,
        branch: String(wt.branch ?? '').replace(/^refs\/heads\//, '')
      }
      if (typeof wt.path === 'string') out.path = wt.path
      const outcome = res.data.launch?.outcome
      if (typeof outcome?.handle === 'string' && outcome.handle) out.terminalId = outcome.handle
      if (typeof outcome?.paneKey === 'string' && outcome.paneKey) out.paneKey = outcome.paneKey
      return ok(out)
    },

    /**
     * Start an agent in an existing workspace with its prompt in one launch, as a terminal (its id is
     * what the finished notification matches).
     */
    launchAgent: async ({ workspaceId, agent, prompt }) => {
      const args = ['agent', 'launch', '--agent', agent, '--worktree', workspaceId, '--surface', 'terminal']
      if (typeof prompt === 'string' && prompt.trim()) args.push(value('prompt', prompt))
      args.push('--json')
      const res = await exec(args, LAUNCH_MS)
      if (!res.ok) return res
      const outcome = res.data.outcome
      const out = {}
      if (typeof outcome?.handle === 'string' && outcome.handle) out.terminalId = outcome.handle
      if (typeof outcome?.paneKey === 'string' && outcome.paneKey) out.paneKey = outcome.paneKey
      return ok(out)
    },

    openPanel: async (pluginId, panelId) => {
      const list = await exec(['plugin', 'list', '--json'], READ_MS)
      if (!list.ok) return list
      const key = arrayOf(list.data?.plugins)
        .map((p) => p?.pluginKey)
        .find((k) => typeof k === 'string' && (k === pluginId || k.endsWith(`.${pluginId}`)))
      if (!key) return fail(CODES.ORCA_CLI_FAILED, 'The plugin is not installed in Orca.')
      return mapOk(await exec(['plugin', 'open', key, '--panel', panelId, '--json'], READ_MS), () => ({}))
    }
  }
}
