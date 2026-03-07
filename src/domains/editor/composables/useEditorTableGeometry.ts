import type { Ref } from 'vue'

/**
 * Table toolbar position refs updated from geometry calculations.
 *
 * Side effects:
 * - `updateTableToolbarPosition` mutates all refs in this state object in one pass to keep
 *   trigger, bounds, and floating toolbar coordinates consistent.
 */
export type TableGeometryPositionState = {
  tableMenuBtnLeft: Ref<number>
  tableMenuBtnTop: Ref<number>
  tableBoxLeft: Ref<number>
  tableBoxTop: Ref<number>
  tableBoxWidth: Ref<number>
  tableBoxHeight: Ref<number>
  tableToolbarLeft: Ref<number>
  tableToolbarTop: Ref<number>
  tableToolbarViewportLeft: Ref<number>
  tableToolbarViewportTop: Ref<number>
  tableToolbarViewportMaxHeight: Ref<number>
}

/**
 * Dependencies required by {@link useEditorTableGeometry}.
 *
 * Boundary:
 * - Geometry computation depends only on holder scroll/rect and target element rects.
 */
export type UseEditorTableGeometryOptions = {
  holder: Ref<HTMLElement | null>
  state: TableGeometryPositionState
}

/**
 * useEditorTableGeometry
 *
 * Purpose:
 * - Own table toolbar geometry/viewport clamping computations.
 *
 * Responsibilities:
 * - Convert cell/table viewport rectangles into holder-relative coordinates.
 * - Place trigger and table bounds overlays.
 * - Clamp floating toolbar position and max-height inside viewport.
 *
 * Failure behavior:
 * - Gracefully no-ops when holder is unavailable.
 */
export function useEditorTableGeometry(options: UseEditorTableGeometryOptions) {
  /**
   * Updates trigger, bounds, and floating table-toolbar coordinates.
   *
   * Why/invariant:
   * - Coordinates are computed in holder space first, then clamped in viewport space to avoid
   *   menu overflow when table selection is near viewport edges.
   */
  function updateTableToolbarPosition(cellEl: HTMLElement, tableEl: HTMLElement) {
    if (!options.holder.value) return
    const holderRect = options.holder.value.getBoundingClientRect()
    const cellRect = cellEl.getBoundingClientRect()
    const tableRect = tableEl.getBoundingClientRect()
    const holderScrollLeft = options.holder.value.scrollLeft
    const holderScrollTop = options.holder.value.scrollTop
    const cellTop = cellRect.top - holderRect.top + holderScrollTop
    const cellRight = cellRect.right - holderRect.left + holderScrollLeft
    const tableTop = tableRect.top - holderRect.top + holderScrollTop
    const tableLeft = tableRect.left - holderRect.left + holderScrollLeft
    const tableWidth = tableRect.width
    const tableHeight = tableRect.height

    options.state.tableMenuBtnLeft.value = Math.max(6, cellRight - 28)
    options.state.tableMenuBtnTop.value = Math.max(6, cellTop + 6)
    options.state.tableBoxLeft.value = Math.max(6, tableLeft)
    options.state.tableBoxTop.value = Math.max(6, tableTop)
    options.state.tableBoxWidth.value = Math.max(0, tableWidth)
    options.state.tableBoxHeight.value = Math.max(0, tableHeight)

    options.state.tableToolbarLeft.value = options.state.tableMenuBtnLeft.value + 24
    options.state.tableToolbarTop.value = Math.max(6, options.state.tableMenuBtnTop.value - 4)

    const menuWidth = 320
    const viewportPadding = 8
    const minMenuHeight = 160
    const preferredMenuHeight = Math.max(220, Math.floor(window.innerHeight * 0.72))
    // `tableToolbarLeft/Top` are holder-content coordinates (already including holder scroll),
    // so convert back to visible viewport space before positioning the fixed overlay.
    const rawViewportLeft = holderRect.left + options.state.tableToolbarLeft.value - holderScrollLeft
    const rawViewportTop = holderRect.top + options.state.tableToolbarTop.value - holderScrollTop
    const availableBelow = Math.max(0, Math.floor(window.innerHeight - rawViewportTop - viewportPadding))
    const availableAbove = Math.max(0, Math.floor(rawViewportTop - viewportPadding))

    let clampedTop = rawViewportTop
    let maxHeight = Math.max(minMenuHeight, Math.min(preferredMenuHeight, availableBelow))
    if (availableBelow < 220 && availableAbove > availableBelow) {
      maxHeight = Math.max(minMenuHeight, Math.min(preferredMenuHeight, availableAbove))
      clampedTop = rawViewportTop - maxHeight
    }

    clampedTop = Math.max(viewportPadding, clampedTop)
    const overflowBottom = clampedTop + maxHeight - (window.innerHeight - viewportPadding)
    if (overflowBottom > 0) {
      clampedTop = Math.max(viewportPadding, clampedTop - overflowBottom)
    }

    const clampedLeft = Math.max(viewportPadding, Math.min(rawViewportLeft, window.innerWidth - menuWidth - viewportPadding))
    options.state.tableToolbarViewportLeft.value = clampedLeft
    options.state.tableToolbarViewportTop.value = clampedTop
    options.state.tableToolbarViewportMaxHeight.value = maxHeight
  }

  return {
    updateTableToolbarPosition
  }
}
