import { computed, ref } from 'vue'

export type DocumentHistoryEntry = {
  kind: 'note' | 'home' | 'cosmos' | 'second-brain'
  path: string
  label: string
  stateKey: string
  payload?: unknown
}

type HistoryTarget = {
  path: string
  entry: DocumentHistoryEntry
  index: number
}

/**
 * useDocumentHistory
 *
 * Maintains linear navigation history for opened documents (back/forward),
 * similarly to browser history semantics.
 *
 * Responsibilities:
 * - Track visited paths in order.
 * - Expose current location and navigation capabilities.
 * - Support direct jumps and path replacement after rename.
 *
 * Key invariant:
 * - Calling `record` after going back discards all forward entries so the
 *   history remains a single linear timeline.
 */
export function useDocumentHistory() {
  const entries = ref<DocumentHistoryEntry[]>([])
  const index = ref(-1)

  const currentEntry = computed<DocumentHistoryEntry | null>(() => {
    if (index.value < 0 || index.value >= entries.value.length) return null
    return entries.value[index.value] ?? null
  })

  const currentPath = computed(() => {
    return currentEntry.value?.path ?? ''
  })

  const canGoBack = computed(() => index.value > 0)
  const canGoForward = computed(() => index.value >= 0 && index.value < entries.value.length - 1)
  const backTargets = computed<HistoryTarget[]>(() => {
    const out: HistoryTarget[] = []
    for (let idx = index.value - 1; idx >= 0; idx -= 1) {
      const entry = entries.value[idx]
      if (!entry) continue
      out.push({ index: idx, path: entry.path, entry })
    }
    return out
  })
  const forwardTargets = computed<HistoryTarget[]>(() => {
    const out: HistoryTarget[] = []
    for (let idx = index.value + 1; idx < entries.value.length; idx += 1) {
      const entry = entries.value[idx]
      if (!entry) continue
      out.push({ index: idx, path: entry.path, entry })
    }
    return out
  })

  /** Clears the whole navigation history. */
  function reset() {
    entries.value = []
    index.value = -1
  }

  /**
   * Appends a visited path to history and makes it current.
   *
   * Notes:
   * - Empty/whitespace paths are ignored.
   * - Re-recording the current path is ignored.
   * - If user previously went back, forward entries are dropped.
   */
  function record(path: string) {
    const target = path.trim()
    if (!target) return
    recordEntry({
      kind: 'note',
      path: target,
      label: target,
      stateKey: target
    })
  }

  /**
   * Appends a typed entry to history and makes it current.
   */
  function recordEntry(entry: DocumentHistoryEntry) {
    if (!entry.path.trim() || !entry.stateKey.trim()) return
    const current = currentEntry.value
    if (
      current &&
      current.kind === entry.kind &&
      current.path === entry.path &&
      current.stateKey === entry.stateKey
    ) {
      return
    }

    const next = index.value >= 0
      ? entries.value.slice(0, index.value + 1)
      : []

    next.push(entry)
    entries.value = next
    index.value = next.length - 1
  }

  /**
   * Moves to the previous history entry.
   * @returns The new current path, or empty string if no previous entry exists.
   */
  function goBack(): string {
    const entry = goBackEntry()
    return entry?.path ?? ''
  }

  /**
   * Moves to the previous history entry.
   * @returns The new current entry, or null if no previous entry exists.
   */
  function goBackEntry(): DocumentHistoryEntry | null {
    if (!canGoBack.value) return null
    index.value -= 1
    return entries.value[index.value] ?? null
  }

  /**
   * Moves to the next history entry.
   * @returns The new current path, or empty string if no next entry exists.
   */
  function goForward(): string {
    const entry = goForwardEntry()
    return entry?.path ?? ''
  }

  /**
   * Moves to the next history entry.
   * @returns The new current entry, or null if no next entry exists.
   */
  function goForwardEntry(): DocumentHistoryEntry | null {
    if (!canGoForward.value) return null
    index.value += 1
    return entries.value[index.value] ?? null
  }

  /**
   * Jumps to an absolute history index.
   * @returns The selected path, or empty string if index is out of range.
   */
  function jumpTo(targetIndex: number): string {
    const entry = jumpToEntry(targetIndex)
    return entry?.path ?? ''
  }

  /**
   * Jumps to an absolute history index.
   * @returns The selected entry, or null if index is out of range.
   */
  function jumpToEntry(targetIndex: number): DocumentHistoryEntry | null {
    if (targetIndex < 0 || targetIndex >= entries.value.length) return null
    index.value = targetIndex
    return entries.value[index.value] ?? null
  }

  /**
   * Rewrites all matching history entries when a document path changes.
   *
   * This keeps back/forward navigation valid after rename/move operations.
   */
  function replacePath(fromPath: string, toPath: string) {
    if (!fromPath || !toPath || fromPath === toPath) return

    let changed = false
    const next = entries.value.map((entry) => {
      if (entry.kind !== 'note' || entry.path !== fromPath) return entry
      changed = true
      return {
        ...entry,
        path: toPath,
        stateKey: toPath,
        label: entry.label === fromPath ? toPath : entry.label
      }
    })

    if (changed) {
      entries.value = next
    }
  }

  return {
    currentPath,
    currentEntry,
    currentIndex: index,
    canGoBack,
    canGoForward,
    backTargets,
    forwardTargets,
    reset,
    record,
    recordEntry,
    goBack,
    goBackEntry,
    goForward,
    goForwardEntry,
    jumpTo,
    jumpToEntry,
    replacePath
  }
}
