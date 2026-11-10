import { Field, Input, Stack, Text, read, set } from 'orca'
import { agentChoice, NONE, OTHER, otherAgent, prep } from '../../startState'
import { Combobox } from '../Combobox'

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

export function AgentPicker() {
  const p = read(prep)
  if (!p) return null
  const choice = read(agentChoice)
  const known = [...p.agents.installed, ...p.agents.other]
  const extra = choice !== NONE && choice !== OTHER && !known.includes(choice) ? [choice] : []
  const options = [
    ...p.agents.installed.map((id) => ({ value: id, label: title(id), group: 'Installed' })),
    ...[...p.agents.other, ...extra].map((id) => ({ value: id, label: title(id), group: 'Other agents' })),
    { value: OTHER, label: 'Other…', description: 'Type an agent id' },
    { value: NONE, label: 'None (terminal only)' }
  ]
  return (
    <Stack gap="xs">
      <Combobox label="Agent" value={choice} options={options} onChange={(value) => set(agentChoice, value)} />
      {p.agentsError ? (
        <Text muted size="sm">
          Installed agents could not be detected. Every agent is listed under Other agents.
        </Text>
      ) : null}
      {choice === OTHER ? (
        <Field label="Agent id">
          <Input label="Agent id" labelHidden value={read(otherAgent)} placeholder="e.g. claude" onChange={(value) => set(otherAgent, value)} />
        </Field>
      ) : null}
    </Stack>
  )
}
