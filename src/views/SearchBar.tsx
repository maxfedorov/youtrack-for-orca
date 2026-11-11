import { Button, IconButton, Input, Row, Stack, Text, atom, read, set, update } from 'orca'
import { appliedQuery, listError, listStatus, loadSavedQueries, runSearch, savedQueries, savedQueriesFailed } from '../listState'
import { call, query, server } from '../state'
import { Combobox } from './Combobox'

/** How long an emptied query waits before it runs: clearing the field and typing anew runs nothing. */
const CLEARED_MS = 400
let clearTimer: ReturnType<typeof setTimeout> | null = null

/** The search field's clear button empties it without Enter, so a query left empty runs by itself. */
function emptied(value: string): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = null
  if (value !== '') return
  clearTimer = setTimeout(() => {
    clearTimer = null
    if (read(query) === '' && read(appliedQuery) !== '') void runSearch('')
  }, CLEARED_MS)
}

const naming = atom(false)
const draftName = atom('')
const saveError = atom('')

function startNaming(): void {
  set(draftName, read(query).trim().slice(0, 60))
  set(saveError, '')
  set(naming, true)
}

async function saveSearch(): Promise<void> {
  const current = read(server)
  const name = read(draftName).trim()
  if (!current || !name) return
  const answer = await call('yt.savedQueries.create', { server: current, name, query: read(query).trim() })
  if (!answer.ok) {
    set(saveError, answer.message)
    return
  }
  set(naming, false)
  // Without an id it cannot be chosen from the list; read the list as the server has it.
  if (answer.data.id && answer.data.name) update(savedQueries, (list) => [...list, answer.data])
  else void loadSavedQueries()
}

export function SearchBar() {
  const text = read(query)
  const saved = read(savedQueries)
  const invalid = read(listStatus) === 'invalid' && text === read(appliedQuery)
  const match = saved.find((item) => item.query === text.trim())
  const unavailable = read(savedQueriesFailed)
  return (
    <Stack gap="xs">
      <Input
        type="search"
        label="Query"
        value={text}
        invalid={invalid}
        placeholder="Search issues"
        onChange={(value) => {
          set(query, value)
          emptied(value)
        }}
        onSubmit={(value) => void runSearch(value)}
      />
      {invalid ? (
        <Text tone="danger" size="sm">
          {read(listError)}
        </Text>
      ) : null}
      {/* A list with a filter, not a Select: an account can see far more saved searches than a Select holds. */}
      <Combobox
        label="Saved searches"
        value={match?.id ?? null}
        placeholder={unavailable ? 'Saved searches unavailable' : 'Saved searches'}
        disabled={unavailable && saved.length === 0}
        options={saved.map((item) => ({ value: item.id, label: item.name }))}
        onChange={(id) => {
          const chosen = read(savedQueries).find((item) => item.id === id)
          if (chosen) void runSearch(chosen.query)
        }}
        aside={
          match ? (
            <IconButton icon="star" label={`Saved as ${match.name}`} variant="solid" tone="accent" disabled={invalid} onPress={() => {}} />
          ) : (
            <IconButton icon="star" label="Save search" variant="outline" disabled={invalid || !text.trim()} onPress={startNaming} />
          )
        }
      />
      {unavailable ? (
        <Row gap="xs" align="center">
          <Text muted size="sm">
            Saved searches could not be loaded.
          </Text>
          <IconButton icon="refresh" label="Reload saved searches" variant="ghost" onPress={() => void loadSavedQueries()} />
        </Row>
      ) : saved.length === 0 ? (
        <Text muted size="sm">
          Save the current query with ☆
        </Text>
      ) : null}
      {read(naming) ? (
        <Stack gap="xs">
          <Input label="Search name" maxLength={60} value={read(draftName)} onChange={(value) => set(draftName, value)} onSubmit={() => void saveSearch()} />
          {read(saveError) ? (
            <Text tone="danger" size="sm">
              {read(saveError)}
            </Text>
          ) : null}
          <Row gap="xs">
            <Button disabled={!read(draftName).trim()} onPress={() => void saveSearch()}>
              Save
            </Button>
            <Button variant="ghost" onPress={() => set(naming, false)}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : null}
    </Stack>
  )
}
