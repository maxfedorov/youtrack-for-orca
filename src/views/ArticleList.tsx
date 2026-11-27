import { Box, Button, EmptyState, IconButton, Input, List, ListItem, Row, Select, Skeleton, Stack, Text, Tree, read, set } from 'orca'
import {
  appliedSearch, childErrors, children, chooseProject, expanded, favorites, loadArticles, loadRoots, openArticle, project, projects, projectsError,
  results, resultsCut, resultsError, resultsStatus, roots, rootsCut, rootsError, rootsStatus, runSearch, searchText, searching, syncArticles,
  toggleArticle, toggleFavorites
} from '../articleState'
import { server } from '../state'
import type { ArticleNode } from '../protocol'

/** Orca draws at most 2000 tree items; deeper branches stop there. */
const MAX_TREE_ITEMS = 2000
const CUT = 'Not all articles are shown. Search to narrow them down.'

type Item = { key: string; label: string; description: string; hasChildren?: boolean; children?: Item[] }

/** Tree items: an open article with loaded children holds them, others only say they have some. */
function treeItems(nodes: readonly ArticleNode[]): Item[] {
  const open = new Set(read(expanded))
  const loaded = read(children)
  let room = MAX_TREE_ITEMS
  const build = (list: readonly ArticleNode[], depth: number): Item[] => {
    const out: Item[] = []
    for (const node of list) {
      if (room-- <= 0) break
      const item: Item = { key: node.id, label: node.summary || node.id, description: node.id }
      const kids = loaded[node.id]
      // Orca nests at most 16 levels.
      if (open.has(node.id) && kids && depth < 16) {
        if (kids.length > 0) item.children = build(kids, depth + 1)
      } else if (node.hasChildren && depth < 16) {
        item.hasChildren = true
      }
      out.push(item)
    }
    return out
  }
  return build(nodes, 1)
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Stack gap="xs">
      <Text tone="danger">{message}</Text>
      <Row gap="xs">
        <Button variant="ghost" size="sm" onPress={onRetry}>
          Retry
        </Button>
      </Row>
    </Stack>
  )
}

function ArticleTree() {
  const status = read(rootsStatus)
  if (status === 'error') return <Retry message={read(rootsError)} onRetry={() => void loadRoots()} />
  if (status !== 'ok') return <Skeleton shape="text" lines={5} label="Loading articles" />
  if (read(roots).length === 0) return <EmptyState title="No articles in this project" />
  const failed = Object.entries(read(childErrors))
  return (
    <Stack gap="xs">
      {/* A new server or project is a new tree: Orca keeps what was open by item key otherwise. */}
      <Tree
        key={`${read(server)}|${read(project)}`}
        label="Articles"
        items={treeItems(read(roots))}
        expanded={read(expanded)}
        selected=""
        onToggle={({ key, expanded: open }: { key: string; expanded: boolean }) => toggleArticle(key, open)}
        onSelect={({ key }: { key: string }) => openArticle(key)}
      />
      {failed.length > 0 ? (
        <Text tone="danger" size="sm">
          {`Sub-articles of ${failed[0][0]} could not be loaded: ${failed[0][1]}`}
        </Text>
      ) : null}
      {read(rootsCut) ? (
        <Text muted size="sm">
          {CUT}
        </Text>
      ) : null}
    </Stack>
  )
}

function Results() {
  const status = read(resultsStatus)
  if (status === 'error') return <Retry message={read(resultsError)} onRetry={() => void runSearch(read(appliedSearch))} />
  if (status !== 'ok') return <Skeleton shape="text" lines={5} label="Searching articles" />
  const list = read(results)
  if (list.length === 0) return <EmptyState title={read(favorites) && !read(appliedSearch) ? 'No favorite articles' : 'No articles found'} />
  return (
    <Stack gap="xs">
      <List label="Articles found">
        {list.map((node) => (
          <ListItem key={node.id} title={node.summary || node.id} description={node.parent ? node.parent.summary || node.parent.id : undefined} onPress={() => openArticle(node.id)} />
        ))}
      </List>
      {read(resultsCut) ? (
        <Text muted size="sm">
          {CUT}
        </Text>
      ) : null}
    </Stack>
  )
}

export function ArticleList() {
  syncArticles()
  const list = read(projects)
  return (
    <Stack gap="sm">
      {read(projectsError) ? (
        <Retry message={read(projectsError)} onRetry={() => void loadArticles()} />
      ) : (
        <Select
          label="Project"
          value={read(project) ?? undefined}
          options={list.map((p) => ({ value: p.shortName, label: p.name && p.name !== p.shortName ? `${p.name} (${p.shortName})` : p.shortName }))}
          onChange={(value) => void chooseProject(value)}
        />
      )}
      {/* The search field takes the whole width; the star sits next to it, at the height of the field. */}
      <Box direction="row" gap="xs" align="end">
        <Box grow>
          <Input
            type="search"
            label="Search articles"
            placeholder="Search articles"
            value={read(searchText)}
            onChange={(value) => {
              set(searchText, value)
              // The native clear sends '' without Enter: back to the tree.
              if (value === '' && read(appliedSearch)) void runSearch('')
            }}
            onSubmit={(value) => void runSearch(value)}
          />
        </Box>
        <IconButton
          icon="star"
          label="Favorite articles"
          variant={read(favorites) ? 'solid' : 'outline'}
          tone={read(favorites) ? 'accent' : undefined}
          onPress={toggleFavorites}
        />
      </Box>
      {read(project) ? searching() ? <Results /> : <ArticleTree /> : read(projectsError) ? null : list.length === 0 && read(rootsStatus) === 'ok' ? <EmptyState title="No projects" /> : <Skeleton shape="text" lines={5} label="Loading articles" />}
    </Stack>
  )
}
