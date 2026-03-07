export type ScrollViewport = {
  top: number
  bottom: number
  scrollTop: number
}

/**
 * Computes the minimal next scroll position required to reveal a row.
 *
 * Rules:
 * - Returns `null` when the row is already fully visible inside the viewport.
 * - Scrolls upward only enough to bring a clipped top edge into view.
 * - Scrolls downward only enough to bring a clipped bottom edge into view.
 *
 * Why:
 * - Explorer selection changes happen frequently as the active document changes.
 * - Centering every active row causes avoidable scroll jumps even when the row
 *   is already visible to the user.
 */
export function computeRevealScrollTop(
  viewport: ScrollViewport,
  row: Pick<DOMRect, 'top' | 'bottom'>
): number | null {
  if (row.top >= viewport.top && row.bottom <= viewport.bottom) {
    return null
  }

  if (row.top < viewport.top) {
    return Math.max(0, viewport.scrollTop - (viewport.top - row.top))
  }

  return Math.max(0, viewport.scrollTop + (row.bottom - viewport.bottom))
}
