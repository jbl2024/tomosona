import type { ComputedRef, Ref } from 'vue'
import type { EntryKind, TreeNode } from '../../../shared/api/apiTypes'

/** Declares the ports required by the explorer keyboard controller. */
export type UseExplorerKeyboardOptions = {
  folderPath: Readonly<Ref<string>>
  focusedPath: Ref<string>
  visibleNodePaths: Readonly<ComputedRef<string[]>>
  parentByPath: Readonly<Ref<Record<string, string>>>
  childrenByDir: Readonly<Ref<Record<string, TreeNode[]>>>
  nodeByPath: Readonly<Ref<Record<string, TreeNode>>>
  expandedPaths: Readonly<Ref<Set<string>>>
  selectionPaths: Readonly<ComputedRef<string[]>>
  isMac: boolean
  selectSingle: (path: string) => void
  selectRange: (path: string, orderedPaths: string[]) => void
  toggleSelection: (path: string) => void
  setSelection: (paths: string[]) => void
  emitSelection: (paths: string[]) => void
  ensureFocusedPath: (defaultToFirst?: boolean) => string
  toggleExpand: (path: string) => Promise<void>
  openNode: (path: string) => Promise<void>
  startRename: (path: string) => void
  requestDelete: (paths: string[]) => void
  setClipboard: (mode: 'copy' | 'cut', paths: string[]) => void
  runPaste: () => Promise<void>
  requestCreate: (parentPath: string, entryKind: EntryKind) => void
}

/**
 * Owns explorer-local keyboard routing. It only coordinates existing state and
 * actions and intentionally does not perform filesystem work directly.
 */
export function useExplorerKeyboard(options: UseExplorerKeyboardOptions) {
  async function onTreeKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (target) {
      const tag = target.tagName.toLowerCase()
      const isTextInput = tag === 'input' || tag === 'textarea'
      const isEditable = target.isContentEditable
      if (isTextInput || isEditable) {
        return
      }
    }

    const ordered = options.visibleNodePaths.value
    if (!ordered.length) return

    const focused = options.ensureFocusedPath()
    if (!focused) return

    const currentIndex = ordered.indexOf(focused)
    const key = event.key
    const ctrlOrMeta = options.isMac ? event.metaKey : event.ctrlKey

    if (key === 'ArrowDown') {
      event.preventDefault()
      const next = ordered[Math.min(currentIndex + 1, ordered.length - 1)]
      if (!next) return
      if (event.shiftKey) {
        options.selectRange(next, ordered)
      } else {
        options.selectSingle(next)
      }
      options.focusedPath.value = next
      options.emitSelection(options.selectionPaths.value)
      return
    }

    if (key === 'ArrowUp') {
      event.preventDefault()
      const prev = ordered[Math.max(currentIndex - 1, 0)]
      if (!prev) return
      if (event.shiftKey) {
        options.selectRange(prev, ordered)
      } else {
        options.selectSingle(prev)
      }
      options.focusedPath.value = prev
      options.emitSelection(options.selectionPaths.value)
      return
    }

    const focusedNode = options.nodeByPath.value[focused]
    if (!focusedNode) return

    if (key === 'ArrowRight') {
      event.preventDefault()
      if (focusedNode.is_dir) {
        if (!options.expandedPaths.value.has(focusedNode.path)) {
          await options.toggleExpand(focusedNode.path)
        } else {
          const children = options.childrenByDir.value[focusedNode.path] ?? []
          const firstChild = children[0]
          if (firstChild) {
            options.selectSingle(firstChild.path)
            options.focusedPath.value = firstChild.path
            options.emitSelection(options.selectionPaths.value)
          }
        }
      }
      return
    }

    if (key === 'ArrowLeft') {
      event.preventDefault()
      if (focusedNode.is_dir && options.expandedPaths.value.has(focusedNode.path)) {
        await options.toggleExpand(focusedNode.path)
        return
      }

      const parent = options.parentByPath.value[focusedNode.path]
      if (parent && parent !== options.folderPath.value) {
        options.selectSingle(parent)
        options.focusedPath.value = parent
        options.emitSelection(options.selectionPaths.value)
      }
      return
    }

    if (key === 'Enter') {
      event.preventDefault()
      if (focusedNode.is_dir) {
        await options.toggleExpand(focusedNode.path)
      } else {
        await options.openNode(focusedNode.path)
      }
      return
    }

    if (key === 'F2') {
      event.preventDefault()
      if (options.selectionPaths.value.length === 1) {
        options.startRename(options.selectionPaths.value[0])
      }
      return
    }

    // Space toggles selection of the focused row without opening the note.
    if (key === ' ' && !ctrlOrMeta && !event.shiftKey) {
      event.preventDefault()
      options.toggleSelection(focused)
      options.emitSelection(options.selectionPaths.value)
      return
    }

    if (key === 'Delete') {
      event.preventDefault()
      if (options.selectionPaths.value.length) {
        options.requestDelete(options.selectionPaths.value)
      }
      return
    }

    if (ctrlOrMeta && key.toLowerCase() === 'c') {
      event.preventDefault()
      options.setClipboard('copy', options.selectionPaths.value)
      return
    }

    if (ctrlOrMeta && key.toLowerCase() === 'x') {
      event.preventDefault()
      options.setClipboard('cut', options.selectionPaths.value)
      return
    }

    if (ctrlOrMeta && key.toLowerCase() === 'v') {
      event.preventDefault()
      await options.runPaste()
      return
    }

    if (ctrlOrMeta && key.toLowerCase() === 'n') {
      event.preventDefault()
      options.requestCreate(options.folderPath.value, event.shiftKey ? 'folder' : 'file')
      return
    }

    if (ctrlOrMeta && key.toLowerCase() === 'a') {
      event.preventDefault()
      const parent = options.parentByPath.value[focused] || options.folderPath.value
      const siblings = options.childrenByDir.value[parent] ?? []
      options.setSelection(siblings.map((node) => node.path))
      options.emitSelection(options.selectionPaths.value)
    }
  }

  return {
    onTreeKeydown
  }
}
