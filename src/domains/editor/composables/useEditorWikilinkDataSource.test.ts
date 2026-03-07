import { describe, expect, it, vi } from 'vitest'
import { useEditorWikilinkDataSource } from './useEditorWikilinkDataSource'

describe('useEditorWikilinkDataSource', () => {
  it('uses targets cache within ttl', async () => {
    vi.useFakeTimers()
    const loadTargets = vi.fn(async () => ['a.md'])
    const source = useEditorWikilinkDataSource({
      loadLinkTargets: loadTargets,
      loadLinkHeadings: async () => [],
      targetsTtlMs: 1_000
    })

    await source.loadWikilinkTargets()
    await source.loadWikilinkTargets()

    expect(loadTargets).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('returns fallback values on load failures', async () => {
    const source = useEditorWikilinkDataSource({
      loadLinkTargets: async () => {
        throw new Error('fail')
      },
      loadLinkHeadings: async () => {
        throw new Error('fail')
      }
    })

    await expect(source.loadWikilinkTargets()).resolves.toEqual([])
    await expect(source.loadWikilinkHeadings('a.md')).resolves.toEqual([])
  })

  it('resolves target existence using parsed note path', async () => {
    const source = useEditorWikilinkDataSource({
      loadLinkTargets: async () => ['notes/a.md', 'b.md'],
      loadLinkHeadings: async () => []
    })

    await expect(source.resolveWikilinkTarget('notes/a.md#H1')).resolves.toBe(true)
    await expect(source.resolveWikilinkTarget('notes/missing.md')).resolves.toBe(false)
    await expect(source.resolveWikilinkTarget('#heading-only')).resolves.toBe(true)
  })
})
