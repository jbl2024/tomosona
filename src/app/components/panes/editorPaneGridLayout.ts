import type { MultiPaneLayout } from '../../composables/useMultiPaneWorkspaceState'

/**
 * Pure layout helpers for the editor pane grid.
 *
 * The component keeps orchestration and DOM wiring; these helpers own the
 * deterministic tree walking and split-position math so they can be tested
 * without mounting the full shell.
 */
export type SplitAxis = 'column' | 'row'

export type SplitDragState = {
  axis: SplitAxis
  startClient: number
  startRatio: number
}

/**
 * Flattens a pane tree into stable render order.
 */
export function collectPaneIds(node: MultiPaneLayout['root']): string[] {
  if (node.kind === 'pane') return [node.paneId]
  return [...collectPaneIds(node.a), ...collectPaneIds(node.b)]
}

/**
 * Returns the CSS grid slot for a pane index.
 */
export function getPaneGridPosition(
  index: number,
  hasColumnSplit: boolean,
  hasRowSplit: boolean
): { gridColumn: string; gridRow: string } {
  if (!hasColumnSplit && !hasRowSplit) {
    return { gridColumn: '1', gridRow: '1' }
  }
  if (hasColumnSplit && !hasRowSplit) {
    return {
      gridColumn: index === 0 ? '1' : '3',
      gridRow: '1'
    }
  }

  const rowTop = index <= 1
  const colLeft = index % 2 === 0
  return {
    gridColumn: colLeft ? '1' : '3',
    gridRow: rowTop ? '1' : '3'
  }
}

/**
 * Captures the initial state for a resizer drag.
 */
export function createSplitDragState(axis: SplitAxis, clientPosition: number, startRatio: number): SplitDragState {
  return {
    axis,
    startClient: clientPosition,
    startRatio
  }
}

/**
 * Computes the next split ratio after pointer movement.
 */
export function computeSplitRatio(
  drag: SplitDragState,
  currentClient: number,
  size: number,
  trackPx: number,
  minRatio: number,
  maxRatio: number
): number {
  const usableSize = Math.max(1, size - trackPx)
  const delta = currentClient - drag.startClient
  const deltaRatio = (delta / usableSize) * 100
  const next = drag.startRatio + deltaRatio
  return Math.min(maxRatio, Math.max(minRatio, next))
}
