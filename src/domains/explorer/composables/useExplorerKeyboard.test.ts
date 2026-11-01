import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useExplorerKeyboard } from './useExplorerKeyboard'
import type { TreeNode } from '../../../shared/api/apiTypes'

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

function createKeyboard() {
  const focusedPath = ref('/vault/folder')
  const selected = ref<string[]>(['/vault/folder'])
  const openPreview = vi.fn()
  const visibleNodePaths = computed(() => ['/vault/folder', '/vault/folder/a.md'])
  const childrenByDir = ref<Record<string, TreeNode[]>>({
    '/vault/folder': [fileNode('/vault/folder/a.md')]
  })

  const keyboard = useExplorerKeyboard({
    folderPath: ref('/vault'),
    focusedPath,
    visibleNodePaths,
    parentByPath: ref<Record<string, string>>({
      '/vault/folder': '/vault',
      '/vault/folder/a.md': '/vault/folder'
    }),
    childrenByDir,
    nodeByPath: ref<Record<string, TreeNode>>({
      '/vault/folder': dirNode('/vault/folder'),
      '/vault/folder/a.md': fileNode('/vault/folder/a.md')
    }),
    expandedPaths: ref(new Set<string>()),
    selectionPaths: computed(() => selected.value),
    isMac: false,
    selectSingle: (path) => {
      selected.value = [path]
    },
    selectRange: (path) => {
      selected.value = ['/vault/folder', path]
    },
    openPreview,
    setSelection: (paths) => {
      selected.value = paths
    },
    emitSelection: vi.fn(),
    ensureFocusedPath: () => focusedPath.value,
    toggleExpand: vi.fn(async (path: string) => {
      if (path === '/vault/folder') {
        focusedPath.value = '/vault/folder'
      }
    }),
    openNode: vi.fn(async () => {}),
    startRename: vi.fn(),
    requestDelete: vi.fn(),
    setClipboard: vi.fn(),
    runPaste: vi.fn(async () => {}),
    requestCreate: vi.fn()
  })

  return { keyboard, focusedPath, selected, openPreview }
}

describe('useExplorerKeyboard', () => {
  it('navigates down and emits the updated selection', async () => {
    const { keyboard, focusedPath, selected } = createKeyboard()
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
    vi.spyOn(event, 'preventDefault')

    await keyboard.onTreeKeydown(event)

    expect(focusedPath.value).toBe('/vault/folder/a.md')
    expect(selected.value).toEqual(['/vault/folder/a.md'])
  })

  it('opens a read-only preview with Space without changing selection or opening the note', async () => {
    const { keyboard, focusedPath, selected, openPreview } = createKeyboard()
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    vi.spyOn(event, 'preventDefault')

    await keyboard.onTreeKeydown(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(openPreview).toHaveBeenCalledWith('/vault/folder')
    expect(focusedPath.value).toBe('/vault/folder')
    expect(selected.value).toEqual(['/vault/folder'])
  })

  it('ignores shortcuts from text inputs', async () => {
    const { keyboard, focusedPath } = createKeyboard()
    const input = document.createElement('input')
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
    Object.defineProperty(event, 'target', { value: input })

    await keyboard.onTreeKeydown(event)

    expect(focusedPath.value).toBe('/vault/folder')
  })

  it('selects all siblings with ctrl+a', async () => {
    const { keyboard, selected, focusedPath } = createKeyboard()
    focusedPath.value = '/vault/folder/a.md'
    selected.value = ['/vault/folder/a.md']
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })
    vi.spyOn(event, 'preventDefault')

    await keyboard.onTreeKeydown(event)

    expect(selected.value).toEqual(['/vault/folder/a.md'])
  })
})
