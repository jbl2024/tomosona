import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEditorLayoutMetrics } from './useEditorLayoutMetrics'

describe('useEditorLayoutMetrics', () => {
  it('counts lines with CRLF and CR normalization', () => {
    const metrics = useEditorLayoutMetrics({
      holder: ref(null),
      contentShell: ref(null)
    })

    expect(metrics.countLines('a\r\nb\rc')).toBe(3)
    expect(metrics.countLines('')).toBe(0)
  })

  it('updates gutter hitbox width from holder/content geometry', () => {
    const holder = document.createElement('div')
    const contentShell = document.createElement('div')
    contentShell.style.paddingLeft = '12px'

    vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 10,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(contentShell, 'getBoundingClientRect').mockReturnValue({
      left: 40,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 40,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)

    const metrics = useEditorLayoutMetrics({
      holder: ref(holder),
      contentShell: ref(contentShell),
      minGutterWidth: 48,
      gutterPaddingPx: 8
    })

    metrics.updateGutterHitboxStyle()
    expect(metrics.gutterHitboxStyle.value.width).toBe('50px')
  })

  it('syncs on scroll through callback after gutter refresh', () => {
    const holder = document.createElement('div')
    const contentShell = document.createElement('div')
    contentShell.style.paddingLeft = '4px'
    vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(contentShell, 'getBoundingClientRect').mockReturnValue({
      left: 40,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 40,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    const onScrollSync = vi.fn()
    const metrics = useEditorLayoutMetrics({
      holder: ref(holder),
      contentShell: ref(contentShell),
      onScrollSync
    })

    metrics.onHolderScroll()

    expect(metrics.gutterHitboxStyle.value.width).toBe('52px')
    expect(onScrollSync).toHaveBeenCalledTimes(1)
  })
})
