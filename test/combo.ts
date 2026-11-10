// Drives a Combobox of the panel under test the way a person does.

export const toggle = (label: string) => ({ testId: `${label}:toggle` })
const filterOf = (label: string) => ({ type: 'Input', label: `Filter ${label}` })

/** What the closed combobox shows: the chosen option's label or the placeholder. */
export const shown = (view: any, label: string): string | undefined => view.find(toggle(label))?.props.title

export const isOpen = (view: any, label: string) => Boolean(view.find(filterOf(label)))

export async function openCombo(view: any, label: string): Promise<void> {
  if (!isOpen(view, label)) await view.press(toggle(label))
}

/** The options drawn while open, as `{ value, label }`; closes the combobox again if it opened it. */
export async function optionsOf(view: any, label: string): Promise<{ value: string; label: string; description?: string }[]> {
  const wasOpen = isOpen(view, label)
  await openCombo(view, label)
  const list = view.findAll({ type: 'ListItem' }).filter((item: any) => !String(item.key).endsWith(':toggle')).map((item: any) => ({
    value: item.key,
    label: item.props.title,
    ...(item.props.description ? { description: item.props.description } : {})
  }))
  if (!wasOpen) await view.press(toggle(label))
  return list
}

export async function pick(view: any, label: string, value: string): Promise<void> {
  await openCombo(view, label)
  await view.press({ type: 'ListItem', testId: value })
}

export async function filterCombo(view: any, label: string, text: string): Promise<void> {
  await openCombo(view, label)
  await view.type(filterOf(label), text, { replace: true })
}

export const comboDisabled = (view: any, label: string) => Boolean(view.find(toggle(label))?.props.disabled)
