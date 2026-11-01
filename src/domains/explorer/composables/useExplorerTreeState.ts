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
      const parsed = JSON.parse(raw) as string[]
      expandedPaths.value = new Set(parsed)
    } catch {
      expandedPaths.value = new Set()
    }
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
      childrenByDir.value[dirPath] = children

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
    await loadChildren(options.folderPath.value)

    const expanded = Array.from(expandedPaths.value)
    for (const dirPath of expanded) {
      if (dirPath !== options.folderPath.value) {
        try {
          await loadChildren(dirPath)
        } catch {
          // Ignore stale expanded folders.
        }
      }
    }

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
