import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { applySearchMode, detectSearchMode, type SearchMode } from '../../shared/lib/searchMode'

/** Search hit rendered by the shell sidebar and quick navigation flows. */
export type AppShellSearchHit = {
  path: string
  snippet: string
  score: number
}

/** Grouped search rows keyed by workspace path for sidebar rendering. */
export type AppShellSearchResultGroup = {
  path: string
  items: AppShellSearchHit[]
}

/** Declares the dependencies required by the shell search controller. */
export type UseAppShellSearchOptions = {
  searchQuery?: Ref<string>
  workingFolderPath: Readonly<Ref<string>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  ensureAllFilesLoaded: () => Promise<void>
  toRelativePath: (path: string) => string
  ftsSearch: (query: string) => Promise<AppShellSearchHit[]>
  notifyError: (message: string) => void
}

/**
 * Owns shell-global search state, debounce scheduling, grouped sidebar rows,
 * and mode switching derived from the current query.
 */
export function useAppShellSearch(options: UseAppShellSearchOptions) {
  const searchQuery = options.searchQuery ?? ref('')
  const searchHits = ref<AppShellSearchHit[]>([])
  const searchLoading = ref(false)
  const hasSearched = ref(false)
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let searchRequestToken = 0

  const groupedSearchResults = computed<AppShellSearchResultGroup[]>(() => {
    const groups: AppShellSearchResultGroup[] = []
    const byPath = new Map<string, AppShellSearchHit[]>()
    for (const hit of searchHits.value) {
      if (!byPath.has(hit.path)) {
        byPath.set(hit.path, [])
      }
      byPath.get(hit.path)!.push(hit)
    }
    for (const [path, items] of byPath.entries()) {
      groups.push({ path, items })
    }
    return groups
  })

  const globalSearchMode = computed<SearchMode>(() => detectSearchMode(searchQuery.value))
  const showSearchScore = computed(() => globalSearchMode.value === 'semantic')

  function resetSearchState() {
    searchRequestToken += 1
    hasSearched.value = false
    searchLoading.value = false
    searchHits.value = []
  }

  async function runGlobalSearch() {
    const q = searchQuery.value.trim()
    if (!q || !options.workingFolderPath.value) {
      resetSearchState()
      return
    }

    const requestToken = ++searchRequestToken
    hasSearched.value = true
    searchLoading.value = true
    try {
      if (!options.allWorkspaceFiles.value.length) {
        await options.ensureAllFilesLoaded()
      }
      const ftsHits = await options.ftsSearch(q)
      const qLower = q.toLowerCase()
      const filenameHits = options.allWorkspaceFiles.value
        .filter((path) => options.toRelativePath(path).toLowerCase().includes(qLower))
        .map((path) => ({
          path,
          snippet: `filename: ${options.toRelativePath(path)}`,
          score: 0
        }))

      const merged = [...filenameHits, ...ftsHits]
      const dedupe = new Set<string>()
      const deduped = merged.filter((hit) => {
        const key = `${hit.path}::${hit.snippet}`
        if (dedupe.has(key)) return false
        dedupe.add(key)
        return true
      })
      if (requestToken === searchRequestToken) {
        searchHits.value = deduped
      }
    } catch (err) {
      if (requestToken === searchRequestToken) {
        options.notifyError(err instanceof Error ? err.message : 'Search failed.')
      }
    } finally {
      if (requestToken === searchRequestToken) {
        searchLoading.value = false
      }
    }
  }

  function selectGlobalSearchMode(mode: SearchMode) {
    const next = applySearchMode(searchQuery.value, mode)
    searchQuery.value = next.value
    return next
  }

  function dispose() {
    if (!searchDebounceTimer) return
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }

  watch(searchQuery, (next) => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    if (!next.trim() || !options.workingFolderPath.value) {
      resetSearchState()
      return
    }
    searchDebounceTimer = setTimeout(() => {
      void runGlobalSearch()
    }, 180)
  })

  onScopeDispose(dispose)

  return {
    searchQuery,
    searchHits,
    searchLoading,
    hasSearched,
    groupedSearchResults,
    globalSearchMode,
    showSearchScore,
    resetSearchState,
    runGlobalSearch,
    selectGlobalSearchMode,
    dispose
  }
}
