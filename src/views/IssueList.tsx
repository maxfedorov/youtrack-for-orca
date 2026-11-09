import { Button, Callout, EmptyState, Row, Skeleton, Stack, Table, Text, atom, read, set } from 'orca'
import {
  MAX_ISSUES, appliedQuery, defaultQuery, hasMore, issues, links, listError, listStatus, loadMore, moreError, refreshList,
  runSearch, selectedIssue, syncList, total
} from '../listState'
import { query, view } from '../state'
import { applySort, parseSort } from '../../worker/query.mjs'
import { IssueRowActions } from './IssueRowActions'
import { SearchBar } from './SearchBar'
import type { IssueRow } from '../protocol'

const COLUMNS = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'summary', label: 'Summary', sortable: true, minWidth: 'md' },
  { key: 'state', label: 'State', sortable: true, hideBelow: 'sm' },
  { key: 'priority', label: 'Priority', sortable: true, hideBelow: 'md' },
  { key: 'assignee', label: 'Assignee', sortable: true, hideBelow: 'md' },
  { key: 'updated', label: 'Updated', sortable: true, hideBelow: 'sm' }
]

const toRow = (row: IssueRow) => ({
  key: row.id,
  cells: {
    id: row.id,
    summary: row.summary,
    state: row.state?.name ?? null,
    priority: row.priority?.name ?? null,
    assignee: row.assignee?.fullName ?? null,
    updated: { type: 'relative', at: row.updated, format: 'short' }
  }
})

/** The catalog has no focus call: Edit query points at the search field instead. */
const editHint = atom(false)

const countText = (count: number) => `${count} ${count === 1 ? 'issue' : 'issues'}`

function QueryButtons({ showReset }: { showReset: boolean }) {
  return (
    <Row gap="xs">
      <Button variant="outline" onPress={() => set(editHint, true)}>
        Edit query
      </Button>
      {showReset ? (
        <Button variant="outline" onPress={() => void runSearch(defaultQuery())}>
          Reset to default
        </Button>
      ) : null}
    </Row>
  )
}

function Results() {
  const rows = read(issues)
  const status = read(listStatus)
  const current = read(appliedQuery)
  const hint = read(editHint) ? (
    <Text muted size="sm">
      Edit the query above and press Enter.
    </Text>
  ) : null
  if (status === 'error') {
    return (
      <Callout tone="danger">
        <Stack gap="xs">
          <Text>{read(listError)}</Text>
          <Button variant="ghost" onPress={() => void refreshList()}>
            Retry
          </Button>
        </Stack>
      </Callout>
    )
  }
  if (status === 'invalid') {
    return (
      <EmptyState title="Query error" description="YouTrack could not parse this query.">
        <QueryButtons showReset />
        {hint}
      </EmptyState>
    )
  }
  if (status === 'idle' || (status === 'loading' && rows.length === 0)) return <Skeleton shape="text" lines={6} label="Loading issues" />
  if (status === 'ok' && rows.length === 0) {
    return (
      <EmptyState title="No issues match this query" description={current}>
        <QueryButtons showReset={current !== defaultQuery()} />
        {hint}
      </EmptyState>
    )
  }
  const sort = parseSort(read(query))
  const selected = rows.find((row) => row.id === read(selectedIssue))
  const capped = rows.length >= MAX_ISSUES && (read(hasMore) || read(total) > MAX_ISSUES)
  return (
    <Stack gap="xs">
      <Table
        label="Issues"
        columns={COLUMNS}
        rows={rows.map(toRow)}
        sort={sort ?? undefined}
        selectionMode="single"
        selected={selected ? [selected.id] : []}
        hasMore={read(hasMore) && rows.length < MAX_ISSUES}
        loading={status === 'loading' || undefined}
        onSortChange={({ column }) => void runSearch(applySort(read(query), column))}
        onSelectionChange={({ keys }) => set(selectedIssue, Array.from(keys as Iterable<string>)[0] ?? null)}
        onRowAction={({ key }) => set(view, { kind: 'detail', issueId: String(key) })}
        onLoadMore={() => void loadMore()}
      />
      <Text muted size="sm">
        {countText(read(total))}
      </Text>
      {capped ? (
        <Text muted size="sm">
          Showing the first 500 issues. Refine the query.
        </Text>
      ) : null}
      {read(moreError) ? (
        <Text tone="danger" size="sm">
          {read(moreError)}
        </Text>
      ) : null}
      {selected ? <IssueRowActions issue={selected} workspaceId={read(links)[selected.id]} /> : null}
    </Stack>
  )
}

export function IssueList() {
  syncList()
  return (
    <Stack gap="sm">
      <SearchBar />
      <Results />
    </Stack>
  )
}
