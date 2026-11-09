import { atom, read, set } from 'orca'
import { buildPrompt, PROMPT_LIMIT } from '../worker/prompt.mjs'
import { loadLinks } from './listState'
import { call, notice, server, view } from './state'
import type { Repo, StartPrepare } from './protocol'

export const OTHER = '__other__'
export const NONE = '__none__'
/** Select option value of the project default branch (a Select option cannot have an empty value). */
export const PROJECT_DEFAULT = '__default__'
export const DEBOUNCE_MS = 300
export { PROMPT_LIMIT }

export type Mode = 'worktree' | 'current'
type Status = 'idle' | 'loading' | 'ok' | 'error'

export const prep = atom<StartPrepare | null>(null)
export const status = atom<Status>('idle')
export const failure = atom('')
/** The issue the atoms of this view belong to; null when nothing is loaded. */
export const loadedFor = atom<string | null>(null)

export const mode = atom<Mode>('worktree')
export const repoId = atom<string | null>(null)
export const name = atom('')
/** Chosen base branch; '' is the project default. */
export const baseBranch = atom('')
export const filter = atom('')
export const refs = atom<string[]>([])
export const refsError = atom('')
export const workspaceId = atom<string | null>(null)
/** An agent id, OTHER or NONE. */
export const agentChoice = atom(NONE)
export const otherAgent = atom('')
export const includeDescription = atom(true)
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

export const repoOf = (list: Repo[], id: string | null) => list.find((repo) => repo.id === id)

export function templatePrompt(p: StartPrepare, include: boolean): string {
  return buildPrompt({ template: p.promptTemplate, vars: p.vars, includeDescription: include, description: p.vars.description ?? '' })
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

function init(p: StartPrepare): void {
  const known = p.agents.installed.includes(p.defaultAgent) || p.agents.other.includes(p.defaultAgent)
  set(prep, p)
  set(mode, p.orcaCli ? p.launchMode : 'current')
  set(repoId, p.defaultRepoId)
  set(name, p.name)
  resetBranch()
  set(workspaceId, p.defaultWorkspaceId)
  set(agentChoice, p.defaultAgent && (known || /^[a-z0-9][a-z0-9-]{0,63}$/.test(p.defaultAgent)) ? p.defaultAgent : NONE)
  set(otherAgent, '')
  set(includeDescription, p.includeDescription)
  set(promptEdited, false)
  set(prompt, templatePrompt(p, p.includeDescription))
  set(running, false)
  set(runError, '')
  set(startPending, false)
}

export async function load(id: string): Promise<void> {
  const current = read(server)
  if (!current) return
  const mine = ++seq
  set(loadedFor, id)
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
  if (read(loadedFor) === id || queued === id) return
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
