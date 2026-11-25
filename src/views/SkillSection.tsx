import { Button, Heading, Row, Stack, Text, atom, read, set } from 'orca'
import { call } from '../state'

const busy = atom(false)
const result = atom<{ messages: string[]; error: string } | null>(null)

async function install(): Promise<void> {
  set(busy, true)
  set(result, null)
  const answer = await call('yt.skill.install', {})
  set(busy, false)
  set(result, answer.ok ? { messages: answer.data.messages, error: '' } : { messages: [], error: answer.message })
}

/** Installs the YouTrack CLI's skill, which teaches coding agents to read and update issues. */
export function SkillSection() {
  const r = read(result)
  return (
    <Stack gap="sm">
      <Heading level={3}>Skill for coding agents</Heading>
      <Text muted size="sm">
        The YouTrack CLI ships a skill that teaches coding agents (Claude Code, Codex, Cursor and others) to read issues, comment on them and change their fields with the CLI. It is installed for every agent found on this computer and needs no token.
      </Text>
      <Row gap="xs">
        <Button variant="outline" disabled={read(busy)} onPress={() => void install()}>
          Install or update the skill
        </Button>
      </Row>
      {r?.error ? (
        <Text tone="danger" size="sm">
          {r.error}
        </Text>
      ) : null}
      {r && !r.error ? (r.messages.length ? r.messages : ['Done.']).map((m, i) => (
        <Text key={`m${i}`} muted size="sm">
          {m}
        </Text>
      )) : null}
    </Stack>
  )
}
