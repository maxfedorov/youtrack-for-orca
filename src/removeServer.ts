import { atom, read, set } from 'orca'
import { refreshAll } from './listState'
import { call, notice, view } from './state'

/** Where the removal was asked for; the question is drawn there. */
export type RemoveFrom = 'header' | 'servers'

/** The server waiting for the person to confirm its removal; null when none. */
export const removal = atom<{ alias: string; from: RemoveFrom } | null>(null)
export const removing = atom(false)
export const removeError = atom('')

export function askRemove(alias: string, from: RemoveFrom): void {
  if (read(removing)) return
  set(removeError, '')
  set(removal, { alias, from })
}

export function cancelRemove(): void {
  if (read(removing)) return
  set(removal, null)
  set(removeError, '')
}

/**
 * Removes the server in the YouTrack CLI, then reads the server list again: another server is chosen
 * when it was the selected one, and the add-server screen is shown when none is left.
 */
export async function confirmRemove(): Promise<void> {
  const asked = read(removal)
  if (!asked || read(removing)) return
  set(removing, true)
  set(removeError, '')
  const answer = await call('yt.servers.remove', { server: asked.alias })
  set(removing, false)
  if (!answer.ok) {
    set(removeError, answer.message)
    return
  }
  set(removal, null)
  const stay = read(view).kind === 'settings'
  await refreshAll()
  // Removing from the settings view keeps it open while servers remain.
  if (stay && read(view).kind === 'list') set(view, { kind: 'settings' })
  if (answer.data.warning) set(notice, answer.data.warning)
}
