import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginHeavyRender, endHeavyRender, hasPendingHeavyRender, waitForHeavyRenderIdle } from './renderStabilizer'

describe('renderStabilizer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks begin/end token lifecycle', () => {
    const token = beginHeavyRender('mermaid')
    expect(hasPendingHeavyRender()).toBe(true)

    endHeavyRender(token)
    expect(hasPendingHeavyRender()).toBe(false)
  })

  it('resolves true when all pending renders complete within timeout', async () => {
    const t1 = beginHeavyRender('mermaid')
    const t2 = beginHeavyRender('table')

    const waitPromise = waitForHeavyRenderIdle({ timeoutMs: 500, settleMs: 30 })
    await vi.advanceTimersByTimeAsync(100)
    expect(hasPendingHeavyRender()).toBe(true)

    endHeavyRender(t1)
    await vi.advanceTimersByTimeAsync(20)
    expect(hasPendingHeavyRender()).toBe(true)

    endHeavyRender(t2)
    await vi.advanceTimersByTimeAsync(30)

    await expect(waitPromise).resolves.toBe(true)
  })

  it('resolves false when timeout elapses before queue is drained', async () => {
    const token = beginHeavyRender('mermaid')
    const waitPromise = waitForHeavyRenderIdle({ timeoutMs: 80, settleMs: 20 })
    await vi.advanceTimersByTimeAsync(81)
    await expect(waitPromise).resolves.toBe(false)
    endHeavyRender(token)
  })

  it('ignores late or duplicate token cleanup safely', async () => {
    const token = beginHeavyRender('mermaid')
    const waitPromise = waitForHeavyRenderIdle({ timeoutMs: 10, settleMs: 1 })

    await vi.advanceTimersByTimeAsync(11)
    await expect(waitPromise).resolves.toBe(false)
    expect(hasPendingHeavyRender()).toBe(true)

    endHeavyRender(token)
    endHeavyRender(token)
    endHeavyRender('missing-token')
    expect(hasPendingHeavyRender()).toBe(false)
  })
})
