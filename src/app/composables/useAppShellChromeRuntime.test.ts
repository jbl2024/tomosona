import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorPaneGridExposed } from '../components/panes/EditorPaneGrid.vue'
import { useAppShellChromeRuntime } from './useAppShellChromeRuntime'

describe('useAppShellChromeRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles resize, overflow, and zoom chrome controls', () => {
    const editorRef = ref<EditorPaneGridExposed | null>(null)
    editorRef.value = {
      zoomIn: vi.fn(() => 1.4),
      zoomOut: vi.fn(() => 0.9),
      resetZoom: vi.fn(() => 1.1)
    } as unknown as EditorPaneGridExposed
    const editorZoom = ref(1)
    const overflowMenuOpen = ref(false)
    const closeHistoryMenu = vi.fn()
    const closeOverflowMenu = vi.fn(() => {
      overflowMenuOpen.value = false
    })
    const openDesignSystemDebugModal = vi.fn()
    const syncEditorZoom = vi.fn()

    const scope = effectScope()
    const api = scope.run(() => useAppShellChromeRuntime({
      editorRef,
      editorZoom,
      overflowMenuOpen,
      closeHistoryMenu,
      closeOverflowMenu,
      openDesignSystemDebugModal,
      showDebugTools: true,
      syncEditorZoom
    }))
    if (!api) throw new Error('Expected chrome runtime api')

    api.beginResize('left', new MouseEvent('mousedown', { clientX: 120, bubbles: true }))
    expect(api.resizeState.value).toMatchObject({ side: 'left', startX: 120, startWidth: 290 })
    api.onPointerMove(new MouseEvent('mousemove', { clientX: 160, bubbles: true }))
    expect(api.leftPaneWidth.value).toBe(330)
    api.stopResize()
    expect(api.resizeState.value).toBeNull()

    api.toggleOverflowMenu()
    expect(closeHistoryMenu).toHaveBeenCalledTimes(1)
    expect(syncEditorZoom).toHaveBeenCalledTimes(1)
    expect(overflowMenuOpen.value).toBe(true)

    api.zoomInFromOverflow()
    expect(editorRef.value.zoomIn).toHaveBeenCalled()
    expect(editorZoom.value).toBe(1.4)

    api.zoomOutFromOverflow()
    expect(editorRef.value.zoomOut).toHaveBeenCalled()
    expect(editorZoom.value).toBe(0.9)

    api.resetZoomFromOverflow()
    expect(editorRef.value.resetZoom).toHaveBeenCalled()
    expect(syncEditorZoom).toHaveBeenCalledTimes(2)

    api.openDesignSystemDebugFromOverflow()
    expect(closeOverflowMenu).toHaveBeenCalled()
    expect(openDesignSystemDebugModal).toHaveBeenCalled()

    expect(api.zoomInFromPalette()).toBe(false)
    expect(api.zoomOutFromPalette()).toBe(false)
    expect(api.resetZoomFromPalette()).toBe(false)

    scope.stop()
  })
})
