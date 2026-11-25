import { Button, Row, read } from 'orca'
import { appliedQuery, quickViewIds, runSearch, savedQueries } from '../listState'

/** The saved searches chosen as quick views, one press away; the one whose query the list shows is marked. */
export function QuickViews() {
  const shown = read(appliedQuery).trim()
  const saved = read(savedQueries)
  const chosen = read(quickViewIds).flatMap((id) => saved.filter((item) => item.id === id))
  if (chosen.length === 0) return null
  return (
    <Row gap="xs" wrap>
      {chosen.map((item) => (
        <Button
          key={`quick-view:${item.id}`}
          size="sm"
          variant={item.query.trim() === shown ? 'solid' : 'ghost'}
          onPress={() => void runSearch(item.query)}
        >
          {item.name}
        </Button>
      ))}
    </Row>
  )
}
