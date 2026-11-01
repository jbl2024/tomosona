import { computed, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSelectionManager } from '../components/composables/useSelectionManager'
import { useExplorerTreeState } from './useExplorerTreeState'
import type { TreeNode } from '../../../shared/api/apiTypes'

const listChildren = vi.fn<(dirPath: string) => Promise<TreeNode[]>>()

vi.mock('../../../shared/api/workspaceApi', () => ({
  listChildren: (dirPath: string) => listChildren(dirPath)
}))

function fileNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    is_markdown: true,
    has_children: false
  }
}

function dirNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    is_markdown: false,
    has_children: true
  }
}

function createState(activePath?: string) {
  const folderPath = ref('/vault')
  const treeRef = ref<HTMLElement | null>(null)
  const selectionManager = useSelectionManager()
  const selected = ref<string[]>([])

  const state = useExplorerTreeState({
    folderPath,
    activePath: computed(() => activePath),
    treeRef,
    onSelect: (paths) => {
      selected.value = paths
    },
    selection: {
      selectedPaths: computed(() => selectionManager.selectedPaths.value),
      clearSelection: selectionManager.clearSelection,
      selectSingle: selectionManager.selectSingle
    }
  })

  return { state, treeRef, selected, selectionManager, folderPath }
}

describe('useExplorerTreeState', () => {
  afterEach(() => {
    listChildren.mockReset()
    window.localStorage.clear()
    document.body.innerHTML = ''
  })

  it('initializes the root tree and selects the first visible entry by default', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [fileNode('/vault/a.md'), fileNode('/vault/b.md')]
      }
      return []
    })

    const { state, selected } = createState()
    await state.initializeExplorer()

    expect(state.visibleRows.value.map((row) => row.path)).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(selected.value).toEqual(['/vault/a.md'])
    expect(state.focusedPath.value).toBe('/vault/a.md')
  })

  it('restores expanded folders from localStorage and loads their children', async () => {
    window.localStorage.setItem('tomosona.explorer.expanded./vault', JSON.stringify(['/vault/notes']))
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [dirNode('/vault/notes')]
      }
      if (dirPath === '/vault/notes') {
        return [fileNode('/vault/notes/today.md')]
      }
      return []
    })

    const { state } = createState()
    await state.initializeExplorer()

    expect(Array.from(state.expandedPaths.value)).toEqual(['/vault/notes'])
    expect(state.visibleRows.value.map((row) => row.path)).toEqual(['/vault/notes', '/vault/notes/today.md'])
  })

  it('sorts folders first and persists the chosen alphabetical direction', async () => {
    listChildren.mockResolvedValue([fileNode('/vault/z.md'), dirNode('/vault/b'), fileNode('/vault/a.md'), dirNode('/vault/a')])
    const { state } = createState()
    await state.initializeExplorer()
    expect(state.visibleNodePaths.value).toEqual(['/vault/a', '/vault/b', '/vault/a.md', '/vault/z.md'])
    state.setSortOrder('descending')
    expect(state.visibleNodePaths.value).toEqual(['/vault/b', '/vault/a', '/vault/z.md', '/vault/a.md'])
    const reopened = createState()
    await reopened.state.initializeExplorer()
    expect(reopened.state.visibleNodePaths.value).toEqual(['/vault/b', '/vault/a', '/vault/z.md', '/vault/a.md'])
    window.localStorage.setItem('tomosona.explorer.sort./vault', 'invalid')
    const fallback = createState()
    await fallback.state.initializeExplorer()
    expect(fallback.state.sortOrder.value).toBe('ascending')
  })

  it('keeps existing row order during an interaction and sorts after it ends', async () => {
    listChildren.mockResolvedValueOnce([fileNode('/vault/b.md'), fileNode('/vault/d.md')])
    const { state } = createState()
    await state.initializeExplorer()
    state.setSortFrozen(true)
    listChildren.mockResolvedValueOnce([fileNode('/vault/a.md'), fileNode('/vault/b.md'), fileNode('/vault/d.md')])
    await state.loadChildren('/vault')
    expect(state.visibleNodePaths.value).toEqual(['/vault/b.md', '/vault/d.md', '/vault/a.md'])
    state.setSortOrder('descending')
    expect(state.visibleNodePaths.value).toEqual(['/vault/b.md', '/vault/d.md', '/vault/a.md'])
    state.setSortFrozen(false)
    expect(state.visibleNodePaths.value).toEqual(['/vault/d.md', '/vault/b.md', '/vault/a.md'])
  })

  it('restores expanded descendants under a collapsed parent and prunes stale paths', async () => {
    window.localStorage.setItem('tomosona.explorer.expanded./vault', JSON.stringify(['/vault/parent/child', '/vault/missing', '/other/secret']))
    listChildren.mockImplementation(async (path) => {
      if (path === '/vault') return [dirNode('/vault/parent')]
      if (path === '/vault/parent') return [dirNode('/vault/parent/child')]
      return []
    })
    const { state } = createState()
    await state.initializeExplorer()
    expect([...state.expandedPaths.value]).toEqual(['/vault/parent/child'])
    expect(state.visibleRows.value.map((row) => row.path)).toEqual(['/vault/parent'])
    expect(listChildren).not.toHaveBeenCalledWith('/other/secret')
    await state.toggleExpand('/vault/parent')
    expect(state.expandedPaths.value.has('/vault/parent/child')).toBe(true)
  })

  it('ignores malformed stored expansion state', async () => {
    window.localStorage.setItem('tomosona.explorer.expanded./vault', JSON.stringify({ invalid: true }))
    listChildren.mockResolvedValue([])
    const { state } = createState()
    await state.initializeExplorer()
    expect(state.expandedPaths.value.size).toBe(0)
  })

  it('reveals a path in view and scrolls only when needed', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [dirNode('/vault/notes')]
      }
      if (dirPath === '/vault/notes') {
        return [fileNode('/vault/notes/today.md')]
      }
      return []
    })

    const { state, treeRef, selected } = createState()
    const container = document.createElement('div')
    treeRef.value = container
    document.body.appendChild(container)
    Object.defineProperty(container, 'scrollTop', { value: 40, writable: true, configurable: true })
    const scrollToSpy = vi.fn()
    Object.defineProperty(container, 'scrollTo', { value: scrollToSpy, configurable: true })

    await state.initializeExplorer()

    const row = document.createElement('div')
    row.dataset.explorerPath = '/vault/notes/today.md'
    container.appendChild(row)

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === container) {
        return { top: 100, bottom: 300 } as DOMRect
      }
      if (this === row) {
        return { top: 260, bottom: 340 } as DOMRect
      }
      return { top: 0, bottom: 0 } as DOMRect
    })

    await state.revealPathInView('/vault/notes/today.md')
    await nextTick()

    expect(selected.value).toEqual(['/vault/notes/today.md'])
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' })
    rectSpy.mockRestore()
  })

  it('expands a revealed folder so its contents are visible', async () => {
    listChildren.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/vault') {
        return [dirNode('/vault/notes')]
      }
      if (dirPath === '/vault/notes') {
        return [fileNode('/vault/notes/today.md')]
      }
      return []
    })

    const { state, selected } = createState()
    await state.initializeExplorer()
    expect(state.expandedPaths.value.has('/vault/notes')).toBe(false)

    await state.revealPathInView('/vault/notes')

    expect(state.expandedPaths.value.has('/vault/notes')).toBe(true)
    expect(selected.value).toEqual(['/vault/notes'])
  })
})
