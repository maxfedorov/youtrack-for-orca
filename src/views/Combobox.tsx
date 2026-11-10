import { atom, Box, Field, IconButton, Input, List, ListItem, read, set, Stack, Text, update } from 'orca'

export type ComboOption = {
  value: string
  label: string
  description?: string
  /** Options of one group follow each other and share a heading. */
  group?: string
  /** Always offered, whatever the filter, and not counted as a match. */
  pinned?: boolean
}

type Props = {
  /** The field's name; also tells this combobox apart from the others. */
  label: string
  value: string | null
  options: readonly ComboOption[]
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
  /** Filtering by someone else (a remote search): the options given are already the matches. */
  onQuery?: (text: string) => void
  /** The filter text when `onQuery` filters; otherwise the combobox keeps its own. */
  query?: string
  /** A remote search is still running: Enter waits instead of choosing from older results. */
  pending?: boolean
  /** At most this many options are drawn. */
  limit?: number
  /** Drawn right of the closed field, on its line (such as a button acting on the choice). */
  aside?: JSX.Element | null
}

/** The open combobox (one at a time) and the filter text of each, by label. */
const openOne = atom<string | null>(null)
const queries = atom<Record<string, string>>({})

/** Closes any open combobox and forgets the filters it kept. */
export function closeComboboxes(): void {
  set(openOne, null)
  set(queries, {})
}

const DEFAULT_LIMIT = 200
/** About eight rows, then the list scrolls. */
const LIST_HEIGHT = 288

const matches = (option: ComboOption, text: string) =>
  `${option.label} ${option.description ?? ''}`.toLowerCase().includes(text)

/** Runs of consecutive options that share a group. */
function sections(options: readonly ComboOption[]): { group?: string; options: ComboOption[] }[] {
  const out: { group?: string; options: ComboOption[] }[] = []
  for (const option of options) {
    const last = out.at(-1)
    if (last && last.group === option.group) last.options.push(option)
    else out.push({ group: option.group, options: [option] })
  }
  return out
}

/**
 * A button showing the chosen option; pressing it opens a filter field and the matching options right
 * under it. Choosing one, or pressing the button again, closes it.
 */
export function Combobox({ label, value, options, placeholder, disabled, onChange, onQuery, query, pending, limit = DEFAULT_LIMIT, aside }: Props) {
  const opened = read(openOne) === label
  // Disabled while open: it closes for good (state cannot change while rendering, so right after).
  if (opened && disabled) queueMicrotask(() => {
    if (read(openOne) === label) set(openOne, null)
  })
  const isOpen = opened && !disabled
  const remote = Boolean(onQuery)
  const text = remote ? (query ?? '') : (read(queries)[label] ?? '')
  const needle = text.trim().toLowerCase()
  const chosen = options.find((option) => option.value === value)
  const shown = remote || !needle ? options : options.filter((option) => option.pinned || matches(option, needle))
  const visible = shown.slice(0, limit)
  const count = shown.filter((option) => !option.pinned).length
  const setText = (next: string) => {
    if (remote) onQuery?.(next)
    else update(queries, (all) => ({ ...all, [label]: next }))
  }
  const close = () => {
    set(openOne, null)
    if (!remote) update(queries, (all) => ({ ...all, [label]: '' }))
  }
  const toggle = () => (isOpen ? close() : set(openOne, label))
  const choose = (next: string) => {
    close()
    onChange(next)
  }
  return (
    <Field label={label}>
      <Stack gap="xs" align="stretch">
        {/*
          The closed field: a list row (Orca cuts its title short with an ellipsis, where a Button's
          text would run past its edges in a narrow panel) in a border, with the chevron on the right;
          `aside` follows on the same line.
        */}
        <Box key={`${label}:line`} direction="row" align="center" gap="xs">
          <Box key={`${label}:field`} direction="row" align="center" border radius="md" grow shrink minWidth={0}>
            <Box grow shrink minWidth={0}>
              <List key={`${label}:chosen`} label={label}>
                <ListItem
                  key={`${label}:toggle`}
                  title={chosen ? chosen.label : (placeholder ?? 'Choose…')}
                  disabled={disabled}
                  onPress={toggle}
                />
              </List>
            </Box>
            <IconButton
              icon={isOpen ? 'collapse' : 'expand'}
              label={isOpen ? `Close ${label}` : `Open ${label}`}
              variant="ghost"
              disabled={disabled}
              onPress={toggle}
            />
          </Box>
          {aside}
        </Box>
        {isOpen ? (
          <Box key={`${label}:popup`} gap="xs" padding="xs" border radius="md">
            <Input
              type="search"
              label={`Filter ${label}`}
              labelHidden
              placeholder="Type to filter…"
              value={text}
              onChange={setText}
              onSubmit={() => {
                if (!needle || (remote && pending)) return
                const first = visible.find((option) => !option.pinned)
                if (first) choose(first.value)
              }}
            />
            {needle ? <Text muted size="xs">{count === 0 ? 'No matches' : count === 1 ? '1 match' : `${count} matches`}</Text> : null}
            {shown.length > visible.length ? <Text muted size="xs">{`Showing the first ${limit} — type to narrow`}</Text> : null}
            {visible.length > 0 ? (
              <Box maxHeight={LIST_HEIGHT} scroll="y" gap="xs">
                {sections(visible).map((section, index) => (
                  <Stack key={`${section.group ?? ''}#${index}`} gap="none">
                    {section.group ? (
                      <Text muted size="xs" weight="medium">
                        {section.group}
                      </Text>
                    ) : null}
                    <List label={section.group ?? label}>
                      {section.options.map((option) => (
                        <ListItem
                          key={option.value}
                          title={option.label}
                          description={option.description}
                          current={option.value === value}
                          onPress={() => choose(option.value)}
                        />
                      ))}
                    </List>
                  </Stack>
                ))}
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Stack>
    </Field>
  )
}
