import { atom, read, set } from 'orca'
import { call, here, refreshTick, server, view, type View } from './state'
import type { ArticleNode } from './protocol'

type Status = 'idle' | 'loading' | 'ok' | 'error'
type Project = { shortName: string; name: string }

export const projects = atom<Project[]>([])
export const projectsError = atom('')
/** Short name of the project whose articles are shown. */
export const project = atom<string | null>(null)
export const roots = atom<ArticleNode[]>([])
export const rootsCut = atom(false)
export const rootsStatus = atom<Status>('idle')
export const rootsError = atom('')
/** Loaded sub-articles by article id; an article is in it once its children were read. */
export const children = atom<Record<string, ArticleNode[]>>({})
/** Why the sub-articles of an article could not be read, by article id. */
export const childErrors = atom<Record<string, string>>({})
/** Open tree items, kept here so they survive leaving the list and coming back. */
export const expanded = atom<string[]>([])
/** Text in the search field, and the search the results belong to ('' with favorites off: the tree). */
export const searchText = atom('')
export const appliedSearch = atom('')
export const favorites = atom(false)
export const results = atom<ArticleNode[]>([])
export const resultsCut = atom(false)
export const resultsStatus = atom<Status>('idle')
export const resultsError = atom('')
/** The server the atoms above belong to; null when nothing is loaded. */
const loadedFor = atom<string | null>(null)

let seq = 0
/** Bumped by every search, so only the newest one shows its results. */
let searchSeq = 0
let seenTick = 0
let queued = false

/** A search or favorites is on: results are shown as a list instead of the tree. */
export const searching = () => read(appliedSearch) !== '' || read(favorites)

/** Opens an article; Back returns to the screen it was opened from. */
export const openArticle = (id: string, back: View = here()) => set(view, { kind: 'article', articleId: id, back })

/** Forgets everything shown for the previous server. */
export function resetArticles(): void {
  seq++
  set(loadedFor, null)
  set(projects, [])
  set(projectsError, '')
  set(project, null)
  clearTree()
  set(searchText, '')
  set(appliedSearch, '')
  set(favorites, false)
  clearResults()
}

function clearTree(): void {
  set(roots, [])
  set(rootsCut, false)
  set(rootsStatus, 'idle')
  set(rootsError, '')
  set(children, {})
  set(childErrors, {})
  set(expanded, [])
}

function clearResults(): void {
  set(results, [])
  set(resultsCut, false)
  set(resultsStatus, 'idle')
  set(resultsError, '')
}

/** Called while rendering: loads when the server changed or the header's refresh was pressed. */
export function syncArticles(): void {
  const stale = read(loadedFor) !== read(server)
  if ((!stale && read(refreshTick) === seenTick) || queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    void loadArticles()
  })
}

/** The projects, the one shown last on this server (else the first), and its articles. */
export async function loadArticles(): Promise<void> {
  const alias = read(server)
  if (!alias) return
  const mine = ++seq
  seenTick = read(refreshTick)
  const reload = read(loadedFor) === alias
  set(loadedFor, alias)
  set(rootsStatus, 'loading')
  if (!reload) clearTree()
  const [list, remembered] = await Promise.all([call('yt.projects', { server: alias }), call('yt.articles.project', { server: alias })])
  if (mine !== seq) return
  if (!list.ok) {
    set(projectsError, list.message)
    set(rootsStatus, 'error')
    set(rootsError, list.message)
    return
  }
  set(projects, list.data.projects)
  set(projectsError, '')
  const names = list.data.projects.map((p) => p.shortName)
  const wanted = read(project) ?? (remembered.ok ? remembered.data.project : null)
  const chosen = wanted && names.includes(wanted) ? wanted : (names[0] ?? null)
  set(project, chosen)
  if (!chosen) {
    set(rootsStatus, 'ok')
    set(roots, [])
    return
  }
  // A refresh reads the open branches again.
  if (reload) set(children, {})
  await Promise.all([loadRoots(), searching() ? runSearch() : Promise.resolve(), ...(reload ? read(expanded).map(loadChildren) : [])])
}

export async function loadRoots(): Promise<void> {
  const alias = read(server)
  const p = read(project)
  if (!alias || !p) return
  const mine = seq
  set(rootsStatus, 'loading')
  const answer = await call('yt.articles.roots', { server: alias, project: p })
  if (mine !== seq) return
  if (answer.ok) {
    set(roots, answer.data.articles)
    set(rootsCut, answer.data.cut === true)
    set(rootsError, '')
    set(rootsStatus, 'ok')
  } else {
    set(rootsError, answer.message)
    set(rootsStatus, 'error')
  }
}

async function loadChildren(id: string): Promise<void> {
  const alias = read(server)
  if (!alias) return
  const mine = seq
  const answer = await call('yt.articles.children', { server: alias, id })
  if (mine !== seq) return
  const { [id]: _old, ...errors } = read(childErrors)
  if (answer.ok) {
    set(children, { ...read(children), [id]: answer.data.articles })
    set(childErrors, errors)
  } else {
    set(childErrors, { ...errors, [id]: answer.message })
    // Closed again, so opening it once more retries.
    set(expanded, read(expanded).filter((key) => key !== id))
  }
}

/** Opens or closes a tree item; its children are read the first time it opens. */
export function toggleArticle(id: string, open: boolean): void {
  const keys = read(expanded).filter((key) => key !== id)
  set(expanded, open ? [...keys, id] : keys)
  if (open && !(id in read(children))) void loadChildren(id)
}

export async function chooseProject(shortName: string): Promise<void> {
  const alias = read(server)
  if (!alias || shortName === read(project)) return
  seq++
  set(project, shortName)
  clearTree()
  clearResults()
  void call('yt.articles.setProject', { server: alias, project: shortName })
  await Promise.all([loadRoots(), searching() ? runSearch() : Promise.resolve()])
}

/** Runs the search field's text (and favorites); with neither, the tree is shown again. */
export async function runSearch(text: string = read(searchText)): Promise<void> {
  const alias = read(server)
  const p = read(project)
  set(appliedSearch, text.trim())
  if (!searching()) {
    searchSeq++
    return clearResults()
  }
  if (!alias || !p) return
  const mine = seq
  const search = ++searchSeq
  set(resultsStatus, 'loading')
  const answer = await call('yt.articles.search', { server: alias, project: p, query: read(appliedSearch), favorites: read(favorites) })
  if (mine !== seq || search !== searchSeq) return
  if (answer.ok) {
    set(results, answer.data.articles)
    set(resultsCut, answer.data.cut === true)
    set(resultsError, '')
    set(resultsStatus, 'ok')
  } else {
    set(resultsError, answer.message)
    set(resultsStatus, 'error')
  }
}

export function toggleFavorites(): void {
  set(favorites, !read(favorites))
  void runSearch()
}
