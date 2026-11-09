/**
 * Test double for the `run` function injected into createYoutrack.
 * `map` keys are prefixes of `args.join(' ')`; the longest matching prefix wins.
 * @param {Record<string, { exitCode?: number, stdout?: string, stderr?: string, timedOut?: boolean, spawnError?: string }>} map
 */
export function fakeRun(map = {}) {
  const calls = []
  async function run(args, opts = {}) {
    calls.push({ args, opts })
    const line = args.join(' ')
    const key = Object.keys(map)
      .filter((k) => line.startsWith(k))
      .sort((a, b) => b.length - a.length)[0]
    const r = key === undefined ? { exitCode: 0, stdout: '', stderr: '' } : map[key]
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...r }
  }
  run.calls = calls
  return run
}

/**
 * In-memory stand-in for the worker's `orca.storage`.
 * `data()` returns a plain-object snapshot of what is stored.
 */
export function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    async get(key) {
      return map.has(key) ? structuredClone(map.get(key)) : null
    },
    async set(key, value) {
      map.set(key, structuredClone(value))
    },
    data() {
      return Object.fromEntries(map)
    },
  }
}

/**
 * Test double for the `orca` object a worker receives.
 * `host` maps a host method to a value or a function of its params; calling an unlisted method throws.
 * `handlers` holds what the worker registered with `panels.handle`; `posts` records `panels.post`.
 */
export function fakeOrca({ host = {}, settings = {}, storage = {} } = {}) {
  const handlers = new Map()
  const posts = []
  const hostCalls = []
  return {
    panels: {
      handle: (name, fn) => void handlers.set(name, fn),
      post: (name, payload) => void posts.push({ name, payload }),
    },
    host: {
      async call(method, params) {
        hostCalls.push({ method, params })
        if (!(method in host)) throw new Error(`no host result for ${method}`)
        const r = host[method]
        return typeof r === 'function' ? r(params) : r
      },
    },
    settings: { get: async (key) => settings[key] },
    storage: fakeStorage(storage),
    handlers,
    posts,
    hostCalls,
  }
}
