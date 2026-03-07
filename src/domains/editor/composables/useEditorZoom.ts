import { computed, ref } from 'vue'

/**
 * Configuration for {@link useEditorZoom}.
 */
export type UseEditorZoomOptions = {
  storageKey?: string
  minZoom?: number
  maxZoom?: number
  defaultZoom?: number
}

/**
 * useEditorZoom
 *
 * Purpose:
 * - Own zoom state and local persistence for editor rendering scale.
 *
 * Responsibilities:
 * - Clamp zoom within configured bounds.
 * - Persist accepted zoom values to localStorage.
 * - Expose convenience helpers for incremental and reset actions.
 *
 * Invariants:
 * - Zoom is always rounded to 2 decimals.
 * - Zoom stays inside `[minZoom, maxZoom]`.
 */
export function useEditorZoom(options: UseEditorZoomOptions = {}) {
  const storageKey = options.storageKey ?? 'tomosona:editor:zoom'
  const minZoom = options.minZoom ?? 0.8
  const maxZoom = options.maxZoom ?? 1.6
  const defaultZoom = options.defaultZoom ?? 1

  const editorZoom = ref(defaultZoom)
  const editorZoomStyle = computed(() => ({ '--editor-zoom': String(editorZoom.value) }))

  function clampZoom(value: number): number {
    return Math.max(minZoom, Math.min(maxZoom, Number(value.toFixed(2))))
  }

  function persistZoom(value: number) {
    editorZoom.value = clampZoom(value)
    window.localStorage.setItem(storageKey, String(editorZoom.value))
  }

  /** Initializes zoom from localStorage when value is finite, otherwise keeps default. */
  function initFromStorage() {
    const saved = Number.parseFloat(window.localStorage.getItem(storageKey) ?? String(defaultZoom))
    if (!Number.isFinite(saved)) return
    editorZoom.value = clampZoom(saved)
  }

  function zoomBy(delta: number): number {
    persistZoom(editorZoom.value + delta)
    return editorZoom.value
  }

  function resetZoom(): number {
    persistZoom(defaultZoom)
    return editorZoom.value
  }

  function getZoom(): number {
    return editorZoom.value
  }

  return {
    editorZoom,
    editorZoomStyle,
    initFromStorage,
    zoomBy,
    resetZoom,
    getZoom
  }
}
