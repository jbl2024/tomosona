import { describe, expect, it, vi } from 'vitest'
import { useTableToolbarControls } from './useTableToolbarControls'

describe('useTableToolbarControls', () => {
  it('shows near edges and hides on reset', () => {
    const controls = useTableToolbarControls({
      showThreshold: 10,
      stickyThreshold: 30,
      stickyMs: 100
    })

    controls.updateFromDistances({ top: 5, bottom: 25, left: 5, right: 25 })

    expect(controls.tableToolbarTriggerVisible.value).toBe(true)
    expect(controls.tableAddTopVisible.value).toBe(true)
    expect(controls.tableAddLeftVisible.value).toBe(true)

    controls.hideAll()
    expect(controls.tableToolbarTriggerVisible.value).toBe(false)
    expect(controls.tableAddTopVisible.value).toBe(false)
  })

  it('keeps sticky visibility briefly then expires', async () => {
    vi.useFakeTimers()
    const controls = useTableToolbarControls({ showThreshold: 10, stickyThreshold: 20, stickyMs: 50 })

    controls.updateFromDistances({ top: 4, bottom: 40, left: 40, right: 40 })
    expect(controls.tableAddTopVisible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(30)
    controls.updateFromDistances({ top: 18, bottom: 40, left: 40, right: 40 })
    expect(controls.tableAddTopVisible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(60)
    controls.updateFromDistances({ top: 18, bottom: 40, left: 40, right: 40 })
    expect(controls.tableAddTopVisible.value).toBe(false)
    vi.useRealTimers()
  })
})
