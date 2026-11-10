import { Button, Code, Row, Stack, Text, atom, read, update } from 'orca'

/** "Not signed in yet" after a check, and a check in flight, by command. */
const notYet = atom<Record<string, boolean>>({})
const checking = atom<Record<string, boolean>>({})

/**
 * Sign-in the person runs in a terminal of their own: the CLI asks for a permanent token there and
 * keeps it in the system keychain, so the plugin never sees a token. `check` answers whether the
 * sign-in is done (and takes it from there).
 */
export function TerminalSignIn({ command, check }: { command: string; check: () => Promise<boolean> }) {
  const busy = read(checking)[command] ?? false
  const run = async () => {
    if (busy) return
    update(checking, (all) => ({ ...all, [command]: true }))
    let done = false
    try {
      done = await check()
    } finally {
      update(checking, (all) => ({ ...all, [command]: false }))
    }
    update(notYet, (all) => ({ ...all, [command]: !done }))
  }
  return (
    <Stack gap="xs">
      <Text>Run this in a terminal, then come back:</Text>
      <Code block>{command}</Code>
      <Text muted size="sm">
        The CLI asks for a permanent token and keeps it in your system keychain. The plugin never sees the token.
      </Text>
      <Row gap="xs" align="center">
        <Button variant="outline" size="sm" disabled={busy} onPress={() => void run()}>
          I've signed in
        </Button>
        {read(notYet)[command] ? (
          <Text muted size="sm">
            Not signed in yet.
          </Text>
        ) : null}
      </Row>
    </Stack>
  )
}
