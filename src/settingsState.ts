import { atom, read, set } from 'orca'
import { call, view, type Unwrapped } from './state'
import { closeComboboxes } from './views/Combobox'
import type { Template, Templates } from './protocol'

export const MAX_TEMPLATE_NAME = 60
export const MAX_TEMPLATE_BODY = 8000

type Status = 'idle' | 'loading' | 'ok' | 'error'

export const templatesStatus = atom<Status>('idle')
export const templates = atom<Template[]>([])
export const defaultTemplateId = atom('')
/** Why the templates could not be loaded (with Retry). */
export const templatesLoadError = atom('')
/** Why the last change (default, delete, restore) failed. */
export const templatesError = atom('')
export const templatesBusy = atom(false)

/** The template being written: `id` null for a new one. */
export type Draft = { id: string | null; name: string; body: string }
export const draft = atom<Draft | null>(null)
export const draftError = atom('')
/** The template waiting for the person to confirm its deletion. */
export const deleting = atom<string | null>(null)

let seq = 0

function show(data: Templates): void {
  set(templates, data.templates)
  set(defaultTemplateId, data.defaultId)
}

export async function loadTemplates(): Promise<void> {
  const mine = ++seq
  set(templatesStatus, 'loading')
  const answer = await call('yt.templates', {})
  if (mine !== seq) return
  if (answer.ok) {
    show(answer.data)
    set(templatesLoadError, '')
    set(templatesStatus, 'ok')
  } else {
    set(templatesLoadError, answer.message)
    set(templatesStatus, 'error')
  }
}

/** Opens the settings view: prompt templates and servers. */
export function openSettings(): void {
  closeComboboxes()
  set(draft, null)
  set(deleting, null)
  set(templatesError, '')
  set(view, { kind: 'settings' })
  void loadTemplates()
  for (const listener of onOpen) listener()
}

/** Other parts of the settings view that load when it opens. */
const onOpen: (() => void)[] = []
export const whenSettingsOpen = (listener: () => void) => void onOpen.push(listener)

export function closeSettings(): void {
  if (read(templatesBusy)) return
  closeComboboxes()
  set(draft, null)
  set(deleting, null)
  set(view, { kind: 'list' })
}

/** One change at a time; the list shows the worker's answer, a failure its reason. */
async function change(request: () => Promise<Unwrapped<Templates>>): Promise<boolean> {
  if (read(templatesBusy)) return false
  set(templatesBusy, true)
  set(templatesError, '')
  const answer = await request()
  set(templatesBusy, false)
  if (!answer.ok) {
    set(templatesError, answer.message)
    return false
  }
  show(answer.data)
  return true
}

export const makeDefault = (id: string) => void change(() => call('yt.templates.setDefault', { id }))
export const restoreBuiltIns = () => void change(() => call('yt.templates.restore', {}))

export function askDelete(id: string): void {
  set(templatesError, '')
  set(deleting, id)
}
export const cancelDelete = () => set(deleting, null)
export async function confirmDelete(): Promise<void> {
  const id = read(deleting)
  if (!id) return
  set(deleting, null)
  await change(() => call('yt.templates.delete', { id }))
}

export function newTemplate(): void {
  set(deleting, null)
  set(draftError, '')
  set(draft, { id: null, name: '', body: '' })
}

export function editTemplate(template: Template): void {
  set(deleting, null)
  set(draftError, '')
  set(draft, { id: template.id, name: template.name, body: template.body })
}

export function editDraft(next: Partial<Draft>): void {
  const current = read(draft)
  if (current) set(draft, { ...current, ...next })
}

export const cancelDraft = () => {
  if (!read(templatesBusy)) set(draft, null)
}

export const draftReady = (d: Draft) => d.name.trim() !== '' && d.body.trim() !== '' && d.name.length <= MAX_TEMPLATE_NAME && d.body.length <= MAX_TEMPLATE_BODY

export async function saveDraft(): Promise<void> {
  const d = read(draft)
  if (!d || !draftReady(d) || read(templatesBusy)) return
  set(templatesBusy, true)
  set(draftError, '')
  const answer = await call('yt.templates.save', { ...(d.id ? { id: d.id } : {}), name: d.name.trim(), body: d.body })
  set(templatesBusy, false)
  if (!answer.ok) {
    set(draftError, answer.message)
    return
  }
  show(answer.data)
  set(draft, null)
}
