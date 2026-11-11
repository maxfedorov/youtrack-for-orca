import { Button, Heading, Row, Separator, Stack, Text, atom, read, set } from 'orca'
import { call } from '../state'
import { closeSettings, templatesBusy } from '../settingsState'
import { TemplatesSection } from './Templates'
import { ServersSection } from './Servers'

type ResetState = 'idle' | 'asking' | 'busy' | 'done'
const resetState = atom<ResetState>('idle')
const resetError = atom('')

async function resetSettings(): Promise<void> {
  set(resetState, 'busy')
  const answer = await call('yt.settings.reset', {})
  set(resetError, answer.ok ? '' : answer.message)
  set(resetState, answer.ok ? 'done' : 'idle')
}

/** Puts the settings of Orca's Settings → Plugins page back to their defaults, after a confirmation. */
function ResetSection() {
  const state = read(resetState)
  return (
    <Stack gap="sm">
      <Heading level={3}>Plugin settings</Heading>
      <Text muted size="sm">
        The defaults (query, columns, branch name, agent, where to run, prompt options, CLI path) are in Orca's Settings → Plugins → YouTrack for Orca, each with its own Reset.
      </Text>
      {state === 'asking' || state === 'busy' ? (
        <Stack gap="xs">
          <Text>Reset every plugin setting to its default? Prompt templates and servers stay.</Text>
          <Row gap="xs">
            <Button tone="danger" disabled={state === 'busy'} onPress={() => void resetSettings()}>
              Reset
            </Button>
            <Button variant="ghost" disabled={state === 'busy'} onPress={() => set(resetState, 'idle')}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap="xs" align="center">
          <Button variant="outline" onPress={() => {
              set(resetError, '')
              set(resetState, 'asking')
            }}>
            Reset all settings to defaults
          </Button>
          {state === 'done' ? (
            <Text muted size="sm">
              Settings reset.
            </Text>
          ) : null}
        </Row>
      )}
      {read(resetError) ? (
        <Text tone="danger" size="sm">
          {read(resetError)}
        </Text>
      ) : null}
    </Stack>
  )
}

/** Prompt templates and servers: settings Orca's settings page cannot hold (lists). */
export function Settings() {
  return (
    <Stack gap="md">
      <Row gap="xs" align="center">
        <Button variant="ghost" size="sm" disabled={read(templatesBusy)} onPress={closeSettings}>
          ← Back
        </Button>
        <Heading level={2}>Settings</Heading>
      </Row>
      <TemplatesSection />
      <Separator />
      <ServersSection />
      <Separator />
      <ResetSection />
    </Stack>
  )
}
