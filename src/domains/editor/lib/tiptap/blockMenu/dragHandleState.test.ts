import { describe, expect, it } from 'vitest'
import { computeHandleLock, resolveActiveTarget, type DragHandleUiState } from './dragHandleState'

function state(overrides: Partial<DragHandleUiState>): DragHandleUiState {
  return {
    menuOpen: false,
    gutterHover: false,
    controlsHover: false,
    dragging: false,
    activeTarget: null,
    ...overrides,
  }
}

describe('computeHandleLock', () => {
  it('returns false when all flags are false', () => {
    expect(computeHandleLock(state({}))).toBe(false)
  })

  it('returns true when any flag is true', () => {
    expect(computeHandleLock(state({ menuOpen: true }))).toBe(true)
    expect(computeHandleLock(state({ gutterHover: true }))).toBe(true)
    expect(computeHandleLock(state({ controlsHover: true }))).toBe(true)
    expect(computeHandleLock(state({ dragging: true }))).toBe(true)
  })
})

describe('resolveActiveTarget', () => {
  it('prefers current active target and falls back to last stable', () => {
    const stable = { pos: 5, nodeType: 'paragraph', nodeSize: 3, canDelete: true, canConvert: true, text: 'x', isVirtualTitle: false }
    const active = { pos: 7, nodeType: 'heading', nodeSize: 4, canDelete: true, canConvert: true, text: 'y', isVirtualTitle: false }

    expect(resolveActiveTarget(active, stable)).toEqual(active)
    expect(resolveActiveTarget(null, stable)).toEqual(stable)
    expect(resolveActiveTarget(null, null)).toBeNull()
  })
})
