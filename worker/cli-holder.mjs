// Holds the youtrack CLI wrapper and looks the binary up again on demand, so installing the CLI,
// removing it or changing the path setting takes effect without restarting the worker.
import { createYoutrack, resolveYoutrack } from './youtrack-cli.mjs'

/**
 * @param {{
 *   getSetting: () => Promise<unknown>,
 *   env: Record<string, string | undefined>,
 *   platform: string,
 *   homedir: string,
 *   exists: (p: string) => boolean,
 *   create?: typeof createYoutrack
 * }} o
 */
export function createYoutrackHolder({ getSetting, env, platform, homedir, exists, create = createYoutrack }) {
  let bin = null
  let current = null
  return {
    get: () => current,
    /** Resolves the binary again; the wrapper is rebuilt only when the binary changed. */
    async refresh() {
      const setting = await getSetting()
      const next = resolveYoutrack({ settingPath: typeof setting === 'string' ? setting : '', env, platform, homedir, exists })
      if (next !== bin) {
        bin = next
        current = next ? create({ bin: next }) : null
      }
      return current
    }
  }
}
