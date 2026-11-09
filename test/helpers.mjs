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
