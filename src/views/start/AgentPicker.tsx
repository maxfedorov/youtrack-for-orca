import { Input, Select, Stack, read, set } from 'orca'
import { agentChoice, NONE, OTHER, otherAgent, prep } from '../../startState'

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

/** The catalog has no grouped Select, so the group is part of each label. */
export function AgentPicker() {
  const p = read(prep)
  if (!p) return null
  const choice = read(agentChoice)
  const known = [...p.agents.installed, ...p.agents.other]
  const extra = choice !== NONE && choice !== OTHER && !known.includes(choice) ? [choice] : []
  const options = [
    ...p.agents.installed.map((id) => ({ value: id, label: `Installed — ${title(id)}` })),
    ...[...p.agents.other, ...extra].map((id) => ({ value: id, label: `Other — ${title(id)}` })),
    { value: OTHER, label: 'Other…' },
    { value: NONE, label: 'None (terminal only)' }
  ]
  return (
    <Stack gap="xs">
      <Select label="Agent" value={choice} options={options} onChange={(value) => set(agentChoice, value)} />
      {choice === OTHER ? (
        <Input label="Agent id" value={read(otherAgent)} placeholder="e.g. claude" onChange={(value) => set(otherAgent, value)} />
      ) : null}
    </Stack>
  )
}
