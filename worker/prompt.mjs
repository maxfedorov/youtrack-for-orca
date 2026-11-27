// Agent prompt and workspace name built from user templates.

export const PROMPT_LIMIT = 4096

const BEGIN = '--- BEGIN YOUTRACK ISSUE (untrusted) ---'
const END = '--- END YOUTRACK ISSUE (untrusted) ---'
const MARKER = '[truncated]'

/**
 * Lowercase ASCII slug: `[a-z0-9-]`, non-ASCII dropped, dashes collapsed.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
export function slugify(text, maxLen = 40) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '')
}

/**
 * @param {{ issue: any, server: string, branch?: string }} p
 * @returns {Record<string, string>}
 */
export function issueVars({ issue, server, branch = '' }) {
  const id = issue?.id ?? ''
  const summary = issue?.summary ?? ''
  return {
    id,
    id_lower: id.toLowerCase(),
    summary,
    summary_slug: slugify(summary),
    url: issue?.url ?? '',
    project: issue?.project?.shortName ?? '',
    server: server ?? '',
    state: issue?.state?.name ?? '',
    priority: issue?.priority?.name ?? '',
    assignee: issue?.assignee?.fullName ?? '',
    description: issue?.descriptionMd ?? '',
    branch: branch ?? '',
  }
}

/**
 * Replace `{{name}}` placeholders; unknown ones stay as written and are reported.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {{ text: string, unknown: string[] }}
 */
export function renderTemplate(template, vars) {
  /** @type {string[]} */
  const unknown = []
  const text = String(template ?? '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? ''
    if (!unknown.includes(name)) unknown.push(name)
    return whole
  })
  return { text, unknown }
}

/**
 * @param {string} branchTemplate
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function workspaceName(branchTemplate, vars) {
  const slug = slugify(renderTemplate(branchTemplate, vars).text)
  return slug || slugify(vars.id_lower ?? '') || 'issue'
}

/** @param {string} text @param {number} budget */
function truncate(text, budget) {
  if (text.length <= budget) return text
  if (budget < MARKER.length + 1) return ''
  let end = budget - MARKER.length - 1
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1 // do not split a surrogate pair
  return text.slice(0, end) + '\n' + MARKER
}

/** Make sure issue text cannot contain a line that looks like a block marker. */
function neutralize(text) {
  return String(text ?? '').replace(/-{3}\s*(BEGIN|END)\s+YOUTRACK\s+ISSUE/gi, '[$1 YOUTRACK ISSUE')
}

const OVERHEAD = BEGIN.length + END.length + 2 // two newlines inside the block

/**
 * The untrusted block with a neutralized, truncated body; '' when it cannot fit in `room`.
 * @param {string} description
 * @param {number} room total characters available for the whole block
 */
function untrustedBlock(description, room) {
  const body = truncate(neutralize(description), room - OVERHEAD)
  return body ? `${BEGIN}\n${body}\n${END}` : ''
}

/**
 * Render the template; issue text only ever appears inside the untrusted block,
 * either where `{{description}}` stands or appended when `includeDescription` is set
 * and the template has no such placeholder. The result never exceeds PROMPT_LIMIT,
 * unless the template alone does (then it is returned as rendered, for the caller to reject).
 * `suffix` (the finish instructions) goes last, after any issue text, and counts towards the limit.
 * @param {{ template: string, vars: Record<string, string>, includeDescription: boolean, description?: string, suffix?: string }} p
 * @returns {string}
 */
export function buildPrompt({ template, vars, includeDescription, description = '', suffix = '' }) {
  const tail = suffix ? `\n\n${suffix}` : ''
  const limit = PROMPT_LIMIT - tail.length
  const bare = renderTemplate(template, { ...vars, description: '' }).text
  if (bare.length >= limit) return bare + tail

  const uses = (String(template).match(/\{\{\s*description\s*\}\}/g) ?? []).length
  if (uses) {
    const room = Math.floor((limit - bare.length) / uses)
    const block = vars.description ? untrustedBlock(vars.description, room) : ''
    return renderTemplate(template, { ...vars, description: block }).text + tail
  }
  if (!includeDescription || !description) return bare + tail
  const block = untrustedBlock(description, limit - bare.length - 2)
  return (block ? `${bare}\n\n${block}` : bare) + tail
}

/**
 * A field or state name that can stand, single-quoted, in the shell line the agent runs: letters, digits,
 * spaces and `_ . -`, starting with a letter or digit (so never a flag).
 */
export const safeValue = (v) => typeof v === 'string' && v.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u.test(v)
/** A server alias as the CLI names them. */
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const quoted = (v) => `'${v}'`

/**
 * What the agent does when it is done: comment a summary, then set the state. Trusted text built by
 * the plugin from the server alias, the issue id and names from the project's own lists; '' for neither.
 * @param {{ server: string, id: string, comment: boolean, stateField?: string | null, state?: string }} p
 */
export function finishBlock({ server, id, comment, stateField, state }) {
  const steps = []
  if (typeof server !== 'string' || !SAFE_ALIAS.test(server) || typeof id !== 'string' || !/^[A-Za-z0-9_]+-\d+$/.test(id)) return ''
  const cli = `youtrack --server ${quoted(server)}`
  if (comment) {
    steps.push(`- Add a comment to ${id} that sums up your work, with the text on standard input:\n  ${cli} issue comment create --text-file - -- ${id}`)
  }
  if (state && stateField && safeValue(state) && safeValue(stateField)) {
    steps.push(`- ${steps.length ? 'Then set' : 'Set'} its ${stateField} to "${state}":\n  ${cli} issue field set -- ${id} ${quoted(stateField)} ${quoted(state)}`)
  }
  return steps.length ? `When you are done:\n${steps.join('\n')}` : ''
}

const ARTICLE_ID = /^[A-Za-z0-9_]+-A-\d+$/

/**
 * The line Send to agent types into an agent's terminal: only the server alias and the article id,
 * never its title or content, which other people write. '' when either is not safe.
 * @param {{ server: string, id: string }} p
 */
export function articleLine({ server, id }) {
  if (typeof server !== 'string' || !SAFE_ALIAS.test(server) || typeof id !== 'string' || !ARTICLE_ID.test(id)) return ''
  return `Also read this YouTrack article for context: \`youtrack --server ${quoted(server)} article view ${id}\``
}

/** Articles the Start prompt asks the agent to read, at most. */
const MAX_PROMPT_ARTICLES = 20

/**
 * The paragraph that asks the agent to read the articles the issue mentions: one YouTrack CLI command per
 * article, with only the server alias and the ids. '' when the alias is not safe or no id is an article id.
 * @param {{ server: string, ids: string[] }} p
 */
export function articlesBlock({ server, ids }) {
  if (typeof server !== 'string' || !SAFE_ALIAS.test(server) || !Array.isArray(ids)) return ''
  const valid = [...new Set(ids.filter((id) => typeof id === 'string' && ARTICLE_ID.test(id)))].slice(0, MAX_PROMPT_ARTICLES)
  if (valid.length === 0) return ''
  return `Also read these YouTrack articles for context:\n${valid.map((id) => `  youtrack --server ${quoted(server)} article view ${id}`).join('\n')}`
}
