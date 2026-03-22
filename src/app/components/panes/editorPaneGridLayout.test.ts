import { describe, expect, it } from 'vitest'
import {
  collectPaneIds,
  computeSplitRatio,
  createSplitDragState,
  getPaneGridPosition
} from './editorPaneGridLayout'

describe('editorPaneGridLayout', () => {
  it('flattens nested pane ids in render order', () => {
    expect(
      collectPaneIds({
        kind: 'split',
        a: { kind: 'pane', paneId: 'left' },
        b: {
          kind: 'split',
          a: { kind: 'pane', paneId: 'top-right' },
          b: { kind: 'pane', paneId: 'bottom-right' }
        }
      })
    ).toEqual(['left', 'top-right', 'bottom-right'])
  })

  it('maps pane positions for single, split-column, and split-grid layouts', () => {
    expect(getPaneGridPosition(0, false, false)).toEqual({ gridColumn: '1', gridRow: '1' })
    expect(getPaneGridPosition(1, true, false)).toEqual({ gridColumn: '3', gridRow: '1' })
    expect(getPaneGridPosition(2, true, true)).toEqual({ gridColumn: '1', gridRow: '3' })
    expect(getPaneGridPosition(3, true, true)).toEqual({ gridColumn: '3', gridRow: '3' })
  })

  it('clamps split ratios when dragging beyond bounds', () => {
    const drag = createSplitDragState('column', 100, 50)
    expect(computeSplitRatio(drag, 300, 600, 6, 20, 80)).toBeGreaterThan(50)
    expect(computeSplitRatio(drag, 10_000, 600, 6, 20, 80)).toBe(80)
    expect(computeSplitRatio(drag, -10_000, 600, 6, 20, 80)).toBe(20)
  })
})
