import { Button, Heading, Row, Separator, Stack, read } from 'orca'
import { closeSettings, templatesBusy } from '../settingsState'
import { TemplatesSection } from './Templates'

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
    </Stack>
  )
}
