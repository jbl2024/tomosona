import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEchoesPack } from './useEchoesPack'

const api = vi.hoisted(() => ({
  computeEchoesPack: vi.fn()
}))

vi.mock('../lib/api', () => api)

function deferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useEchoesPack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads pack for a valid anchor', async () => {
    api.computeEchoesPack.mockResolvedValue({
      anchorPath: '/vault/a.md',
      generatedAtMs: 1,
      items: [{ path: '/vault/b.md', title: 'B', reasonLabel: 'Direct link', reasonLabels: ['Direct link'], score: 1, signalSources: ['direct'] }]
    })

    const scope = effectScope()
    const anchor = ref('/vault/a.md')
    const state = scope.run(() => useEchoesPack(anchor, { limit: 5 }))
    await Promise.resolve()
    await Promise.resolve()

    expect(api.computeEchoesPack).toHaveBeenCalledWith('/vault/a.md', { limit: 5 })
    expect(state?.items.value).toHaveLength(1)
    expect(state?.empty.value).toBe(false)
    scope.stop()
  })

  it('clears state when anchor becomes empty', async () => {
    api.computeEchoesPack.mockResolvedValue({
      anchorPath: '/vault/a.md',
      generatedAtMs: 1,
      items: [{ path: '/vault/b.md', title: 'B', reasonLabel: 'Direct link', reasonLabels: ['Direct link'], score: 1, signalSources: ['direct'] }]
    })

    const scope = effectScope()
    const anchor = ref('/vault/a.md')
    const state = scope.run(() => useEchoesPack(anchor))
    await Promise.resolve()
    anchor.value = ''
    await Promise.resolve()

    expect(state?.items.value).toEqual([])
    expect(state?.loading.value).toBe(false)
    expect(state?.error.value).toBe('')
    scope.stop()
  })

  it('ignores stale response after fast anchor switch', async () => {
    const first = deferredPromise<{ anchorPath: string; generatedAtMs: number; items: any[] }>()
    const second = deferredPromise<{ anchorPath: string; generatedAtMs: number; items: any[] }>()
    api.computeEchoesPack
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const scope = effectScope()
    const anchor = ref('/vault/a.md')
    const state = scope.run(() => useEchoesPack(anchor))
    await Promise.resolve()
    anchor.value = '/vault/c.md'
    await Promise.resolve()

    first.resolve({
      anchorPath: '/vault/a.md',
      generatedAtMs: 1,
      items: [{ path: '/vault/old.md', title: 'Old', reasonLabel: 'Direct link', reasonLabels: ['Direct link'], score: 1, signalSources: ['direct'] }]
    })
    second.resolve({
      anchorPath: '/vault/c.md',
      generatedAtMs: 2,
      items: [{ path: '/vault/new.md', title: 'New', reasonLabel: 'Backlink', reasonLabels: ['Backlink'], score: 0.9, signalSources: ['backlink'] }]
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(state?.items.value.map((item) => item.path)).toEqual(['/vault/new.md'])
    scope.stop()
  })

  it('exposes error and recovers after a later success', async () => {
    api.computeEchoesPack
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        anchorPath: '/vault/a.md',
        generatedAtMs: 3,
        items: []
      })

    const scope = effectScope()
    const anchor = ref('/vault/a.md')
    const state = scope.run(() => useEchoesPack(anchor))
    await Promise.resolve()
    await Promise.resolve()
    expect(state?.error.value).toBe('boom')

    await state?.refresh()
    expect(state?.error.value).toBe('')
    expect(state?.empty.value).toBe(true)
    scope.stop()
  })
})
