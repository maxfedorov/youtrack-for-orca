// Workspace choices for the Start view: each named by its project and shown with a short path.

export const shortBranch = (b) => String(b ?? '').replace(/^refs\/heads\//, '')
const text = (v) => (typeof v === 'string' && v !== '' ? v : null)
const sepOf = (p) => (p.includes('\\') && !p.includes('/') ? '\\' : '/')
const trimEnd = (p) => p.replace(/[\\/]+$/, '')
const segments = (p) => trimEnd(p).split(/[\\/]/)

/** A Windows path (a drive letter or backslashes): compared without regard to case or separator. */
const isWindows = (p) => /^[A-Za-z]:[\\/]|\\/.test(p)

/** `p` is `dir` or lies inside it. */
export function inside(dir, p) {
  const windows = isWindows(dir) || isWindows(p)
  const norm = (x) => (windows ? trimEnd(String(x)).replace(/\\/g, '/').toLowerCase() : trimEnd(String(x)))
  const d = norm(dir)
  const q = norm(p)
  return q === d || q.startsWith(`${d}/`) || q.startsWith(`${d}\\`)
}

/** Home becomes `~`; a path of more than four folders keeps its first and its last two. */
export function shortPath(path, homedir) {
  const sep = sepOf(path)
  let p = trimEnd(path)
  const home = typeof homedir === 'string' && homedir ? trimEnd(homedir) : ''
  if (home && inside(home, p)) p = `~${p.slice(home.length)}`
  const parts = segments(p)
  return parts.length > 4 ? [parts[0], '…', ...parts.slice(-2)].join(sep) : p
}

/**
 * The project of a workspace: the one the workspace list names; else the repository whose folder
 * holds it (the deepest one); else a repository named like its parent folder (worktrees live in
 * `<workspaces>/<repository>/<name>`); else its folder name.
 */
function projectOf(w, repos) {
  const listed = text(w.project)
  if (listed) return listed
  const path = text(w.path)
  if (!path) return null
  const holding = repos
    .filter((r) => text(r.path) && text(r.name) && inside(r.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (holding) return holding.name
  const parts = segments(path)
  const parent = parts.at(-2)
  const named = parent ? repos.find((r) => r.name === parent) : undefined
  return named ? named.name : (text(parts.at(-1)) ?? null)
}

/**
 * @param {any[]} list rows of `workspace.list`
 * @param {any[]} repos rows of `orca repo list` (`{ id, name, path }`)
 * @param {string} [homedir]
 * @returns {import('../src/protocol').WorkspaceItem[]}
 */
export function workspaceItems(list, repos, homedir) {
  const known = (Array.isArray(repos) ? repos : []).filter((r) => r !== null && typeof r === 'object')
  return list.map((w) => {
    const item = { id: w.id, name: text(w.name) ?? w.id }
    const project = projectOf(w, known)
    if (project) item.project = project
    const branch = shortBranch(w.branch)
    if (branch) item.branch = branch
    if (text(w.path)) item.path = shortPath(w.path, homedir)
    return item
  })
}
