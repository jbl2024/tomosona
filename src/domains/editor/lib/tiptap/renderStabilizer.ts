/**
 * Heavy render stabilizer for asynchronous editor node views.
 *
 * Purpose:
 * - Provide shared accounting for expensive async render work (for example Mermaid SVG rendering)
 *   so host UI can wait for visual stabilization before dismissing loading overlays.
 *
 * Boundaries:
 * - Tracks only pending token lifecycle and idle waiting.
 * - Does not schedule rendering or know about editor/document state.
 *
 * Invariants:
 * - Each `beginHeavyRender` call should be paired with an `endHeavyRender` call.
 * - `endHeavyRender` is idempotent and never throws for unknown tokens.
 */

const pendingTokens = new Set<string>()
const listeners = new Set<() => void>()
let tokenSeq = 0

function notifyQueueChange() {
  for (const listener of listeners) listener()
}

/**
 * Registers a heavy async render in flight.
 *
 * @param scope Optional diagnostic scope used to prefix generated token ids.
 * @returns Stable token that must be passed to {@link endHeavyRender}.
 */
export function beginHeavyRender(scope = 'heavy-render'): string {
  tokenSeq += 1
  const token = `${scope}:${tokenSeq}`
  pendingTokens.add(token)
  notifyQueueChange()
  return token
}

/**
 * Marks a previously started heavy render as completed.
 *
 * Failure behavior:
 * - Unknown/stale tokens are ignored to keep cleanup safe in cancellation paths.
 *
 * @param token Token returned by {@link beginHeavyRender}.
 */
export function endHeavyRender(token: string): void {
  const removed = pendingTokens.delete(token)
  if (!removed) return
  notifyQueueChange()
}

/**
 * Returns whether any heavy async render is currently pending.
 */
export function hasPendingHeavyRender(): boolean {
  return pendingTokens.size > 0
}

/**
 * Tunables for {@link waitForHeavyRenderIdle}.
 */
export type HeavyRenderIdleWaitOptions = {
  timeoutMs?: number
  settleMs?: number
}

/**
 * Waits until no heavy renders are pending, or until timeout is reached.
 *
 * Side effects:
 * - Installs temporary queue listeners and timers while waiting.
 *
 * Failure behavior:
 * - Resolves `false` on timeout.
 * - Never throws for timeout/cleanup paths.
 *
 * @param options.timeoutMs Maximum wait time before giving up.
 * @param options.settleMs Quiet window required after queue drains to avoid flicker from quick follow-up renders.
 * @returns `true` when queue is idle within timeout, else `false`.
 */
export function waitForHeavyRenderIdle(options: HeavyRenderIdleWaitOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 1_200
  const settleMs = options.settleMs ?? 48

  return new Promise<boolean>((resolve) => {
    let done = false
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      listeners.delete(handleQueueChange)
    }

    const finish = (value: boolean) => {
      if (done) return
      done = true
      cleanup()
      resolve(value)
    }

    const scheduleSettle = () => {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        if (!hasPendingHeavyRender()) finish(true)
      }, settleMs)
    }

    const handleQueueChange = () => {
      if (done) return
      if (hasPendingHeavyRender()) {
        if (settleTimer) {
          clearTimeout(settleTimer)
          settleTimer = null
        }
        return
      }
      scheduleSettle()
    }

    timeoutTimer = setTimeout(() => finish(false), timeoutMs)
    listeners.add(handleQueueChange)
    handleQueueChange()
  })
}
