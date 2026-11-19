import { Button, Row, read } from 'orca'
import { appliedQuery, runSearch } from '../listState'

/** Common searches one press away; the one whose query the list shows is marked. */
export const QUICK_VIEWS = [
  { label: 'Assigned to me', query: 'for: me #Unresolved' },
  { label: 'Reported by me', query: 'reporter: me #Unresolved' },
  { label: 'Commented by me', query: 'commenter: me sort by: updated desc' },
  { label: 'All open', query: '#Unresolved sort by: updated desc' }
] as const

export function QuickViews() {
  const shown = read(appliedQuery).trim()
  return (
    <Row gap="xs" wrap>
      {QUICK_VIEWS.map((quick) => (
        <Button
          key={quick.label}
          size="sm"
          variant={quick.query === shown ? 'solid' : 'ghost'}
          onPress={() => void runSearch(quick.query)}
        >
          {quick.label}
        </Button>
      ))}
    </Row>
  )
}
