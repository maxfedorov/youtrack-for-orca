import { Button, IconButton, Input, Row, Select, Stack, Text, atom, read, set, update } from 'orca'
import { appliedQuery, listError, listStatus, runSearch, savedQueries } from '../listState'
import { call, query, server } from '../state'

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
  update(savedQueries, (list) => [...list, answer.data])
  set(naming, false)
}

export function SearchBar() {
  const text = read(query)
  const saved = read(savedQueries)
  const invalid = read(listStatus) === 'invalid' && text === read(appliedQuery)
  const match = saved.find((item) => item.query === text.trim())
  return (
    <Stack gap="xs">
      <Input
        type="search"
        label="Query"
        value={text}
        invalid={invalid}
        placeholder="Search issues"
        onChange={(value) => set(query, value)}
        onSubmit={(value) => void runSearch(value)}
      />
      {invalid ? (
        <Text tone="danger" size="sm">
          {read(listError)}
        </Text>
      ) : null}
      <Row gap="xs" align="end">
        <Select
          label="Saved searches"
          value={match?.id}
          placeholder="Saved searches"
          options={saved.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(id) => {
            const chosen = read(savedQueries).find((item) => item.id === id)
            if (chosen) void runSearch(chosen.query)
          }}
        />
        {match ? (
          <IconButton icon="star" label={`Saved as ${match.name}`} variant="solid" tone="accent" disabled={invalid} onPress={() => {}} />
        ) : (
          <IconButton icon="star" label="Save search" variant="outline" disabled={invalid || !text.trim()} onPress={startNaming} />
        )}
      </Row>
      {saved.length === 0 ? (
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
