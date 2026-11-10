import { atom, read, set, update } from 'orca'
import { call } from './state'
import { whenSettingsOpen } from './settingsState'
import type { Repo } from './protocol'

/** Option value of "no default project" (an option cannot have an empty value). */
export const NO_REPO = '__none__'

type Status = 'idle' | 'loading' | 'ok' | 'error'

export const serversStatus = atom<Status>('idle')
export const repoChoices = atom<Repo[]>([])
/** Why the Orca projects could not be listed; the servers are shown all the same. */
export const reposError = atom('')
/** Server alias -> its default Orca project id. */
export const defaultRepos = atom<Record<string, string>>({})
/** Why the last default could not be saved. */
export const defaultsError = atom('')

let seq = 0

export async function loadServerDefaults(): Promise<void> {
  const mine = ++seq
  set(serversStatus, 'loading')
  const answer = await call('yt.servers.defaults', {})
  if (mine !== seq) return
  if (answer.ok) {
    set(repoChoices, answer.data.repos)
    set(reposError, answer.data.reposError ?? '')
    set(defaultRepos, answer.data.defaults)
    set(serversStatus, 'ok')
  } else {
    set(repoChoices, [])
    set(reposError, answer.message)
    set(serversStatus, 'error')
  }
}

whenSettingsOpen(() => {
  set(defaultsError, '')
  void loadServerDefaults()
})

/** Saves the default project of a server; shown at once, and put back when it cannot be saved. */
export async function setDefaultRepo(alias: string, value: string): Promise<void> {
  const repoId = value === NO_REPO ? null : value
  const before = read(defaultRepos)[alias]
  const put = (id: string | null | undefined) =>
    update(defaultRepos, (all) => {
      const next = { ...all }
      if (id) next[alias] = id
      else delete next[alias]
      return next
    })
  set(defaultsError, '')
  put(repoId)
  const answer = await call('yt.servers.setDefaultRepo', { server: alias, repoId })
  if (!answer.ok) {
    put(before)
    set(defaultsError, answer.message)
  }
}
