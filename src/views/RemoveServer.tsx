import { Button, Callout, Row, Stack, Text, read } from 'orca'
import { cancelRemove, confirmRemove, removal, removeError, removing, type RemoveFrom } from '../removeServer'

/** The inline question before a server is removed, drawn where it was asked for. */
export function RemoveServerQuestion({ from, alias }: { from: RemoveFrom; alias?: string }) {
  const asked = read(removal)
  if (!asked || asked.from !== from || (alias !== undefined && asked.alias !== alias)) return null
  const busy = read(removing)
  const error = read(removeError)
  return (
    <Callout tone="danger">
      <Stack gap="xs">
        <Text>{`Remove ${asked.alias}? This signs the YouTrack CLI out of it.`}</Text>
        {error ? (
          <Text tone="danger" size="sm">
            {error}
          </Text>
        ) : null}
        <Row gap="xs">
          <Button tone="danger" disabled={busy} onPress={() => void confirmRemove()}>
            Remove
          </Button>
          <Button variant="ghost" disabled={busy} onPress={cancelRemove}>
            Cancel
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}
