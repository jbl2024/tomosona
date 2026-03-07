import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEditorMountedSessions } from './useEditorMountedSessions'

describe('useEditorMountedSessions', () => {
  it('derives render paths from open paths and active path', () => {
    const openPaths = ref(['a.md', 'b.md'])
    const currentPath = ref('a.md')
    const ensureSession = vi.fn()
    const mounted = useEditorMountedSessions({
      openPaths,
      currentPath,
      ensureSession
    })

    expect(mounted.renderPaths.value).toEqual(['a.md', 'b.md'])
    expect(mounted.isRenderedPath('a.md')).toBe(true)
    expect(mounted.isActivePath('a.md')).toBe(true)
  })

  it('keeps active path rendered when open paths temporarily omit it', () => {
    const openPaths = ref(['a.md', 'b.md'])
    const currentPath = ref('b.md')
    const mounted = useEditorMountedSessions({
      openPaths,
      currentPath,
      ensureSession: () => {}
    })

    openPaths.value = []
    expect(mounted.renderPaths.value).toEqual(['b.md'])
    expect(mounted.isActivePath('b.md')).toBe(true)
  })

  it('drops closed non-active paths and keeps stable ordering', () => {
    const openPaths = ref(['a.md', 'b.md', 'c.md'])
    const currentPath = ref('b.md')
    const mounted = useEditorMountedSessions({
      openPaths,
      currentPath,
      ensureSession: () => {}
    })

    expect(mounted.renderPaths.value).toEqual(['a.md', 'b.md', 'c.md'])
    openPaths.value = ['b.md', 'c.md']
    expect(mounted.renderPaths.value).toEqual(['b.md', 'c.md'])
    currentPath.value = 'c.md'
    expect(mounted.renderPaths.value).toEqual(['b.md', 'c.md'])
  })
})
