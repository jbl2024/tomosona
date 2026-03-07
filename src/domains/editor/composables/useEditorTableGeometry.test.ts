import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEditorTableGeometry } from './useEditorTableGeometry'

function rect(partial: Partial<DOMRect>): DOMRect {
  return {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...partial
  } as DOMRect
}

describe('useEditorTableGeometry', () => {
  it('keeps fixed toolbar anchored to trigger when holder is scrolled', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    const holder = document.createElement('div')
    Object.defineProperty(holder, 'scrollLeft', { configurable: true, value: 0 })
    Object.defineProperty(holder, 'scrollTop', { configurable: true, value: 300 })
    vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue(rect({ left: 100, top: 80 }))

    const cell = document.createElement('td')
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rect({
      top: 240,
      right: 540,
      width: 200,
      height: 36
    }))

    const table = document.createElement('table')
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect({
      left: 320,
      top: 220,
      width: 520,
      height: 180
    }))

    const state = {
      tableMenuBtnLeft: ref(0),
      tableMenuBtnTop: ref(0),
      tableBoxLeft: ref(0),
      tableBoxTop: ref(0),
      tableBoxWidth: ref(0),
      tableBoxHeight: ref(0),
      tableToolbarLeft: ref(0),
      tableToolbarTop: ref(0),
      tableToolbarViewportLeft: ref(0),
      tableToolbarViewportTop: ref(0),
      tableToolbarViewportMaxHeight: ref(0)
    }

    const geometry = useEditorTableGeometry({
      holder: ref(holder),
      state
    })

    geometry.updateTableToolbarPosition(cell, table)

    // Top-level check: fixed overlay should match visible content position, not scrolled content coordinates.
    expect(state.tableToolbarViewportTop.value).toBe(242)
    expect(state.tableToolbarViewportLeft.value).toBe(536)
  })
})
