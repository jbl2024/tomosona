import type { BlockMenuTarget } from './types'

export type DragHandleUiState = {
  menuOpen: boolean
  gutterHover: boolean
  controlsHover: boolean
  dragging: boolean
  selectionLocked: boolean
  activeTarget: BlockMenuTarget | null
}

export function computeHandleLock(state: DragHandleUiState): boolean {
  return state.menuOpen || state.gutterHover || state.controlsHover || state.dragging || state.selectionLocked
}

export function resolveActiveTarget(
  activeTarget: BlockMenuTarget | null,
  lastStableTarget: BlockMenuTarget | null,
): BlockMenuTarget | null {
  return activeTarget ?? lastStableTarget
}
