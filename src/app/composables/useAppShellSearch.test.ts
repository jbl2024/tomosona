import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellSearch } from './useAppShellSearch'

describe('useAppShellSearch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resets search state explicitly', () => {
    const scope = effectScope()
    const search = scope.run(() => useAppShellSearch({
      workingFolderPath: ref('/vault'),
      allWorkspaceFiles: ref(['/vault/a.md']),
      ensureAllFilesLoaded: vi.fn(async () => {}),
      toRelativePath: (path) => path.replace('/vault/', ''),
      ftsSearch: vi.fn(async () => []),
      notifyError: vi.fn()
    }))
    if (!search) throw new Error('Expected search controller')

    search.searchQuery.value = 'note'
    search.searchHits.value = [{ path: '/vault/a.md', snippet: 'a', score: 1 }]
    search.hasSearched.value = true
    search.searchLoading.value = true

    search.resetSearchState()

    expect(search.hasSearched.value).toBe(false)
    expect(search.searchLoading.value).toBe(false)
    expect(search.searchHits.value).toEqual([])
    scope.stop()
  })

  it('debounces global search and merges filename hits', async () => {
    vi.useFakeTimers()
    const ensureAllFilesLoaded = vi.fn(async () => {})
    const ftsSearch = vi.fn(async () => [{ path: '/vault/b.md', snippet: 'body hit', score: 0.4 }])

    const scope = effectScope()
    const search = scope.run(() => useAppShellSearch({
      workingFolderPath: ref('/vault'),
      allWorkspaceFiles: ref(['/vault/alpha.md', '/vault/b.md']),
      ensureAllFilesLoaded,
      toRelativePath: (path) => path.replace('/vault/', ''),
      ftsSearch,
      notifyError: vi.fn()
    }))
    if (!search) throw new Error('Expected search controller')

    search.searchQuery.value = 'a'
    await vi.advanceTimersByTimeAsync(180)

    expect(ftsSearch).toHaveBeenCalledWith('a')
    expect(search.searchHits.value.map((hit) => hit.path)).toEqual(['/vault/alpha.md', '/vault/b.md'])
    expect(search.groupedSearchResults.value).toHaveLength(2)
    expect(ensureAllFilesLoaded).not.toHaveBeenCalled()
    scope.stop()
  })

  it('loads workspace files before searching when none are cached', async () => {
    vi.useFakeTimers()
    const allWorkspaceFiles = ref<string[]>([])
    const ensureAllFilesLoaded = vi.fn(async () => {
      allWorkspaceFiles.value = ['/vault/a.md']
    })

    const scope = effectScope()
    const search = scope.run(() => useAppShellSearch({
      workingFolderPath: ref('/vault'),
      allWorkspaceFiles,
      ensureAllFilesLoaded,
      toRelativePath: (path) => path.replace('/vault/', ''),
      ftsSearch: vi.fn(async () => []),
      notifyError: vi.fn()
    }))
    if (!search) throw new Error('Expected search controller')

    search.searchQuery.value = 'a'
    await vi.advanceTimersByTimeAsync(180)

    expect(ensureAllFilesLoaded).toHaveBeenCalledTimes(1)
    expect(search.searchHits.value).toEqual([{ path: '/vault/a.md', snippet: 'filename: a.md', score: 0 }])
    scope.stop()
  })

  it('reports errors through the injected notification port', async () => {
    vi.useFakeTimers()
    const notifyError = vi.fn()

    const scope = effectScope()
    const search = scope.run(() => useAppShellSearch({
      workingFolderPath: ref('/vault'),
      allWorkspaceFiles: ref(['/vault/a.md']),
      ensureAllFilesLoaded: vi.fn(async () => {}),
      toRelativePath: (path) => path.replace('/vault/', ''),
      ftsSearch: vi.fn(async () => {
        throw new Error('boom')
      }),
      notifyError
    }))
    if (!search) throw new Error('Expected search controller')

    search.searchQuery.value = 'a'
    await vi.advanceTimersByTimeAsync(180)

    expect(notifyError).toHaveBeenCalledWith('boom')
    expect(search.searchLoading.value).toBe(false)
    scope.stop()
  })

  it('returns caret information when switching search mode', () => {
    const scope = effectScope()
    const search = scope.run(() => useAppShellSearch({
      searchQuery: ref('hello'),
      workingFolderPath: ref('/vault'),
      allWorkspaceFiles: ref([]),
      ensureAllFilesLoaded: vi.fn(async () => {}),
      toRelativePath: (path) => path,
      ftsSearch: vi.fn(async () => []),
      notifyError: vi.fn()
    }))
    if (!search) throw new Error('Expected search controller')

    const next = search.selectGlobalSearchMode('semantic')

    expect(search.searchQuery.value.startsWith('semantic:')).toBe(true)
    expect(next.caret).toBeGreaterThan(0)
    scope.stop()
  })
})
