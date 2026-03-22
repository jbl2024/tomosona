import { ref, type Ref } from 'vue'
import type { EditorPaneGridExposed } from '../components/panes/EditorPaneGrid.vue'
import { clampEditorZoom } from '../lib/appShellPersistence'

/**
 * Module: useAppShellChromeRuntime
 *
 * Purpose:
 * - Own shell chrome handlers that are only about local UI coordination.
 * - Keep resize/overflow/zoom glue out of App.vue without splitting behavior
 *   across multiple tiny composables.
 */

/** Shell-facing runtime hooks used by chrome controls. */
export type UseAppShellChromeRuntimeOptions = {
  editorRef: Readonly<Ref<EditorPaneGridExposed | null>>
  editorZoom: Ref<number>
  overflowMenuOpen: Ref<boolean>
  closeHistoryMenu: () => void
  closeOverflowMenu: () => void
  openDesignSystemDebugModal: () => void
  showDebugTools: boolean
  syncEditorZoom: (getZoom?: () => number) => void
}

/**
 * Owns resize state and a small set of overflow/zoom wrappers for the shell
 * chrome. The composable only coordinates UI state and delegates actual zoom
 * persistence to the existing shell persistence helper.
 */
export function useAppShellChromeRuntime(options: UseAppShellChromeRuntimeOptions) {
  const resizeState = ref<{
    side: 'left' | 'right'
    startX: number
    startWidth: number
  } | null>(null)
  const leftPaneWidth = ref(290)
  const rightPaneWidth = ref(300)

  function beginResize(side: 'left' | 'right', event: MouseEvent) {
    event.preventDefault()
    resizeState.value = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? leftPaneWidth.value : rightPaneWidth.value
    }
  }

  function onPointerMove(event: MouseEvent) {
    if (!resizeState.value) return
    const { side, startWidth, startX } = resizeState.value
    const delta = event.clientX - startX

    if (side === 'left') {
      leftPaneWidth.value = Math.min(420, Math.max(180, startWidth + delta))
      return
    }
    rightPaneWidth.value = Math.min(560, Math.max(220, startWidth - delta))
  }

  function stopResize() {
    resizeState.value = null
  }

  function toggleOverflowMenu() {
    options.closeHistoryMenu()
    if (!options.overflowMenuOpen.value) {
      options.syncEditorZoom()
    }
    options.overflowMenuOpen.value = !options.overflowMenuOpen.value
  }

  function openDesignSystemDebugFromOverflow() {
    if (!options.showDebugTools) return
    options.closeOverflowMenu()
    options.openDesignSystemDebugModal()
  }

  function zoomInFromOverflow() {
    const next = options.editorRef.value?.zoomIn()
    if (typeof next === 'number' && Number.isFinite(next)) {
      options.editorZoom.value = clampEditorZoom(next)
      return
    }
    options.syncEditorZoom()
  }

  function zoomOutFromOverflow() {
    const next = options.editorRef.value?.zoomOut()
    if (typeof next === 'number' && Number.isFinite(next)) {
      options.editorZoom.value = clampEditorZoom(next)
      return
    }
    options.syncEditorZoom()
  }

  function resetZoomFromOverflow() {
    const next = options.editorRef.value?.resetZoom()
    options.syncEditorZoom(() => (typeof next === 'number' && Number.isFinite(next) ? next : 1))
  }

  function zoomInFromPalette() {
    zoomInFromOverflow()
    return false
  }

  function zoomOutFromPalette() {
    zoomOutFromOverflow()
    return false
  }

  function resetZoomFromPalette() {
    resetZoomFromOverflow()
    return false
  }

  return {
    resizeState,
    leftPaneWidth,
    rightPaneWidth,
    beginResize,
    onPointerMove,
    stopResize,
    toggleOverflowMenu,
    openDesignSystemDebugFromOverflow,
    zoomInFromOverflow,
    zoomOutFromOverflow,
    resetZoomFromOverflow,
    zoomInFromPalette,
    zoomOutFromPalette,
    resetZoomFromPalette
  }
}
