import { describe, expect, it, vi } from 'vitest'
import { useEditorSessionLifecycle } from './useEditorSessionLifecycle'

describe('useEditorSessionLifecycle', () => {
  it('drops stale request ids', () => {
    const lifecycle = useEditorSessionLifecycle({
      emitStatus: () => {},
      saveCurrentFile: async () => {},
      isEditingVirtualTitle: () => false
    })

    const id1 = lifecycle.nextRequestId()
    const id2 = lifecycle.nextRequestId()
    expect(lifecycle.isCurrentRequest(id1)).toBe(false)
    expect(lifecycle.isCurrentRequest(id2)).toBe(true)
  })

  it('patches status and moves path state', () => {
    const emitStatus = vi.fn()
    const lifecycle = useEditorSessionLifecycle({
      emitStatus,
      saveCurrentFile: async () => {},
      isEditingVirtualTitle: () => false
    })

    lifecycle.patchStatus('a.md', { dirty: true, saving: true, saveError: 'x' })
    lifecycle.movePathState('a.md', 'b.md')

    expect(lifecycle.statusByPath.value['a.md']).toBeUndefined()
    expect(lifecycle.statusByPath.value['b.md']).toEqual({ dirty: true, saving: true, saveError: 'x' })
    expect(emitStatus).toHaveBeenCalled()
  })

  it('defers autosave while virtual title is active', async () => {
    vi.useFakeTimers()
    const saveCurrentFile = vi.fn(async () => {})
    let editing = true
    const lifecycle = useEditorSessionLifecycle({
      emitStatus: () => {},
      saveCurrentFile,
      isEditingVirtualTitle: () => editing,
      autosaveIdleMs: 10,
      autosaveTitleIdleMs: 10,
      autosaveTitleRetryMs: 15
    })

    lifecycle.scheduleAutosave()
    await vi.advanceTimersByTimeAsync(12)
    expect(saveCurrentFile).toHaveBeenCalledTimes(0)

    editing = false
    await vi.advanceTimersByTimeAsync(20)
    expect(saveCurrentFile).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
