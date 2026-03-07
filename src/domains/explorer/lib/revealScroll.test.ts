import { describe, expect, it } from 'vitest'
import { computeRevealScrollTop } from './revealScroll'

describe('computeRevealScrollTop', () => {
  it('returns null when the row is already fully visible', () => {
    expect(
      computeRevealScrollTop(
        { top: 100, bottom: 300, scrollTop: 40 },
        { top: 120, bottom: 160 }
      )
    ).toBeNull()
  })

  it('scrolls up only enough to reveal a row clipped above the viewport', () => {
    expect(
      computeRevealScrollTop(
        { top: 100, bottom: 300, scrollTop: 80 },
        { top: 70, bottom: 110 }
      )
    ).toBe(50)
  })

  it('scrolls down only enough to reveal a row clipped below the viewport', () => {
    expect(
      computeRevealScrollTop(
        { top: 100, bottom: 300, scrollTop: 80 },
        { top: 260, bottom: 340 }
      )
    ).toBe(120)
  })
})
