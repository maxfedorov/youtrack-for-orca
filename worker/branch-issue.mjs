// The YouTrack issue a branch is named after, and changes of the focused workspace.
import { shortBranch } from './workspaces.mjs'

const MAX_BRANCH = 255
/** A project short name and a number, as a whole part of the branch name: `demo-4-fix`, `feat/DEMO-12`. */
const ID_IN_BRANCH = /(?:^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]{0,63})-(\d{1,9})(?![0-9])/

/** The first issue id in a branch name, in upper case; null when it names none. */
export function issueIdFromBranch(branch) {
  if (typeof branch !== 'string' || branch.length > MAX_BRANCH) return null
  const m = ID_IN_BRANCH.exec(shortBranch(branch))
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null
}

/**
 * A `workspace.changed` listener that calls `onChange` only when the focused workspace or its branch
 * changed; terminals opening or closing do not count.
 */
export function createContextWatcher(onChange) {
  let last
  return (event) => {
    const c = event && typeof event === 'object' ? event.context : null
    const key = c && typeof c === 'object' ? `${String(c.branch ?? '')}\u0000${String(c.displayName ?? '')}` : null
    if (key === last) return
    last = key
    onChange()
  }
}
