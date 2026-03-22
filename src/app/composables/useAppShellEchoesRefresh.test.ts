import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppShellEchoesRefresh } from './useAppShellEchoesRefresh'

describe('useAppShellEchoesRefresh', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refreshes Echoes after indexing returns to indexed', async () => {
    const scope = effectScope()
    const indexingState = ref<'indexed' | 'indexing' | 'out_of_sync'>('indexing')
    const refreshEchoes = vi.fn()

    scope.run(() => useAppShellEchoesRefresh({
      indexingState,
      refreshEchoes
    }))

    indexingState.value = 'out_of_sync'
    await Promise.resolve()
    expect(refreshEchoes).not.toHaveBeenCalled()

    indexingState.value = 'indexed'
    await Promise.resolve()
    expect(refreshEchoes).toHaveBeenCalledTimes(1)

    indexingState.value = 'indexed'
    await Promise.resolve()
    expect(refreshEchoes).toHaveBeenCalledTimes(1)

    scope.stop()
  })
})
