import { ref } from 'vue'

/**
 * useTableToolbarControls
 *
 * Purpose:
 * - Manage table control visibility with sticky edge timing heuristics.
 *
 * Responsibilities:
 * - Expose reactive trigger/edge visibility flags.
 * - Apply edge show and sticky thresholds based on pointer distance.
 * - Reset state when pointer leaves table region.
 *
 * Invariant:
 * - `hideAll()` clears both visibility flags and sticky timestamps so stale proximity state
 *   does not leak into the next table hover.
 */
export type TableEdgeDistance = {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Creates table edge visibility controls driven by pointer-to-edge distances.
 */
export function useTableToolbarControls(options?: {
  showThreshold?: number
  stickyThreshold?: number
  stickyMs?: number
}) {
  const tableToolbarTriggerVisible = ref(false)
  const tableAddTopVisible = ref(false)
  const tableAddBottomVisible = ref(false)
  const tableAddLeftVisible = ref(false)
  const tableAddRightVisible = ref(false)

  const showThreshold = options?.showThreshold ?? 20
  const stickyThreshold = options?.stickyThreshold ?? 44
  const stickyMs = options?.stickyMs ?? 280

  let topSeenAt = 0
  let bottomSeenAt = 0
  let leftSeenAt = 0
  let rightSeenAt = 0

  function shouldShow(now: number, distance: number, seenAt: number) {
    if (distance <= showThreshold) return { visible: true, seenAt: now }
    const sticky = distance <= stickyThreshold && seenAt > 0 && now - seenAt <= stickyMs
    return { visible: sticky, seenAt: sticky ? seenAt : 0 }
  }

  function updateFromDistances(distances: TableEdgeDistance) {
    const now = Date.now()
    tableToolbarTriggerVisible.value = true

    const top = shouldShow(now, distances.top, topSeenAt)
    const bottom = shouldShow(now, distances.bottom, bottomSeenAt)
    const left = shouldShow(now, distances.left, leftSeenAt)
    const right = shouldShow(now, distances.right, rightSeenAt)

    topSeenAt = top.seenAt
    bottomSeenAt = bottom.seenAt
    leftSeenAt = left.seenAt
    rightSeenAt = right.seenAt

    tableAddTopVisible.value = top.visible
    tableAddBottomVisible.value = bottom.visible
    tableAddLeftVisible.value = left.visible
    tableAddRightVisible.value = right.visible
  }

  function hideAll() {
    tableToolbarTriggerVisible.value = false
    tableAddTopVisible.value = false
    tableAddBottomVisible.value = false
    tableAddLeftVisible.value = false
    tableAddRightVisible.value = false
    topSeenAt = 0
    bottomSeenAt = 0
    leftSeenAt = 0
    rightSeenAt = 0
  }

  return {
    tableToolbarTriggerVisible,
    tableAddTopVisible,
    tableAddBottomVisible,
    tableAddLeftVisible,
    tableAddRightVisible,
    updateFromDistances,
    hideAll
  }
}
