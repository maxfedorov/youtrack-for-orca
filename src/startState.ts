import { atom, read, set } from 'orca'
import { buildPrompt, issueVars, PROMPT_LIMIT } from '../worker/prompt.mjs'
import { loadLinks } from './listState'
import { call, notice, server, view } from './state'
import { closeComboboxes } from './views/Combobox'
import type { Repo, StartPrepare, WorkspaceItem } from './protocol'

export const OTHER = '__other__'
export const NONE = '__none__'
/** Option value of the project default branch (an option cannot have an empty value). */
export const PROJECT_DEFAULT = '__default__'
export const DEBOUNCE_MS = 300
export { PROMPT_LIMIT }

export type Mode = 'worktree' | 'current'
type Status = 'idle' | 'loading' | 'ok' | 'error'

export const prep = atom<StartPrepare | null>(null)
export const status = atom<Status>('idle')
export const failure = atom('')
/** The server and issue (`alias|id`) the atoms of this view belong to; null when nothing is loaded. */
export const loadedFor = atom<string | null>(null)

export const mode = atom<Mode>('worktree')
export const repoId = atom<string | null>(null)
export const name = atom('')
/** Chosen base branch; '' is the project default. */
export const baseBranch = atom('')
export const filter = atom('')
export const refs = atom<string[]>([])
export const refsError = atom('')
/** The filter text the branch list answers; null while the first search runs. */
export const refsFor = atom<string | null>(null)
export const workspaceId = atom<string | null>(null)
/** An agent id, OTHER or NONE. */
export const agentChoice = atom(NONE)
export const otherAgent = atom('')
export const includeDescription = atom(true)
/** The chosen prompt template; null when the answer listed none (the prompt template text is used). */
export const templateId = atom<string | null>(null)
export const prompt = atom('')
export const promptEdited = atom(false)
export const running = atom(false)
export const runError = atom('')
/** The last start timed out and may still be running; Start stays off until the form is reloaded. */
export const startPending = atom(false)
export const STILL_STARTING = 'Still starting — check the Orca sidebar before trying again.'

let seq = 0
let refsSeq = 0
let timer: ReturnType<typeof setTimeout> | null = null
let queued: string | null = null

/**
 * Workspace choices named "<project> / <name>", described by the branch (when it is not the name) and
 * the path. The current workspace comes first, then the rest of its project, then the other projects
 * by name; workspaces without a project come last.
 */
export function workspaceOptions(list: readonly WorkspaceItem[], currentId: string | null): { value: string; label: string; description?: string }[] {
  const home = list.find((item) => item.id === currentId)?.project
  const rank = (item: WorkspaceItem) =>
    item.id === currentId ? 0 : !item.project ? 3 : item.project === home ? 1 : 2
  const sorted = [...list].sort(
    (a, b) => rank(a) - rank(b) || (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name)
  )
  return sorted.map((item) => {
    const prefix = item.project && item.project !== item.name ? `${item.project} / ` : ''
    const label = `${prefix}${item.name}${item.id === currentId ? ' (current)' : ''}`
    const description = [item.branch && item.branch !== item.name ? item.branch : '', item.path ?? ''].filter(Boolean).join(' · ')
    return description ? { value: item.id, label, description } : { value: item.id, label }
  })
}

export const repoOf = (list: Repo[], id: string | null) => list.find((repo) => repo.id === id)

/** Every issue variable the templates know; one the answer left out is empty text. */
const EMPTY_VARS: Record<string, string> = issueVars({ issue: null, server: '' })

/** Text of the chosen template, or the prompt template when none is chosen. */
const templateText = (p: StartPrepare, id: string | null) => (p.templates ?? []).find((t) => t.id === id)?.body ?? p.promptTemplate

export function templatePrompt(p: StartPrepare, include: boolean, id: string | null = read(templateId)): string {
  const vars = { ...EMPTY_VARS, ...p.vars }
  return buildPrompt({ template: templateText(p, id), vars, includeDescription: include, description: vars.description })
}

/** Another template: the prompt is built from it again, unless it was edited by hand. */
export function chooseTemplate(id: string): void {
  set(templateId, id)
  const p = read(prep)
  if (p && !read(promptEdited)) set(prompt, templatePrompt(p, read(includeDescription), id))
}

/** The agent id to send, or undefined for terminal only or an empty custom id. */
export function chosenAgent(): string | undefined {
  const choice = read(agentChoice)
  if (choice === NONE) return undefined
  if (choice === OTHER) return read(otherAgent).trim() || undefined
  return choice
}

export function canStart(): { ok: boolean; hint: string } {
  const agent = chosenAgent()
  const wantsOther = read(agentChoice) === OTHER && !agent
  if (read(running) || read(startPending)) return { ok: false, hint: '' }
  const p = read(prep)
  if (p && !(read(mode) === 'worktree' ? worktreeAvailable(p) : currentAvailable(p))) return { ok: false, hint: '' }
  if (read(mode) === 'worktree') {
    if (!read(repoId) || !read(name).trim()) return { ok: false, hint: '' }
  } else if (!read(workspaceId)) {
    return { ok: false, hint: '' }
  } else if (!agent) {
    return { ok: false, hint: 'Choose an agent to run in the current workspace.' }
  }
  if (wantsOther) return { ok: false, hint: '' }
  if (agent && read(prompt).length > PROMPT_LIMIT) return { ok: false, hint: '' }
  return { ok: true, hint: '' }
}

function cancelRefs(): void {
  refsSeq++
  if (timer) clearTimeout(timer)
  timer = null
}

