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
  return slug || slugify(vars.id_lower ?? '')
}

/** @param {string} text @param {number} budget */
function truncate(text, budget) {
  if (text.length <= budget) return text
  if (budget < MARKER.length + 1) return ''
  return text.slice(0, budget - MARKER.length - 1) + '\n' + MARKER
}

/**
 * Render the template and optionally append the issue description block.
 * The result never exceeds PROMPT_LIMIT, unless the template alone does
 * (then it is returned as rendered, for the caller to reject).
 * @param {{ template: string, vars: Record<string, string>, includeDescription: boolean, description?: string }} p
 * @returns {string}
 */
export function buildPrompt({ template, vars, includeDescription, description = '' }) {
  const bare = renderTemplate(template, { ...vars, description: '' }).text
  if (bare.length >= PROMPT_LIMIT) return bare

  // Share what is left among `{{description}}` placeholders in the template.
  const uses = (String(template).match(/\{\{\s*description\s*\}\}/g) ?? []).length
  const inline = uses
    ? truncate(vars.description ?? '', Math.floor((PROMPT_LIMIT - bare.length) / uses))
    : ''
  const text = renderTemplate(template, { ...vars, description: inline }).text
  if (!includeDescription || !description) return text

  const wrap = (body) => `${text}\n\n${BEGIN}\n${body}\n${END}`
  const room = PROMPT_LIMIT - wrap('').length
  const body = truncate(description, room)
  return body ? wrap(body) : text
}
