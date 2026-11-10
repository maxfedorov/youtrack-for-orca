// Detail and start screens open from a row press, which a check scenario cannot perform;
// they are covered by the panel tests.
import { defineCheck } from 'orca/testing'

const ok = <T>(data: T) => ({ ok: true as const, data })
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } })

const query = 'for: me #Unresolved'
const server = { alias: 'main', url: 'https://main.example.com', active: true, status: 'authenticated' }
const env = ok({
  cli: { found: true, version: '1.0.0' },
  orcaCli: { found: true },
  servers: [server],
  server: 'main',
  query,
  defaultQuery: query
})
const issue = (n: number) => ({
  id: `DEMO-${n}`,
  summary: `Example issue ${n}`,
  state: { name: 'Open' },
  priority: { name: 'Major' },
  assignee: { login: 'jane', fullName: 'Jane Doe' },
  created: 1_690_000_000_000 + n,
  updated: 1_700_000_000_000 + n,
  resolved: false,
  url: `https://main.example.com/issue/DEMO-${n}`
})
const requests = {
  'yt.env': env,
  'yt.issues.search': ok({ issues: [issue(1), issue(2), issue(3)], hasMore: false, total: 3 }),
  'yt.savedQueries': ok([{ id: 's1', name: 'My open issues', query }]),
  'yt.links': ok({}),
  'yt.setQuery': ok({})
}
const withEnv = (over: Record<string, unknown>) => ({ ...requests, 'yt.env': ok({ ...env.data, ...over }) })

export default defineCheck({
  'no cli': {
    requests: {
      ...requests,
      'yt.env': ok({
        cli: { found: false, installCommand: 'brew install jetbrains/utils/youtrack' },
        orcaCli: { found: true },
        servers: [],
        server: null,
        query,
        defaultQuery: query
      })
    }
  },
  'no servers': { requests: withEnv({ servers: [], server: null }) },
  list: { requests },
  'query error': {
    requests: { ...requests, 'yt.issues.search': fail('QUERY_INVALID', 'Invalid query: unexpected token') }
  },
  empty: { requests: { ...requests, 'yt.issues.search': ok({ issues: [], hasMore: false, total: 0 }) } }
})
