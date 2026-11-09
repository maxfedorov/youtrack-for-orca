import { atom, read, set, update } from 'orca'
import { call, env, query, refreshTick, server } from './state'
import type { IssueRow, SavedQuery } from './protocol'

export const PAGE_SIZE = 50
export const MAX_ISSUES = 500

export type ListStatus = 'idle' | 'loading' | 'ok' | 'invalid' | 'error'

/** Loaded rows of the current search; kept while the detail view is open. */
export const issues = atom<IssueRow[]>([])
/** Number of issues the query matches (rows.length when the worker could not count). */
export const total = atom(0)
/** False when the worker could not count: `total` then only holds the first page's length. */
export const totalKnown = atom(false)
export const hasMore = atom(false)
/** The newest loaded page had PAGE_SIZE rows (more may exist even when `total` is unknown). */
export const lastPageFull = atom(false)
/** The last server switch failed to load its environment; Retry repeats it. */
export const switchFailed = atom(false)
export const listStatus = atom<ListStatus>('idle')
/** Message of the failed search (`invalid` and `error` states). */
export const listError = atom('')
/** The query the rows belong to; `query` is the text being edited. */
export const appliedQuery = atom('')
export const savedQueries = atom<SavedQuery[]>([])
/** Issue id -> workspace id. */
export const links = atom<Record<string, string>>({})
export const selectedIssue = atom<string | null>(null)
export const loadingMore = atom(false)
export const moreError = atom('')

let seq = 0
let seenTick = 0

export const defaultQuery = () => read(env)?.defaultQuery ?? ''

/** Runs a search from the first page; only a successful one is remembered as the last query. */
export async function runSearch(text: string): Promise<void> {
  const current = read(server)
  if (!current) return
  const mine = ++seq
  set(query, text)
  set(appliedQuery, text)
  set(listStatus, 'loading')
  set(moreError, '')
  const answer = await call('yt.issues.search', { server: current, query: text, offset: 0, limit: PAGE_SIZE })
  if (mine !== seq) return
  if (answer.ok) {
    set(issues, answer.data.issues)
    set(total, answer.data.total ?? answer.data.issues.length)
    set(totalKnown, answer.data.total !== undefined)
    set(lastPageFull, answer.data.issues.length >= PAGE_SIZE)
    set(hasMore, answer.data.hasMore)
    set(listError, '')
    set(listStatus, 'ok')
    void call('yt.setQuery', { server: current, query: text })
    return
  }
  set(listError, answer.message)
  if (answer.code === 'QUERY_INVALID') {
    set(issues, [])
    set(total, 0)
    set(totalKnown, false)
    set(hasMore, false)
    set(listStatus, 'invalid')
  } else {
    set(listStatus, 'error')
  }
}

/** Appends the next page; pages of 50 up to 500 rows. */
export async function loadMore(): Promise<void> {
  const current = read(server)
  const rows = read(issues)
  if (!current || read(loadingMore) || read(listStatus) !== 'ok' || !read(hasMore) || rows.length >= MAX_ISSUES) return
  const mine = seq
  set(loadingMore, true)
  set(moreError, '')
  const answer = await call('yt.issues.search', {
    server: current,
    query: read(appliedQuery),
    offset: rows.length,
    limit: Math.min(PAGE_SIZE, MAX_ISSUES - rows.length)
  })
  set(loadingMore, false)
  if (mine !== seq) return
  if (!answer.ok) {
    set(moreError, answer.message)
    return
  }
  const known = new Set(rows.map((row) => row.id))
  const next = [...rows, ...answer.data.issues.filter((row) => !known.has(row.id))]
  set(issues, next)
  set(lastPageFull, answer.data.issues.length >= PAGE_SIZE)
  set(hasMore, answer.data.hasMore && next.length < MAX_ISSUES && answer.data.issues.length > 0)
}

export async function loadLinks(): Promise<void> {
  const current = read(server)
  if (!current) return
  const answer = await call('yt.links', { server: current })
  if (answer.ok && read(server) === current) set(links, answer.data)
}

export async function loadSavedQueries(): Promise<void> {
  const current = read(server)
  if (!current) return
  const answer = await call('yt.savedQueries', { server: current })
  if (answer.ok && read(server) === current) set(savedQueries, answer.data)
}

/** First load of the list for the selected server: search with its stored query, saved searches, links. */
export async function startList(): Promise<void> {
  if (read(listStatus) !== 'idle' || !read(server)) return
  seenTick = read(refreshTick)
  set(listStatus, 'loading')
  await Promise.all([runSearch(read(query)), loadSavedQueries(), loadLinks()])
}

/** Re-runs the current search and reloads links and saved searches. */
export async function refreshList(): Promise<void> {
  if (read(switchFailed)) return onServerChanged()
  if (!read(server)) return
  await Promise.all([runSearch(read(appliedQuery) || read(query)), loadSavedQueries(), loadLinks()])
}

/** Called while rendering the list: starts the first load, and reloads when the header's refresh was pressed. */
export function syncList(): void {
  const tick = read(refreshTick)
  if (read(listStatus) === 'idle') {
    queueMicrotask(() => void startList())
  } else if (tick !== seenTick) {
    seenTick = tick
    queueMicrotask(() => void refreshList())
  }
}

/** After `yt.setServer`: drop the old server's data, take the new server's stored query and load everything for it. */
export async function onServerChanged(): Promise<void> {
  seq++
  set(issues, [])
  set(total, 0)
  set(totalKnown, false)
  set(hasMore, false)
  set(lastPageFull, false)
  set(savedQueries, [])
  set(links, {})
  set(selectedIssue, null)
  set(listError, '')
  set(listStatus, 'loading')
  const answer = await call('yt.env', {})
  if (!answer.ok || answer.data.error) {
    set(switchFailed, true)
    set(listError, answer.ok ? (answer.data.error ?? '') : answer.message)
    set(listStatus, 'error')
    return
  }
  set(switchFailed, false)
  set(env, answer.data as never)
  set(server, answer.data.server)
  set(query, answer.data.query)
  set(listStatus, 'idle')
  await startList()
}

export const bumpRefresh = () => update(refreshTick, (n) => n + 1)
