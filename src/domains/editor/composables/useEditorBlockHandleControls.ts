import type { Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { BlockMenuActionItem, BlockMenuTarget } from '../lib/tiptap/blockMenu/types'
import { canCopyAnchor, toBlockMenuTarget } from '../lib/tiptap/blockMenu/guards'
import { deleteNode, duplicateNode, insertAbove, insertBelow, moveNodeDown, moveNodeUp, turnInto } from '../lib/tiptap/blockMenu/actions'
import { computeHandleLock, type DragHandleUiState } from '../lib/tiptap/blockMenu/dragHandleState'

/**
 * Module: useEditorBlockHandleControls
 *
 * Encapsulates block-menu/drag-handle interaction state transitions for EditorView.
 */

/**
 * Dependencies required by {@link useEditorBlockHandleControls}.
 */
export type UseEditorBlockHandleControlsOptions = {
  getEditor: () => Editor | null
  blockMenuOpen: Ref<boolean>
  blockMenuIndex: Ref<number>
  blockMenuTarget: Ref<BlockMenuTarget | null>
  blockMenuActionTarget: Ref<BlockMenuTarget | null>
  dragHandleUiState: Ref<DragHandleUiState>
  lastStableBlockMenuTarget: Ref<BlockMenuTarget | null>
  setBlockMenuPos: (payload: { x: number; y: number }) => void
  setDragHandleLockMeta: (locked: boolean) => void
  closeSlashMenu: () => void
  closeWikilinkMenu: () => void
  openSlashAtSelection: (seed: string) => void
  copyTextToClipboard: (text: string) => void
  targetClearDelayMs?: number
  debug?: (event: string, detail?: unknown) => void
}

/**
 * useEditorBlockHandleControls
 *
 * Purpose:
 * - Encapsulate drag-handle + block-menu interaction behavior.
 *
 * Responsibilities:
 * - Resolve target updates from drag-handle node changes.
 * - Control menu open/close/position and slash/wikilink coordination.
 * - Apply block actions and synchronize drag-handle lock meta.
 */
export function useEditorBlockHandleControls(options: UseEditorBlockHandleControlsOptions) {
  let lastAppliedDragHandleLock: boolean | null = null
  let targetClearTimer: ReturnType<typeof setTimeout> | null = null
  const targetClearDelayMs = options.targetClearDelayMs ?? 120

  function debug(event: string, detail?: unknown) {
    options.debug?.(event, detail)
  }

  function clearTargetClearTimer() {
    if (!targetClearTimer) return
    clearTimeout(targetClearTimer)
    targetClearTimer = null
  }

  function shouldKeepTargetDuringTransition(): boolean {
    const state = options.dragHandleUiState.value
    return state.menuOpen || state.controlsHover || state.gutterHover || state.dragging
  }

  function clearActiveTargetNow(reason: string) {
    options.blockMenuTarget.value = null
    options.dragHandleUiState.value = {
      ...options.dragHandleUiState.value,
      activeTarget: null,
      controlsHover: false,
      gutterHover: false,
    }
    syncDragHandleLockFromState(reason)
  }

  /**
   * Synchronizes drag-handle plugin lock with derived ui state.
   */
  function syncDragHandleLockFromState(reason: string) {
    const shouldLock = computeHandleLock(options.dragHandleUiState.value)
    if (lastAppliedDragHandleLock === shouldLock) return
    lastAppliedDragHandleLock = shouldLock
    options.setDragHandleLockMeta(shouldLock)
    debug(`sync-lock:${reason}`, shouldLock)
  }

  /**
   * Closes block menu and optionally unlocks drag handle lock.
   */
  function closeBlockMenu(unlock = true) {
    const wasOpen = options.blockMenuOpen.value || options.blockMenuIndex.value !== 0 || options.dragHandleUiState.value.menuOpen
    if (!wasOpen) return
    options.blockMenuOpen.value = false
    options.blockMenuIndex.value = 0
    options.dragHandleUiState.value = { ...options.dragHandleUiState.value, menuOpen: false }
    if (unlock) {
      syncDragHandleLockFromState('close-menu')
    }
  }

  /**
   * Updates stable block target from drag-handle node payload.
   */
  function onBlockHandleNodeChange(payload: { pos: number; node: { type: { name: string }; attrs?: Record<string, unknown>; textContent?: string; nodeSize: number } | null }) {
    if (!payload.node) {
      clearTargetClearTimer()
      if (shouldKeepTargetDuringTransition()) {
        return
      }
      targetClearTimer = setTimeout(() => {
        targetClearTimer = null
        if (shouldKeepTargetDuringTransition()) {
          return
        }
        clearActiveTargetNow('target-cleared')
      }, targetClearDelayMs)
      return
    }
    clearTargetClearTimer()
    const editor = options.getEditor()
    const nodeAtPos = editor?.state.doc.nodeAt(payload.pos)
    if (!nodeAtPos) return
    const nextTarget = toBlockMenuTarget(nodeAtPos, payload.pos)
    options.blockMenuTarget.value = nextTarget
    options.lastStableBlockMenuTarget.value = nextTarget
    options.dragHandleUiState.value = {
      ...options.dragHandleUiState.value,
      activeTarget: nextTarget,
    }
    debug('target-change', nextTarget.pos)
  }

  function toggleBlockMenu(event: MouseEvent) {
    const handleRoot = (event.currentTarget instanceof HTMLElement)
      ? event.currentTarget.closest('.tomosona-drag-handle')
      : null
    if (handleRoot?.getAttribute('data-dragging') === 'true') {
      options.dragHandleUiState.value = { ...options.dragHandleUiState.value, dragging: true }
      syncDragHandleLockFromState('drag-guard')
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const target = options.blockMenuActionTarget.value
    if (!target) return
    options.blockMenuTarget.value = target

    if (options.blockMenuOpen.value) {
      closeBlockMenu()
      return
    }

    if (event.currentTarget instanceof HTMLElement) {
      const rect = event.currentTarget.getBoundingClientRect()
      const estimatedWidth = 260
      const estimatedHeight = 360
      const maxX = Math.max(12, window.innerWidth - estimatedWidth - 12)
      const maxY = Math.max(12, window.innerHeight - estimatedHeight - 12)
      options.setBlockMenuPos({
        x: Math.max(12, Math.min(rect.right + 8, maxX)),
        y: Math.max(12, Math.min(rect.top, maxY)),
      })
    }

    options.closeSlashMenu()
    options.closeWikilinkMenu()
    options.blockMenuOpen.value = true
    options.dragHandleUiState.value = { ...options.dragHandleUiState.value, menuOpen: true }
    options.blockMenuIndex.value = 0
    syncDragHandleLockFromState('open-menu')
  }

  function onBlockMenuPlus(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const editor = options.getEditor()
    if (!editor) return
    const target = options.blockMenuActionTarget.value
    if (!target) return
    options.blockMenuTarget.value = target
    options.closeSlashMenu()
    options.closeWikilinkMenu()
    insertBelow(editor, target)
    options.openSlashAtSelection('')
  }

  function copyAnchorTarget(target: BlockMenuTarget) {
    if (!target.text.trim()) return
    options.copyTextToClipboard(`[[#${target.text.trim()}]]`)
  }

  function onBlockMenuSelect(item: BlockMenuActionItem) {
    const editor = options.getEditor()
    if (!editor || item.disabled) return
    const target = options.blockMenuActionTarget.value
    if (!target) return
    options.blockMenuTarget.value = target
    if (item.actionId === 'insert_above') insertAbove(editor, target)
    if (item.actionId === 'insert_below') insertBelow(editor, target)
    if (item.actionId === 'move_up') moveNodeUp(editor, target)
    if (item.actionId === 'move_down') moveNodeDown(editor, target)
    if (item.actionId === 'duplicate') duplicateNode(editor, target)
    if (item.actionId === 'delete') deleteNode(editor, target)
    if (item.actionId === 'copy_anchor' && canCopyAnchor(target)) copyAnchorTarget(target)
    if (item.actionId === 'turn_into' && item.turnIntoType) turnInto(editor, target, item.turnIntoType)
    closeBlockMenu()
  }

  function onHandleControlsEnter() {
    if (options.dragHandleUiState.value.controlsHover) return
    options.dragHandleUiState.value = {
      ...options.dragHandleUiState.value,
      controlsHover: true,
      gutterHover: true
    }
    syncDragHandleLockFromState('controls-enter')
  }

  function onHandleControlsLeave() {
    if (!options.dragHandleUiState.value.controlsHover) return
    options.dragHandleUiState.value = {
      ...options.dragHandleUiState.value,
      controlsHover: false,
      gutterHover: false
    }
    syncDragHandleLockFromState('controls-leave')
  }

  function onHandleDragStart() {
    if (options.dragHandleUiState.value.dragging) return
    options.dragHandleUiState.value = { ...options.dragHandleUiState.value, dragging: true }
    syncDragHandleLockFromState('drag-start')
  }

  function onHandleDragEnd() {
    if (!options.dragHandleUiState.value.dragging) return
    options.dragHandleUiState.value = { ...options.dragHandleUiState.value, dragging: false }
    syncDragHandleLockFromState('drag-end')
  }

  function resetLockState() {
    lastAppliedDragHandleLock = null
    clearTargetClearTimer()
  }

  return {
    closeBlockMenu,
    onBlockHandleNodeChange,
    toggleBlockMenu,
    onBlockMenuPlus,
    onBlockMenuSelect,
    syncDragHandleLockFromState,
    onHandleControlsEnter,
    onHandleControlsLeave,
    onHandleDragStart,
    onHandleDragEnd,
    resetLockState
  }
}
