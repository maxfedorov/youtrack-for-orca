import { Button, Callout, Card, Heading, Skeleton, Stack, Text, read } from 'orca'
import { env } from '../state'
import { askRemove } from '../removeServer'
import { defaultRepos, defaultsError, loadServerDefaults, NO_REPO, repoChoices, reposError, serversStatus, setDefaultRepo } from '../serversState'
import { Combobox } from './Combobox'
import { RemoveServerQuestion } from './RemoveServer'

/** Each server: the Orca project Start offers for it, and Remove. */
export function ServersSection() {
  const servers = read(env)?.servers ?? []
  const status = read(serversStatus)
  const repos = read(repoChoices)
  const projectsError = read(reposError)
  const saveError = read(defaultsError)
  return (
    <Stack gap="sm">
      <Heading level={3}>Servers</Heading>
      <Text muted size="sm">
        Start offers the project last used for an issue's YouTrack project; otherwise the server's default project; otherwise the current workspace's.
      </Text>
      {status === 'loading' || status === 'idle' ? <Skeleton shape="text" lines={2} label="Loading projects" /> : null}
      {projectsError ? (
        <Callout tone="warning">
          <Stack gap="xs">
            <Text>{`Projects could not be loaded: ${projectsError}`}</Text>
            <Button variant="ghost" onPress={() => void loadServerDefaults()}>
              Retry
            </Button>
          </Stack>
        </Callout>
      ) : null}
      {saveError ? (
        <Text tone="danger" size="sm">
          {saveError}
        </Text>
      ) : null}
      {servers.map((item) => (
        <Card key={item.alias} title={item.alias} description={item.url}>
          <Stack gap="sm">
            {status === 'ok' && !projectsError ? (
              <Combobox
                label={`Default project for ${item.alias}`}
                value={read(defaultRepos)[item.alias] ?? NO_REPO}
                placeholder="A project no longer in Orca"
                options={[{ value: NO_REPO, label: 'None' }, ...repos.map((repo) => ({ value: repo.id, label: repo.name }))]}
                onChange={(value) => void setDefaultRepo(item.alias, value)}
              />
            ) : null}
            <Button variant="outline" tone="danger" icon="delete" onPress={() => askRemove(item.alias, 'servers')}>
              {`Remove ${item.alias}`}
            </Button>
            <RemoveServerQuestion from="servers" alias={item.alias} />
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}
