import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import type { TreeNode } from '../../../shared/api/apiTypes'
import { listChildren } from '../../../shared/api/workspaceApi'
import { computeRevealScrollTop } from '../lib/revealScroll'
import {
  escapeSelectorValue,
  getAncestorDirs,
  type RevealPathOptions
} from '../lib/explorerTreeUtils'

/** Render row derived from the loaded explorer tree state. */
export type ExplorerVisibleRow = {
  path: string
  depth: number
}

/** Declares the dependencies required by the explorer tree state controller. */
export type UseExplorerTreeStateOptions = {
  folderPath: Readonly<Ref<string>>
  activePath: Readonly<Ref<string | undefined>>
  treeRef: Readonly<Ref<HTMLElement | null>>
  onSelect: (paths: string[]) => void
  selection: {
    selectedPaths: Readonly<ComputedRef<string[]>>
    clearSelection: () => void
    selectSingle: (path: string) => void
  }
}

/**
 * Owns explorer tree cache state, expansion persistence, visible row
 * derivation, and reveal-in-view behavior for the current workspace.
 */
export function useExplorerTreeState(options: UseExplorerTreeStateOptions) {
  const childrenByDir = ref<Record<string, TreeNode[]>>({})
  const nodeByPath = ref<Record<string, TreeNode>>({})
  const parentByPath = ref<Record<string, string>>({})
  const expandedPaths = ref<Set<string>>(new Set())
  const loadingDirs = ref<Set<string>>(new Set())
  const pendingReloadDirs = ref<Set<string>>(new Set())
  const focusedPath = ref('')
  const sortOrder = ref<'ascending' | 'descending'>('ascending')
  let sortFrozen = false

  const visibleRows = computed<ExplorerVisibleRow[]>(() => {
    const rows: ExplorerVisibleRow[] = []
    const root = options.folderPath.value
    if (!root) return rows

    const pushDir = (dirPath: string, depth: number) => {
      const children = childrenByDir.value[dirPath] ?? []

      for (const child of children) {
        rows.push({ path: child.path, depth })
        if (child.is_dir && expandedPaths.value.has(child.path)) {
          pushDir(child.path, depth + 1)
        }
      }
    }

    pushDir(root, 0)
    return rows
  })

  const visibleNodePaths = computed(() => visibleRows.value.map((row) => row.path))

  function expandedStorageKey(): string {
    return `tomosona.explorer.expanded.${options.folderPath.value}`
  }

  function persistExpandedState() {
    if (!options.folderPath.value) return
    window.localStorage.setItem(expandedStorageKey(), JSON.stringify(Array.from(expandedPaths.value)))
  }

  function loadExpandedState() {
    if (!options.folderPath.value) return
    const raw = window.localStorage.getItem(expandedStorageKey())
    if (!raw) return

    try {
      const parsed: unknown = JSON.parse(raw)
      expandedPaths.value = new Set(Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : [])
    } catch {
      expandedPaths.value = new Set()
    }
  }

  function sortChildren(children: TreeNode[]): TreeNode[] {
    const direction = sortOrder.value === 'ascending' ? 1 : -1
    return [...children].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      return direction * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }

  function applySort() {
    for (const dir of Object.keys(childrenByDir.value)) childrenByDir.value[dir] = sortChildren(childrenByDir.value[dir])
  }

  /** Defers reordering while the user is editing or selecting tree rows. */
  function setSortFrozen(frozen: boolean) {
    if (sortFrozen === frozen) return
    sortFrozen = frozen
    if (!frozen) applySort()
  }

  function setSortOrder(order: 'ascending' | 'descending') {
    sortOrder.value = order
    if (options.folderPath.value) window.localStorage.setItem(`tomosona.explorer.sort.${options.folderPath.value}`, order)
    if (!sortFrozen) applySort()
  }

  async function loadChildren(dirPath: string) {
    if (!options.folderPath.value) return
    if (loadingDirs.value.has(dirPath)) {
      pendingReloadDirs.value = new Set(pendingReloadDirs.value).add(dirPath)
      return
    }

    const nextLoading = new Set(loadingDirs.value)
    nextLoading.add(dirPath)
    loadingDirs.value = nextLoading

    try {
      const children = await listChildren(dirPath)
      const previous = childrenByDir.value[dirPath]
      if (sortFrozen && previous) {
        const byPath = new Map(children.map((child) => [child.path, child]))
        const retained = previous.flatMap((child) => {
          const updated = byPath.get(child.path)
          byPath.delete(child.path)
          return updated ? [updated] : []
        })
        childrenByDir.value[dirPath] = [...retained, ...sortChildren([...byPath.values()])]
      } else {
        childrenByDir.value[dirPath] = sortChildren(children)
      }

      for (const child of children) {
        nodeByPath.value[child.path] = child
        parentByPath.value[child.path] = dirPath
      }
    } finally {
      const done = new Set(loadingDirs.value)
      done.delete(dirPath)
      loadingDirs.value = done

      if (pendingReloadDirs.value.has(dirPath)) {
        const nextPending = new Set(pendingReloadDirs.value)
        nextPending.delete(dirPath)
        pendingReloadDirs.value = nextPending
        await loadChildren(dirPath)
      }
    }
  }

  async function toggleExpand(path: string) {
    const expanded = new Set(expandedPaths.value)
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
      await loadChildren(path)
    }
    expandedPaths.value = expanded
    persistExpandedState()
  }

  async function expandAllDirs() {
    if (!options.folderPath.value) return

    const allDirs = new Set<string>()
    const queue: string[] = [options.folderPath.value]
    const visited = new Set<string>()

    while (queue.length) {
      const dir = queue.shift()
      if (!dir || visited.has(dir)) continue
      visited.add(dir)
      await loadChildren(dir)

      const children = childrenByDir.value[dir] ?? []
      for (const child of children) {
        if (!child.is_dir) continue
        allDirs.add(child.path)
        queue.push(child.path)
      }
    }

    expandedPaths.value = allDirs
    persistExpandedState()
  }

  /**
   * Loads every directory under the current workspace without changing the
   * user's expansion state. Explorer filtering uses this to search beyond the
   * rows that happen to be expanded right now.
   */
  async function preloadAllDirs() {
    if (!options.folderPath.value) return

    const queue: string[] = [options.folderPath.value]
    const visited = new Set<string>()

    while (queue.length) {
      const dir = queue.shift()
      if (!dir || visited.has(dir)) continue
      visited.add(dir)
      await loadChildren(dir)

      const children = childrenByDir.value[dir] ?? []
      for (const child of children) {
        if (child.is_dir) {
          queue.push(child.path)
        }
      }
    }
  }

  function collapseAllDirs() {
    expandedPaths.value = new Set()
    persistExpandedState()
  }

  function focusTree() {
    options.treeRef.value?.focus()
  }

  function resetState() {
    childrenByDir.value = {}
    nodeByPath.value = {}
    parentByPath.value = {}
    expandedPaths.value = new Set()
    pendingReloadDirs.value = new Set()
    options.selection.clearSelection()
    focusedPath.value = ''
  }

  function emitCurrentSelection() {
    options.onSelect(options.selection.selectedPaths.value)
  }

  async function initializeExplorer() {
    if (!options.folderPath.value) {
      resetState()
      return
    }

    loadExpandedState()
    sortOrder.value = window.localStorage.getItem(`tomosona.explorer.sort.${options.folderPath.value}`) === 'descending' ? 'descending' : 'ascending'
    await loadChildren(options.folderPath.value)

    // A collapsed parent can still contain remembered expanded descendants.
    // Load their ancestors without expanding them, and discard stale paths.
    const expanded = Array.from(expandedPaths.value).sort((a, b) => a.length - b.length)
    const restored = new Set<string>()
    for (const dirPath of expanded) {
      const ancestors = getAncestorDirs(options.folderPath.value, dirPath)
      const root = options.folderPath.value.replace(/\/+$/, '')
      if (!dirPath.startsWith(`${root}/`) || dirPath.split('/').some((part) => part === '..' || part === '.')) continue
      try {
        let valid = true
        for (const path of [...ancestors, dirPath]) {
          if (!nodeByPath.value[path]?.is_dir) { valid = false; break }
          if (!childrenByDir.value[path]) await loadChildren(path)
        }
        if (valid) restored.add(dirPath)
      } catch {
        // An externally removed or unreadable folder cannot be restored.
      }
    }
    expandedPaths.value = restored
    persistExpandedState()

    if (!options.selection.selectedPaths.value.length && visibleNodePaths.value.length) {
      options.selection.selectSingle(visibleNodePaths.value[0])
      focusedPath.value = visibleNodePaths.value[0]
      emitCurrentSelection()
    }
  }

  async function revealPath(path: string) {
    if (!path || !options.folderPath.value) return
    await loadChildren(options.folderPath.value)
    const ancestors = getAncestorDirs(options.folderPath.value, path)
    for (const dir of ancestors) {
      if (!expandedPaths.value.has(dir)) {
        expandedPaths.value = new Set(expandedPaths.value).add(dir)
        await loadChildren(dir)
      }
    }
    persistExpandedState()
    options.selection.selectSingle(path)
    focusedPath.value = path
    emitCurrentSelection()
  }

  async function revealPathInView(path: string, revealOptions: RevealPathOptions = {}) {
    await revealPath(path)
    await nextTick()
    const container = options.treeRef.value
    if (!container) return
    const selector = `[data-explorer-path="${escapeSelectorValue(path)}"]`
    const row = container.querySelector<HTMLElement>(selector)
    if (row) {
      const nextTop = computeRevealScrollTop(
        {
          top: container.getBoundingClientRect().top,
          bottom: container.getBoundingClientRect().bottom,
          scrollTop: container.scrollTop
        },
        row.getBoundingClientRect()
      )
      if (nextTop !== null) {
        container.scrollTo({
          top: nextTop,
          behavior: revealOptions.behavior ?? 'smooth'
        })
      }
    }
    if (revealOptions.focusTree) {
      focusTree()
    }
  }

  return {
    childrenByDir,
    nodeByPath,
    parentByPath,
    expandedPaths,
    loadingDirs,
    pendingReloadDirs,
    focusedPath,
    sortOrder,
    setSortOrder,
    setSortFrozen,
    visibleRows,
    visibleNodePaths,
    loadChildren,
    toggleExpand,
    expandAllDirs,
    collapseAllDirs,
    preloadAllDirs,
    focusTree,
    initializeExplorer,
    revealPath,
    revealPathInView,
    persistExpandedState,
    resetState
  }
}
