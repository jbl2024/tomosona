import { computed, ref, type Ref } from 'vue'

/**
 * Module: useAppQuickOpen
 *
 * Purpose:
 * - Derive quick-open and command-palette state from workspace files and actions.
 */

/** Represents a row shown in quick-open, either an existing file or a daily-note shortcut. */
export type QuickOpenResult =
  | { kind: 'file'; path: string; label: string }
  | { kind: 'daily'; date: string; path: string; label: string; exists: boolean }

/** Describes a command-palette action shown in quick-open action mode. */
export type PaletteAction = {
  id: string
  label: string
  run: () => boolean | Promise<boolean>
  closeBeforeRun?: boolean
  loadingLabel?: string
}

/** Provides the workspace and palette inputs used to derive quick-open state. */
export type UseAppQuickOpenOptions = {
  allWorkspaceFiles: Ref<string[]>
  quickOpenQuery?: Ref<string>
  quickOpenActiveIndex?: Ref<number>
  isIsoDate: (value: string) => boolean
  toRelativePath: (path: string) => string
  dailyNotePath: (root: string, date: string) => string
  workingFolderPath: Ref<string>
  paletteActions: Ref<PaletteAction[]>
  paletteActionPriority: Record<string, number>
}

/**
 * Derives quick-open search results, action matches, and list navigation state.
 */
export function useAppQuickOpen(options: UseAppQuickOpenOptions) {
  const quickOpenQuery = options.quickOpenQuery ?? ref('')
  const quickOpenActiveIndex = options.quickOpenActiveIndex ?? ref(0)

  const quickOpenIsActionMode = computed(() => quickOpenQuery.value.trimStart().startsWith('>'))
  const quickOpenActionQuery = computed(() => quickOpenQuery.value.trimStart().slice(1).trim().toLowerCase())

  const quickOpenResults = computed<QuickOpenResult[]>(() => {
    if (quickOpenIsActionMode.value) return []
    const q = quickOpenQuery.value.trim().toLowerCase()
    if (!q) return []

    const fileResults = options.allWorkspaceFiles.value
      .filter((path) => path.toLowerCase().includes(q) || options.toRelativePath(path).toLowerCase().includes(q))
      .map((path) => ({ kind: 'file' as const, path, label: options.toRelativePath(path) }))
      .slice(0, 80)

    if (!options.isIsoDate(q) || !options.workingFolderPath.value) {
      return fileResults
    }

    const path = options.dailyNotePath(options.workingFolderPath.value, q)
    const exists = options.allWorkspaceFiles.value.some((item) => item.toLowerCase() === path.toLowerCase())
    const dateResult: QuickOpenResult = {
      kind: 'daily',
      date: q,
      path,
      exists,
      label: exists ? `Open daily note ${q}` : `Create daily note ${q}`
    }

    return [dateResult, ...fileResults]
  })

  const quickOpenActionResults = computed(() => {
    if (!quickOpenIsActionMode.value) return []
    const q = quickOpenActionQuery.value
    const withRank = options.paletteActions.value
      .map((item) => {
        const label = item.label.toLowerCase()
        const matchRank = !q
          ? 0
          : label === q
            ? 0
            : label.startsWith(q)
              ? 1
              : label.includes(q)
                ? 2
                : 99
        const priority = options.paletteActionPriority[item.id] ?? Number.MAX_SAFE_INTEGER
        return { item, matchRank, priority, label }
      })
      .filter((entry) => entry.matchRank < 99)
      .sort((left, right) =>
        left.matchRank - right.matchRank ||
        left.priority - right.priority ||
        left.label.localeCompare(right.label)
      )

    return withRank.map((entry) => entry.item)
  })

  const quickOpenItemCount = computed(() =>
    quickOpenIsActionMode.value ? quickOpenActionResults.value.length : quickOpenResults.value.length
  )

  /** Moves selection with wraparound so keyboard navigation never leaves the list. */
  function moveQuickOpenSelection(delta: number) {
    const count = quickOpenItemCount.value
    if (!count) return
    quickOpenActiveIndex.value = (quickOpenActiveIndex.value + delta + count) % count
  }

  /** Sets the active list index directly, typically from pointer hover. */
  function setQuickOpenActiveIndex(index: number) {
    quickOpenActiveIndex.value = index
  }

  /** Resets query and selection together so modal reopen starts from a stable state. */
  function resetQuickOpenState(nextQuery = '') {
    quickOpenQuery.value = nextQuery
    quickOpenActiveIndex.value = 0
  }

  return {
    quickOpenQuery,
    quickOpenActiveIndex,
    quickOpenIsActionMode,
    quickOpenActionQuery,
    quickOpenResults,
    quickOpenActionResults,
    quickOpenItemCount,
    moveQuickOpenSelection,
    setQuickOpenActiveIndex,
    resetQuickOpenState
  }
}
