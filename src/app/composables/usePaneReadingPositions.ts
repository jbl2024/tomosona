/**
 * Module: usePaneReadingPositions
 *
 * Purpose:
 * - Remember where the reader was in each document, per pane, so history
 *   navigation restores the reading position and not only the document.
 *
 * Boundaries:
 * - Pure in-memory map. No DOM, no persistence: a reading position is session
 *   state, and the editor surface owns the actual scrolling.
 * - Keyed by pane and path, so the same document open in two panes keeps two
 *   independent positions.
 */
import { ref } from 'vue'

export function usePaneReadingPositions() {
  const positions = ref<Record<string, number>>({})

  function keyFor(paneId: string, path: string): string {
    return `${paneId}::${path}`
  }

  /** Stores the scroll offset of `path` in `paneId`; ignores empty keys. */
  function capture(paneId: string, path: string, scrollTop: number) {
    if (!paneId || !path) return
    const next = Math.max(0, Math.round(scrollTop))
    const key = keyFor(paneId, path)
    if (positions.value[key] === next) return
    positions.value = { ...positions.value, [key]: next }
  }

  /** Returns the stored offset for `path` in `paneId`, or 0 when unknown. */
  function read(paneId: string, path: string): number {
    if (!paneId || !path) return 0
    return positions.value[keyFor(paneId, path)] ?? 0
  }

  /** Drops the stored offset, for example after the document is closed. */
  function forget(paneId: string, path: string) {
    const key = keyFor(paneId, path)
    if (!(key in positions.value)) return
    const next = { ...positions.value }
    delete next[key]
    positions.value = next
  }

  return { positions, capture, read, forget }
}
