import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorZoom } from './useEditorZoom'

describe('useEditorZoom', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clamps zoom inside configured bounds', () => {
    const zoom = useEditorZoom()

    expect(zoom.zoomBy(10)).toBe(1.6)
    expect(zoom.zoomBy(-10)).toBe(0.8)
  })

  it('persists zoom and restores it from localStorage', () => {
    const first = useEditorZoom()
    first.zoomBy(0.23)

    expect(window.localStorage.getItem('tomosona:editor:zoom')).toBe('1.23')

    const second = useEditorZoom()
    second.initFromStorage()

    expect(second.getZoom()).toBe(1.23)
  })

  it('keeps default zoom when saved value is invalid', () => {
    window.localStorage.setItem('tomosona:editor:zoom', 'not-a-number')

    const zoom = useEditorZoom()
    zoom.initFromStorage()

    expect(zoom.getZoom()).toBe(1)
  })

  it('rounds zoom to 2 decimals during load and updates', () => {
    window.localStorage.setItem('tomosona:editor:zoom', '1.236')

    const zoom = useEditorZoom()
    zoom.initFromStorage()
    expect(zoom.getZoom()).toBe(1.24)

    expect(zoom.zoomBy(0.006)).toBe(1.25)
  })
})
