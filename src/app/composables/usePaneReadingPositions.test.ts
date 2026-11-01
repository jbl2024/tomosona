import { describe, expect, it } from 'vitest'
import { usePaneReadingPositions } from './usePaneReadingPositions'

describe('usePaneReadingPositions', () => {
  it('keeps one position per pane and document', () => {
    const store = usePaneReadingPositions()

    store.capture('pane-1', '/vault/a.md', 120)
    store.capture('pane-2', '/vault/a.md', 640)

    expect(store.read('pane-1', '/vault/a.md')).toBe(120)
    expect(store.read('pane-2', '/vault/a.md')).toBe(640)
  })

  it('returns zero for a document it has never seen', () => {
    const store = usePaneReadingPositions()
    expect(store.read('pane-1', '/vault/unknown.md')).toBe(0)
  })

  it('rounds and clamps the stored offset', () => {
    const store = usePaneReadingPositions()

    store.capture('pane-1', '/vault/a.md', 42.6)
    expect(store.read('pane-1', '/vault/a.md')).toBe(43)

    store.capture('pane-1', '/vault/a.md', -10)
    expect(store.read('pane-1', '/vault/a.md')).toBe(0)
  })

  it('ignores an empty pane or path', () => {
    const store = usePaneReadingPositions()

    store.capture('', '/vault/a.md', 100)
    store.capture('pane-1', '', 100)

    expect(store.positions.value).toEqual({})
  })

  it('forgets a stored position', () => {
    const store = usePaneReadingPositions()
    store.capture('pane-1', '/vault/a.md', 120)

    store.forget('pane-1', '/vault/a.md')

    expect(store.read('pane-1', '/vault/a.md')).toBe(0)
  })
})
