import { Button, Callout, IconButton, Row, Stack, Text, atom, read, set } from 'orca'
import { call, env, unwrap } from '../state'
import { refreshAll } from '../listState'
import { openInBrowser } from './IssueRowActions'

const RELEASES = 'https://github.com/JetBrains/youtrack-cli/releases'
const RELEASE_PAGE = /^https:\/\/github\.com\/JetBrains\/youtrack-cli\/releases\/tag\/v\d{1,4}\.\d{1,4}\.\d{1,4}$/

/** The newer YouTrack CLI release on offer; null when there is none. */
const offer = atom<{ current: string; latest: string; url: string } | null>(null)
/** The note under the header with the versions and the actions is shown. */
const open = atom(false)
const busy = atom(false)
const failure = atom('')

/** Asks the worker whether a newer YouTrack CLI exists; any failure just offers nothing. */
export async function loadCliUpdate(): Promise<void> {
  if (!read(env)?.cli.found) return
  const answer = await call('yt.cli.update', {})
  set(offer, answer.ok && answer.data.available ? { current: answer.data.current, latest: answer.data.latest, url: answer.data.url } : null)
}

/** The outcome of an update the worker posts: done hides the offer and reads the CLI again; a failure says why. */
export function onUpgraded(payload: unknown): void {
  if (!read(busy)) return
  set(busy, false)
  const result = unwrap(payload as never)
  if (!result.ok) return set(failure, result.message)
  set(offer, null)
  set(open, false)
  set(failure, '')
  void refreshAll()
}

async function upgrade(): Promise<void> {
  set(failure, '')
  set(busy, true)
  const answer = await call('yt.cli.upgrade', {})
  if (!answer.ok) {
    set(busy, false)
    set(failure, answer.message)
  }
}

async function skip(version: string): Promise<void> {
  const answer = await call('yt.cli.update.skip', { version })
  if (!answer.ok) return set(failure, answer.message)
  set(offer, null)
  set(open, false)
}

/** One button in the header row while a newer YouTrack CLI is on offer; it shows and hides the note. */
export function CliUpdateButton() {
  const o = read(offer)
  if (!o) return null
  return <IconButton icon="download" variant="outline" tone="accent" label={`YouTrack CLI ${o.latest} is available`} onPress={() => set(open, !read(open))} />
}

/** The note under the header: the versions, Update, the release notes and Skip this version. */
export function CliUpdateNote() {
  const o = read(offer)
  if (!o || !read(open)) return null
  const running = read(busy)
  const error = read(failure)
  return (
    <Callout tone="neutral">
      <Stack gap="xs">
        <Text>{`YouTrack CLI ${o.latest} is available. You have ${o.current}.`}</Text>
        {error ? (
          <Text tone="danger" size="sm">
            {error}
          </Text>
        ) : null}
        <Row gap="xs" wrap>
          <Button variant="solid" tone="accent" size="sm" disabled={running} onPress={() => void upgrade()}>
            {running ? 'Updating…' : 'Update'}
          </Button>
          <Button variant="ghost" size="sm" onPress={() => void openInBrowser(RELEASE_PAGE.test(o.url) ? o.url : `${RELEASES}/latest`)}>
            What's new
          </Button>
          <Button variant="ghost" size="sm" disabled={running} onPress={() => void skip(o.latest)}>
            Skip this version
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}
