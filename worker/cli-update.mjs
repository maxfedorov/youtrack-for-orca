// Offers a newer YouTrack CLI release and upgrades it on request, both through `youtrack update`.
// The CLI asks GitHub for the latest release, so the answer is kept for a day and only asked again
// when the panel opens after that; a version the person skipped is not offered again.

import { ok, fail, CODES } from './result.mjs'

export const CHECK_EVERY_MS = 24 * 60 * 60_000
const RELEASE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const RELEASES = 'https://github.com/JetBrains/youtrack-cli/releases'
const RELEASE_PAGE = /^https:\/\/github\.com\/JetBrains\/youtrack-cli\/releases\/tag\/v\d{1,4}\.\d{1,4}\.\d{1,4}$/
const NONE = Object.freeze({ available: false })

/** True when release `a` is newer than release `b`; both are `x.y.z`. */
const newer = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** The release `youtrack --version` names ("youtrack 0.8.2 (commit, date)"), or null for other builds. */
const releaseOf = (text) => {
  const v = String(text ?? '').trim().split(/\s+/)[1] ?? ''
  return RELEASE.test(v) ? v : null
}

/**
 * @param {{
 *   storage: import('./state.mjs').Storage,
 *   getYoutrack: () => any,
 *   refreshYoutrack: () => Promise<unknown>,
 *   now: () => number
 * }} o
 */
export function createCliUpdates({ storage, getYoutrack, refreshYoutrack, now }) {
  let running = false

  /** The latest release as last checked, while it is fresh: `{ latest, url }`, or null. */
  async function cached() {
    const c = await storage.get('cliUpdate')
    if (c === null || typeof c !== 'object' || typeof c.checkedAt !== 'number') return null
    if (now() - c.checkedAt >= CHECK_EVERY_MS || c.checkedAt > now()) return null
    return typeof c.latest === 'string' && RELEASE.test(c.latest) ? { latest: c.latest, url: typeof c.url === 'string' ? c.url : `${RELEASES}/latest` } : null
  }

  /** Asks the CLI for the latest release and keeps the answer; null when it could not say. */
  async function check(youtrack) {
    const r = await youtrack.updateStatus()
    const latest = r.ok ? r.data?.latestVersion : null
    if (typeof latest !== 'string' || !RELEASE.test(latest)) return null
    const page = r.data.releaseUrl
    const found = { latest, url: typeof page === 'string' && RELEASE_PAGE.test(page) ? page : `${RELEASES}/latest` }
    await storage.set('cliUpdate', { checkedAt: now(), ...found })
    return found
  }

  return {
    /** `{ available: true, current, latest, url }` when a newer release than the installed one exists. */
    async status() {
      const youtrack = getYoutrack()
      if (!youtrack) return ok(NONE)
      const version = await youtrack.version()
      const current = version.ok ? releaseOf(version.data) : null
      // Builds from source ("dev") cannot be compared with a release.
      if (!current) return ok(NONE)
      const found = (await cached()) ?? (await check(youtrack))
      if (!found || !newer(found.latest, current)) return ok(NONE)
      if ((await storage.get('cliUpdateSkipped')) === found.latest) return ok(NONE)
      return ok({ available: true, current, latest: found.latest, url: found.url })
    },

    /** Stops offering this release; a newer one is offered again. */
    async skip(version) {
      if (typeof version !== 'string' || !RELEASE.test(version)) return fail(CODES.UNKNOWN, 'Invalid version')
      await storage.set('cliUpdateSkipped', version)
      return ok({})
    },

    /** Upgrades the CLI the way it was installed; the CLI's error says how to do it by hand when it cannot. */
    async upgrade() {
      const youtrack = getYoutrack()
      if (!youtrack) return fail(CODES.CLI_NOT_FOUND, 'The YouTrack CLI was not found.')
      if (running) return fail(CODES.UNKNOWN, 'The YouTrack CLI is already being updated.')
      running = true
      try {
        const r = await youtrack.upgrade()
        if (!r.ok) return r
        await refreshYoutrack()
        const version = await (getYoutrack() ?? youtrack).version()
        return ok({ version: (version.ok && releaseOf(version.data)) || '' })
      } finally {
        running = false
      }
    },

    upgrading: () => running
  }
}
