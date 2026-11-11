import { Box, Button, Callout, EmptyState, IconButton, Row, Skeleton, Stack, Table, Text, read, set } from 'orca'
import {
  MAX_ISSUES, appliedQuery, columns, defaultQuery, hasMore, issues, lastPageFull, links, linksFailed, listError, loadLinks, listStatus, loadMore, moreError, refreshList,
  runSearch, selectedIssue, syncList, total, totalKnown
} from '../listState'
import { query } from '../state'
import { applySort, columnKey, parseSort } from '../../worker/query.mjs'
import { IssueRowActions, openDetail } from './IssueRowActions'
import { SearchBar } from './SearchBar'
import { NOT_AVAILABLE } from '../shapes'
import type { IssueRow } from '../protocol'

// ID and Summary come first and Created and Updated last; between them the custom fields the columns
// setting names. A custom field no loaded issue has a value for is left out (a project without it),
// unless the list is sorted by it. A narrow sidebar scrolls the table sideways (see minWidth).
// Widths: sm is 6rem (96px), md 9rem (144px); Summary needs 9rem at least, and 24px covers row borders.
const WIDTH = { sm: 96, md: 144 } as const
const SUMMARY_MIN = 144
const BORDERS = 24

type Column = { key: string; label: string; sortable: true; width?: 'sm' | 'md'; minWidth?: 'md' }

/** The columns to draw for these rows, and the width the table needs for them. */
export function visibleColumns(rows: IssueRow[], fields: string[], sortColumn: string | null) {
  const custom: Column[] = fields
    .map((name) => ({ key: columnKey(name), label: name, sortable: true as const, width: 'md' as const }))
    .filter((column) => rows.length === 0 || column.key === sortColumn || rows.some((row) => Boolean(row.fields?.[column.key])))
  const columns: Column[] = [
    { key: 'id', label: 'ID', sortable: true, width: 'sm' },
    { key: 'summary', label: 'Summary', sortable: true, minWidth: 'md' },
    ...custom,
    { key: 'created', label: 'Created', sortable: true, width: 'sm' },
    { key: 'updated', label: 'Updated', sortable: true, width: 'sm' }
  ]
  const minWidth = columns.reduce((sum, column) => sum + (column.width ? WIDTH[column.width] : SUMMARY_MIN), BORDERS)
  return { columns, minWidth }
}

/** A time cell; a row without a readable time shows n/a. */
const time = (at: number) => (at > 0 ? { type: 'relative', at, format: 'short' } : NOT_AVAILABLE)

const toRow = (row: IssueRow, fields: string[]) => ({
  key: row.id,
  cells: {
    id: row.id,
    summary: row.summary,
    ...Object.fromEntries(fields.map((name) => [columnKey(name), row.fields?.[columnKey(name)] ?? null])),
    created: time(row.created),
    updated: time(row.updated)
  }
})

const countText = (count: number, more = false) => `${count}${more ? '+' : ''} ${count === 1 && !more ? 'issue' : 'issues'}`

function QueryButtons({ showReset }: { showReset: boolean }) {
  return showReset ? (
    <Button variant="outline" onPress={() => void runSearch(defaultQuery())}>
      Reset to default
    </Button>
  ) : null
}

function Results() {
  const rows = read(issues)
  const status = read(listStatus)
  const current = read(appliedQuery)
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
      </EmptyState>
    )
  }
  if (status === 'idle' || (status === 'loading' && rows.length === 0)) return <Skeleton shape="text" lines={6} label="Loading issues" />
  if (status === 'ok' && rows.length === 0) {
    return (
      <EmptyState title="No issues match this query" description={current}>
        <QueryButtons showReset={current !== defaultQuery()} />
      </EmptyState>
    )
  }
  const sort = parseSort(read(query))
  const selected = rows.find((row) => row.id === read(selectedIssue))
  const known = read(totalKnown)
  const capped = rows.length >= MAX_ISSUES && (known ? read(total) > MAX_ISSUES : read(lastPageFull))
  const fields = read(columns)
  const table = visibleColumns(rows, fields, sort?.column ?? null)
  return (
    <Stack gap="xs">
      <Box key="table-scroll" scroll="x">
        <Box key="table-width" minWidth={table.minWidth}>
        <Table
          label="Issues"
          columns={table.columns}
          rows={rows.map((row) => toRow(row, fields))}
          sort={sort ?? undefined}
          selectionMode="single"
          selected={selected ? [selected.id] : []}
          hasMore={read(hasMore) && rows.length < MAX_ISSUES}
          loading={status === 'loading' || undefined}
          onSortChange={({ column }) => void runSearch(applySort(read(query), column, fields.find((name) => columnKey(name) === column)))}
          onSelectionChange={({ keys }) => set(selectedIssue, Array.from(keys as Iterable<string>)[0] ?? null)}
          onRowAction={({ key }) => openDetail(String(key))}
          onLoadMore={() => void loadMore()}
        />
        </Box>
      </Box>
      <Text muted size="sm">
        {known ? countText(read(total)) : countText(rows.length, read(hasMore))}
      </Text>
      {capped ? (
        <Text muted size="sm">
          Showing the first 500 issues. Refine the query.
        </Text>
      ) : null}
      {read(linksFailed) ? (
        <Row gap="xs" align="center">
          <Text muted size="sm">
            Workspace links could not be loaded.
          </Text>
          <IconButton icon="refresh" label="Reload workspace links" variant="ghost" onPress={() => void loadLinks()} />
        </Row>
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
