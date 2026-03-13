import { computed, ref, type ComputedRef } from 'vue'

/**
 * Module: useConstitutedContext
 *
 * Purpose:
 * - Own the editor-shell "contexte constitue" state used by the right pane.
 *
 * Boundaries:
 * - Tracks only explicit note selections retained by the user.
 * - Keeps note-local context separate from explicitly pinned session context.
 * - Does not persist to disk or localStorage in V1.
 */

/** Distinguishes note-local context from the explicitly pinned session context. */
export type ConstitutedContextMode = 'local' | 'pinned'

/** Minimal note record rendered by the right-pane context list. */
export type ConstitutedContextItem = {
  path: string
  title: string
}

/** Public surface for the constituted-context controller. */
export type ConstitutedContextController = {
  anchorPath: ComputedRef<string>
  localItems: ComputedRef<ConstitutedContextItem[]>
  localPaths: ComputedRef<string[]>
  pinnedItems: ComputedRef<ConstitutedContextItem[]>
  pinnedPaths: ComputedRef<string[]>
  mode: ComputedRef<ConstitutedContextMode>
  paths: ComputedRef<string[]>
  items: ComputedRef<ConstitutedContextItem[]>
  isEmpty: ComputedRef<boolean>
  count: ComputedRef<number>
  contains: (path: string) => boolean
  containsLocal: (path: string) => boolean
  containsPinned: (path: string) => boolean
  resetForAnchor: (path: string) => void
  add: (path: string, anchorPath: string, resolver?: (path: string) => ConstitutedContextItem) => void
  removeLocal: (path: string) => void
  removePinned: (path: string) => void
  remove: (path: string) => void
  toggle: (path: string, anchorPath: string, resolver?: (path: string) => ConstitutedContextItem) => void
  pin: () => void
  clearLocal: () => void
  clearPinned: () => void
  clear: () => void
  replace: (
    paths: string[],
    anchorPath: string,
    mode?: ConstitutedContextMode,
    resolver?: (path: string) => ConstitutedContextItem
  ) => void
}

type UseConstitutedContextOptions = {
  resolveItem?: (path: string) => ConstitutedContextItem
}

function defaultResolveItem(path: string): ConstitutedContextItem {
  const normalized = String(path ?? '').trim()
  const filename = normalized.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? ''
  return {
    path: normalized,
    title: filename || 'Untitled'
  }
}

/**
 * Creates the right-pane constituted-context state machine.
 *
 * Important behavior:
 * - `resetForAnchor` clears only note-local items and keeps pinned items intact.
 * - `replace` keeps first-seen order and drops empty / duplicate paths.
 * - callers may provide a resolver to keep rendered titles in sync with shell naming.
 */
export function useConstitutedContext(
  options: UseConstitutedContextOptions = {}
): ConstitutedContextController {
  const resolveItem = options.resolveItem ?? defaultResolveItem
  const anchorPathState = ref('')
  const localItemsState = ref<ConstitutedContextItem[]>([])
  const pinnedItemsState = ref<ConstitutedContextItem[]>([])

  function normalizePath(path: string): string {
    return String(path ?? '').trim()
  }

  function dedupeItems(paths: string[], resolver: (path: string) => ConstitutedContextItem): ConstitutedContextItem[] {
    const seen = new Set<string>()
    const out: ConstitutedContextItem[] = []
    for (const rawPath of paths) {
      const path = normalizePath(rawPath)
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push(resolver(path))
    }
    return out
  }

  function dedupeExistingItems(items: ConstitutedContextItem[]): ConstitutedContextItem[] {
    const seen = new Set<string>()
    const out: ConstitutedContextItem[] = []
    for (const item of items) {
      const path = normalizePath(item.path)
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push({ ...item, path })
    }
    return out
  }

  function containsIn(items: ConstitutedContextItem[], path: string): boolean {
    const normalized = normalizePath(path)
    return normalized.length > 0 && items.some((item) => item.path === normalized)
  }

  function containsLocal(path: string): boolean {
    return containsIn(localItemsState.value, path)
  }

  function containsPinned(path: string): boolean {
    return containsIn(pinnedItemsState.value, path)
  }

  function contains(path: string): boolean {
    return containsLocal(path) || containsPinned(path)
  }

  function resetForAnchor(path: string) {
    const normalizedAnchor = normalizePath(path)
    anchorPathState.value = normalizedAnchor
    localItemsState.value = []
  }

  function add(path: string, anchorPath: string, resolver: (path: string) => ConstitutedContextItem = resolveItem) {
    const normalizedAnchor = normalizePath(anchorPath)
    if (normalizedAnchor) {
      anchorPathState.value = normalizedAnchor
    }
    const normalized = normalizePath(path)
    if (!normalized || containsLocal(normalized)) return
    localItemsState.value = [...localItemsState.value, resolver(normalized)]
  }

  function removeLocal(path: string) {
    const normalized = normalizePath(path)
    if (!normalized) return
    localItemsState.value = localItemsState.value.filter((item) => item.path !== normalized)
  }

  function removePinned(path: string) {
    const normalized = normalizePath(path)
    if (!normalized) return
    pinnedItemsState.value = pinnedItemsState.value.filter((item) => item.path !== normalized)
  }

  function remove(path: string) {
    removeLocal(path)
    removePinned(path)
  }

  function toggle(path: string, anchorPath: string, resolver: (path: string) => ConstitutedContextItem = resolveItem) {
    if (contains(path)) {
      remove(path)
      return
    }
    add(path, anchorPath, resolver)
  }

  function pin() {
    if (!localItemsState.value.length) return
    pinnedItemsState.value = dedupeItems(
      [...pinnedItemsState.value.map((item) => item.path), ...localItemsState.value.map((item) => item.path)],
      resolveItem
    )
  }

  function clearLocal() {
    localItemsState.value = []
  }

  function clearPinned() {
    pinnedItemsState.value = []
  }

  function clear() {
    clearLocal()
    clearPinned()
  }

  function replace(
    paths: string[],
    anchorPath: string,
    mode: ConstitutedContextMode = pinnedItemsState.value.length > 0 ? 'pinned' : 'local',
    resolver: (path: string) => ConstitutedContextItem = resolveItem
  ) {
    anchorPathState.value = normalizePath(anchorPath)
    if (mode === 'pinned') {
      pinnedItemsState.value = dedupeItems(paths, resolver)
      return
    }
    localItemsState.value = dedupeItems(paths, resolver)
  }

  const mode = computed<ConstitutedContextMode>(() => pinnedItemsState.value.length > 0 ? 'pinned' : 'local')
  const items = computed(() => dedupeExistingItems([...localItemsState.value, ...pinnedItemsState.value]))

  return {
    anchorPath: computed(() => anchorPathState.value),
    localItems: computed(() => localItemsState.value),
    localPaths: computed(() => localItemsState.value.map((item) => item.path)),
    pinnedItems: computed(() => pinnedItemsState.value),
    pinnedPaths: computed(() => pinnedItemsState.value.map((item) => item.path)),
    mode,
    paths: computed(() => items.value.map((item) => item.path)),
    items,
    isEmpty: computed(() => items.value.length === 0),
    count: computed(() => items.value.length),
    contains,
    containsLocal,
    containsPinned,
    resetForAnchor,
    add,
    removeLocal,
    removePinned,
    remove,
    toggle,
    pin,
    clearLocal,
    clearPinned,
    clear,
    replace
  }
}
