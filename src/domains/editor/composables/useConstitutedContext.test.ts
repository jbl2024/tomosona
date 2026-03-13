import { describe, expect, it } from 'vitest'
import { useConstitutedContext } from './useConstitutedContext'

describe('useConstitutedContext', () => {
  it('adds notes without duplicates and resolves titles', () => {
    const state = useConstitutedContext({
      resolveItem: (path) => ({ path, title: path.split('/').pop() ?? path })
    })

    state.add('/vault/a.md', '/vault/anchor.md')
    state.add('/vault/a.md', '/vault/anchor.md')
    state.add('/vault/b.md', '/vault/anchor.md')

    expect(state.anchorPath.value).toBe('/vault/anchor.md')
    expect(state.localPaths.value).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(state.localItems.value.map((item) => item.title)).toEqual(['a.md', 'b.md'])
    expect(state.count.value).toBe(2)
    expect(state.contains('/vault/a.md')).toBe(true)
  })

  it('removes and toggles items', () => {
    const state = useConstitutedContext()

    state.toggle('/vault/a.md', '/vault/anchor.md')
    expect(state.localPaths.value).toEqual(['/vault/a.md'])

    state.toggle('/vault/a.md', '/vault/anchor.md')
    expect(state.localPaths.value).toEqual([])

    state.add('/vault/b.md', '/vault/anchor.md')
    state.remove('/vault/b.md')
    expect(state.isEmpty.value).toBe(true)
  })

  it('keeps pinned context across anchor resets while local context resets', () => {
    const state = useConstitutedContext()

    state.add('/vault/a.md', '/vault/anchor-a.md')
    state.resetForAnchor('/vault/anchor-b.md')
    expect(state.mode.value).toBe('local')
    expect(state.anchorPath.value).toBe('/vault/anchor-b.md')
    expect(state.localPaths.value).toEqual([])

    state.add('/vault/b.md', '/vault/anchor-b.md')
    state.pin()
    state.resetForAnchor('/vault/anchor-c.md')
    expect(state.mode.value).toBe('pinned')
    expect(state.anchorPath.value).toBe('/vault/anchor-c.md')
    expect(state.localPaths.value).toEqual([])
    expect(state.pinnedPaths.value).toEqual(['/vault/b.md'])
    expect(state.paths.value).toEqual(['/vault/b.md'])
  })

  it('pins local context without erasing it and clears stores independently', () => {
    const state = useConstitutedContext()

    state.add('/vault/a.md', '/vault/anchor.md')
    state.pin()
    state.add('/vault/b.md', '/vault/anchor.md')

    expect(state.localPaths.value).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(state.pinnedPaths.value).toEqual(['/vault/a.md'])
    expect(state.paths.value).toEqual(['/vault/a.md', '/vault/b.md'])

    state.clearPinned()
    expect(state.localPaths.value).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(state.pinnedPaths.value).toEqual([])
    expect(state.mode.value).toBe('local')
  })

  it('replaces local or pinned state explicitly and can clear all context', () => {
    const state = useConstitutedContext()

    state.replace(
      ['/vault/a.md', '', '/vault/a.md', '/vault/c.md'],
      '/vault/anchor.md',
      'local',
      (path) => ({ path, title: `title:${path}` })
    )
    state.replace(
      ['/vault/d.md', '/vault/d.md'],
      '/vault/anchor.md',
      'pinned',
      (path) => ({ path, title: `title:${path}` })
    )

    expect(state.mode.value).toBe('pinned')
    expect(state.anchorPath.value).toBe('/vault/anchor.md')
    expect(state.localItems.value).toEqual([
      { path: '/vault/a.md', title: 'title:/vault/a.md' },
      { path: '/vault/c.md', title: 'title:/vault/c.md' }
    ])
    expect(state.pinnedItems.value).toEqual([
      { path: '/vault/d.md', title: 'title:/vault/d.md' }
    ])
    expect(state.items.value).toEqual([
      { path: '/vault/a.md', title: 'title:/vault/a.md' },
      { path: '/vault/c.md', title: 'title:/vault/c.md' },
      { path: '/vault/d.md', title: 'title:/vault/d.md' }
    ])

    state.replace(
      ['/vault/a.md'],
      '/vault/anchor.md',
      'pinned',
      (path) => ({ path, title: `title:${path}` })
    )
    expect(state.pinnedPaths.value).toEqual(['/vault/a.md'])
    expect(state.containsPinned('/vault/a.md')).toBe(true)

    state.clear()
    expect(state.localItems.value).toEqual([])
    expect(state.pinnedItems.value).toEqual([])
    expect(state.items.value).toEqual([])
    expect(state.isEmpty.value).toBe(true)
  })
})
