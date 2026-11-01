import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInlinePageUnlock } from './useInlinePageUnlock'

const api = vi.hoisted(() => ({ pageProtectionStatus: vi.fn(), unlockPage: vi.fn(), isPageLockedError: (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PageLocked') }))
vi.mock('../../shared/api/pageProtectionApi', () => api)

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await nextTick() }

describe('inline page unlock', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps a locked read pending until the correct password, and keeps failures visible', async () => {
    let locked = true
    api.pageProtectionStatus.mockImplementation(async ([path]: string[]) => [{ path, isProtected: true, isLocked: locked }])
    api.unlockPage.mockImplementation(async (_path: string, password: string) => {
      if (password !== 'secret') throw 'Incorrect password or damaged file.'
      locked = false
    })
    const scope = effectScope()
    const path = ref('/vault/secret.md')
    const controller = scope.run(() => useInlinePageUnlock(path))!
    await flush()
    const read = vi.fn(async () => {
      if (locked) throw { code: 'PageLocked', path: path.value }
      return 'private content'
    })
    const result = controller.read(read)
    await flush()
    expect(controller.state.value).toBe('locked')
    expect(controller.waitingReads.value[path.value]).toBe(1)
    await controller.submit('wrong')
    expect(controller.error.value).toContain('Incorrect password')
    expect(read).toHaveBeenCalledTimes(1)
    await controller.submit('secret')
    expect(await result).toBe('private content')
    expect(controller.state.value).toBe('unlocked')
    expect(controller.waitingReads.value[path.value]).toBeUndefined()
    scope.stop()
  })

  it('sets the busy state before invoking the native command', async () => {
    api.pageProtectionStatus.mockImplementation(async ([path]: string[]) => [{ path, isProtected: true, isLocked: true }])
    let finish!: () => void
    api.unlockPage.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const scope = effectScope()
    const controller = scope.run(() => useInlinePageUnlock(ref('/vault/a.md')))!
    await flush()
    const submission = controller.submit('secret')
    expect(controller.pending.value).toBe(true)
    expect(api.unlockPage).not.toHaveBeenCalled()
    await nextTick()
    expect(api.unlockPage).toHaveBeenCalledOnce()
    finish()
    await submission
    scope.stop()
  })

  it('does not let a stale protection check replace the current tab state', async () => {
    let finishFirst!: (value: unknown) => void
    api.pageProtectionStatus.mockImplementation(([path]: string[]) => path.endsWith('a.md')
      ? new Promise((resolve) => { finishFirst = resolve })
      : Promise.resolve([{ path, isProtected: true, isLocked: true }]))
    const scope = effectScope()
    const path = ref('/vault/a.md')
    const controller = scope.run(() => useInlinePageUnlock(path))!
    path.value = '/vault/b.md'
    await flush()
    finishFirst([{ path: '/vault/a.md', isProtected: false, isLocked: false }])
    await flush()
    expect(controller.state.value).toBe('locked')
    scope.stop()
  })

  it('fails closed when protection status cannot be checked', async () => {
    api.pageProtectionStatus.mockRejectedValue(new Error('unavailable'))
    const scope = effectScope()
    const controller = scope.run(() => useInlinePageUnlock(ref('/vault/a.md')))!
    await flush()
    expect(controller.state.value).toBe('error')
    expect(controller.error.value).toContain('Could not check')
    scope.stop()
  })

  it('allows a second pane to resume when another pane unlocks the same note', async () => {
    let locked = true
    api.pageProtectionStatus.mockImplementation(async ([path]: string[]) => [{ path, isProtected: true, isLocked: locked }])
    api.unlockPage.mockImplementation(async () => { locked = false })
    const scope = effectScope()
    const [first, second] = scope.run(() => [useInlinePageUnlock(ref('/vault/a.md')), useInlinePageUnlock(ref('/vault/a.md'))])!
    await flush()
    const result = second.read(async () => {
      if (locked) throw { code: 'PageLocked', path: '/vault/a.md' }
      return 'content'
    })
    await flush()
    await first.submit('secret')
    expect(await result).toBe('content')
    scope.stop()
  })
})
