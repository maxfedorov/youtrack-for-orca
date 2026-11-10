import { atom, read, set, Stack } from 'orca'
import { assert, mount, test } from 'orca/testing'
import { Combobox, type ComboOption } from '../src/views/Combobox'

const fruits: ComboOption[] = [
  { value: 'a', label: 'Apple', group: 'Red' },
  { value: 'c', label: 'Cherry', group: 'Red', description: 'small' },
  { value: 'b', label: 'Banana', group: 'Yellow' },
  { value: 'n', label: 'Nothing' }
]
const chosen = atom<string | null>('a')
const locked = atom(false)
const remoteText = atom('')
const asked: string[] = []

function Demo() {
  return (
    <Stack>
      <Combobox label="Fruit" value={read(chosen)} options={fruits} disabled={read(locked)} onChange={(v) => set(chosen, v)} />
      <Combobox
        label="Remote"
        value={null}
        placeholder="Pick one"
        options={[{ value: 'd', label: 'Default', pinned: true }, { value: 'x', label: `Found ${read(remoteText)}` }]}
        query={read(remoteText)}
        onQuery={(text) => {
          asked.push(text)
          set(remoteText, text)
        }}
        onChange={() => {}}
      />
    </Stack>
  )
}

const toggle = (label: string) => ({ testId: `${label}:toggle` })
const items = (view: any) => view.findAll({ type: 'ListItem' }).map((item: any) => item.props.title)
const clean = (view: any) => {
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
}

test('the button shows the chosen option and opens a filter with every option', async () => {
  const view = await mount(Demo)
  const button = view.find(toggle('Fruit'))
  assert.equal(button.props.variant, 'outline')
  assert.equal(button.props.icon, 'expand')
  assert.ok(view.find({ role: 'button', text: 'Apple' }))
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }), null)
  await view.press(toggle('Fruit'))
  assert.equal(view.find(toggle('Fruit')).props.icon, 'collapse')
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }).props.placeholder, 'Type to filter…')
  assert.deepEqual(items(view), ['Apple', 'Cherry', 'Banana', 'Nothing'])
  assert.equal(view.find({ type: 'ListItem', label: 'Apple' }).props.current, true)
  assert.ok(view.find({ type: 'Box', testId: 'Fruit:popup' }))
  assert.ok(view.findAll({ type: 'Box' }).some((box: any) => box.props.scroll === 'y' && box.props.maxHeight > 0))
  await view.press(toggle('Fruit'))
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }), null)
  clean(view)
  await view.unmount()
})

test('groups get a heading; options without one follow on their own', async () => {
  const view = await mount(Demo)
  await view.press(toggle('Fruit'))
  assert.ok(view.find({ text: 'Red' }))
  assert.ok(view.find({ text: 'Yellow' }))
  assert.deepEqual(view.findAll({ type: 'List' }).map((list: any) => list.props.label), ['Red', 'Yellow', 'Fruit'])
  await view.unmount()
})

test('typing narrows the options and counts the matches; choosing one closes and sets it', async () => {
  set(chosen, 'a')
  const view = await mount(Demo)
  await view.press(toggle('Fruit'))
  await view.type({ type: 'Input', label: 'Filter Fruit' }, 'an')
  assert.deepEqual(items(view), ['Banana'])
  assert.ok(view.find({ text: '1 match' }))
  await view.type({ type: 'Input', label: 'Filter Fruit' }, 'small', { replace: true })
  assert.deepEqual(items(view), ['Cherry'])
  await view.type({ type: 'Input', label: 'Filter Fruit' }, 'zzz', { replace: true })
  assert.deepEqual(items(view), [])
  assert.ok(view.find({ text: 'No matches' }))
  await view.type({ type: 'Input', label: 'Filter Fruit' }, 'e', { replace: true })
  assert.ok(view.find({ text: '2 matches' }))
  await view.press({ type: 'ListItem', label: 'Cherry' })
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }), null)
  assert.ok(view.find({ role: 'button', text: 'Cherry' }))
  // Opening again starts with no filter.
  await view.press(toggle('Fruit'))
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }).props.value, '')
  assert.equal(items(view).length, 4)
  clean(view)
  await view.unmount()
})

test('Enter in the filter chooses the first match', async () => {
  const view = await mount(Demo)
  await view.press(toggle('Fruit'))
  await view.type({ type: 'Input', label: 'Filter Fruit' }, 'ban', { submit: true })
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }), null)
  assert.ok(view.find({ role: 'button', text: 'Banana' }))
  await view.unmount()
})

test('only one combobox is open at a time', async () => {
  const view = await mount(Demo)
  await view.press(toggle('Fruit'))
  await view.press(toggle('Remote'))
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }), null)
  assert.ok(view.find({ type: 'Input', label: 'Filter Remote' }))
  await view.unmount()
})

test('a disabled combobox cannot open', async () => {
  set(locked, false)
  const view = await mount(Demo)
  await view.press(toggle('Fruit'))
  await view.rerender()
  set(locked, true)
  await view.settled()
  assert.equal(view.find(toggle('Fruit')).props.disabled, true)
  assert.equal(view.find({ type: 'Input', label: 'Filter Fruit' }), null)
  await view.unmount()
  set(locked, false)
})

test('a remote filter reports the text and shows the options as given, pinned ones uncounted', async () => {
  asked.length = 0
  const view = await mount(Demo)
  assert.ok(view.find({ role: 'button', text: 'Pick one' }))
  await view.press(toggle('Remote'))
  await view.type({ type: 'Input', label: 'Filter Remote' }, 'dev')
  assert.equal(asked.at(-1), 'dev')
  assert.deepEqual(items(view), ['Default', 'Found dev'])
  assert.ok(view.find({ text: '1 match' }))
  clean(view)
  await view.unmount()
})