/** Forgets the base branch choice and the filter; the project default applies again. */
export function resetBranch(): void {
  cancelRefs()
  set(baseBranch, '')
  set(filter, '')
  set(refs, [])
  set(refsError, '')
  set(refsFor, null)
  void searchRefs('')
}

export function setProject(id: string): void {
  set(repoId, id)
  resetBranch()
}

async function searchRefs(text: string): Promise<void> {
  const id = read(repoId)
  if (!id) return
  const mine = ++refsSeq
  const answer = await call('yt.refs.search', { repoId: id, query: text })
  if (mine !== refsSeq) return
  set(refsError, answer.ok ? '' : answer.message)
  set(refs, answer.ok ? answer.data.refs : [])
  set(refsFor, text)
}

/** Typing in the filter; the search runs once typing paused. */
export function setFilter(text: string): void {
  set(filter, text)
  cancelRefs()
  timer = setTimeout(() => {
    timer = null
    void searchRefs(text)
  }, DEBOUNCE_MS)
}

/** The filter and its results stay, so the choice can be changed without typing again. '' is the project default. */
export function chooseRef(ref: string): void {
  set(baseBranch, ref)
}

export function toggleDescription(include: boolean): void {
  set(includeDescription, include)
  const p = read(prep)
  if (p && !read(promptEdited)) set(prompt, templatePrompt(p, include))
}

export function editPrompt(text: string): void {
  set(prompt, text)
  set(promptEdited, true)
}

export function resetPrompt(): void {
  const p = read(prep)
  if (!p) return
  set(promptEdited, false)
  set(prompt, templatePrompt(p, read(includeDescription)))
}

/** New worktrees need the Orca CLI and the project list; the current workspace needs the workspace list. */
export const worktreeAvailable = (p: StartPrepare) => p.orcaCli && !p.reposError
export const currentAvailable = (p: StartPrepare) => !p.workspacesError

/** The preferred mode, unless only the other one can be used. */
export function usableMode(p: StartPrepare, wanted: Mode): Mode {
  if (wanted === 'worktree' && !worktreeAvailable(p) && currentAvailable(p)) return 'current'
  if (wanted === 'current' && !currentAvailable(p) && worktreeAvailable(p)) return 'worktree'
  return wanted
}

function init(p: StartPrepare): void {
  const known = p.agents.installed.includes(p.defaultAgent) || p.agents.other.includes(p.defaultAgent)
  closeComboboxes()
  set(prep, p)
  set(mode, usableMode(p, p.orcaCli ? p.launchMode : 'current'))
  set(repoId, p.defaultRepoId)
  set(name, p.name)
  resetBranch()
  set(workspaceId, p.defaultWorkspaceId)
  set(agentChoice, p.defaultAgent && (known || /^[a-z0-9][a-z0-9-]{0,63}$/.test(p.defaultAgent)) ? p.defaultAgent : NONE)
  set(otherAgent, '')
  set(includeDescription, p.includeDescription)
  const templates = p.templates ?? []
  const chosen = templates.find((t) => t.id === p.defaultTemplateId) ?? templates[0]
  set(templateId, chosen ? chosen.id : null)
  set(promptEdited, false)
  set(prompt, templatePrompt(p, p.includeDescription, chosen ? chosen.id : null))
  set(running, false)
  set(runError, '')
  set(startPending, false)
}

export async function load(id: string): Promise<void> {
  const current = read(server)
  if (!current) return
  const mine = ++seq
  set(loadedFor, `${current}|${id}`)
  set(status, 'loading')
  const answer = await call('yt.start.prepare', { server: current, id })
  if (mine !== seq) return
  if (answer.ok) {
    init(answer.data)
    set(failure, '')
    set(status, 'ok')
  } else {
    set(failure, answer.message)
    set(status, 'error')
  }
}

/** Called while rendering (state cannot change there, so loading is queued): loads when the issue changed. */
export function sync(id: string): void {
  if (read(loadedFor) === `${read(server)}|${id}` || queued === id) return
  queued = id
  queueMicrotask(() => {
    queued = null
    void load(id)
  })
}

/** Back to the list. */
export function back(): void {
  if (read(running)) return
  seq++
  cancelRefs()
  closeComboboxes()
  set(loadedFor, null)
  set(prep, null)
  set(status, 'idle')
  set(view, { kind: 'list' })
}

export async function submit(id: string): Promise<void> {
  const current = read(server)
  if (!current || !canStart().ok) return
  const agent = chosenAgent()
  const text = read(prompt)
  const mine = seq
  set(running, true)
  set(runError, '')
  let answer: { ok: true; data: { warning?: string } } | { ok: false; code: string; message: string }
  if (read(mode) === 'worktree') {
    const base = read(baseBranch)
    answer = await call('yt.start.run', {
      server: current, id, repoId: read(repoId) ?? '', name: read(name).trim(),
      ...(base ? { baseBranch: base } : {}),
      ...(agent ? { agent, prompt: text } : {})
    })
  } else {
    answer = await call('yt.runInExisting', { server: current, id, workspaceId: read(workspaceId) ?? '', agent: agent ?? '', prompt: text })
  }
  if (mine !== seq) return
  set(running, false)
  if (!answer.ok) {
    // A timeout does not mean it failed: the worktree or agent may still appear.
    if (answer.code === 'TIMEOUT') set(startPending, true)
    set(runError, answer.code === 'TIMEOUT' ? STILL_STARTING : answer.message)
    return
  }
  back()
  if (answer.data.warning) set(notice, answer.data.warning)
  void loadLinks()
}
