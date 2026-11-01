/** Keeps locked-page reads pending while each pane presents its own unlock form. */
import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { isPageLockedError, pageProtectionStatus, unlockPage } from '../../shared/api/pageProtectionApi'

type Waiter = { resolve: () => void; reject: (error: Error) => void }

/** Coordinates protected reads without exposing an editor while its page is locked. */
export function useInlinePageUnlock(path: Readonly<Ref<string>>) {
  const state = ref<'checking' | 'locked' | 'unlocked' | 'error'>('checking')
  const error = ref('')
  const pending = ref(false)
  const waitingReads = ref<Record<string, number>>({})
  const waiters = new Map<string, Waiter[]>()
  let generation = 0
  let disposed = false

  function release(target: string) {
    const queued = waiters.get(target) ?? []
    waiters.delete(target)
    for (const waiter of queued) waiter.resolve()
  }

  async function refresh() {
    const target = path.value
    const request = ++generation
    error.value = ''
    if (!target) { state.value = 'unlocked'; return }
    state.value = 'checking'
    try {
      const [status] = await pageProtectionStatus([target])
      if (disposed || request !== generation || target !== path.value) return
      if (!status || status.path !== target) { state.value = 'error'; error.value = 'Could not check page protection.'; return }
      state.value = status.isLocked ? 'locked' : 'unlocked'
      if (!status.isLocked) release(target)
    } catch {
      if (!disposed && request === generation) { state.value = 'error'; error.value = 'Could not check page protection.' }
    }
  }

  async function read<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (cause) {
      if (!isPageLockedError(cause)) throw cause
      const target = cause.path
      if (disposed) throw new Error('Page is no longer open.')
      waitingReads.value = { ...waitingReads.value, [target]: (waitingReads.value[target] ?? 0) + 1 }
      try {
        await new Promise<void>((resolve, reject) => {
          const queued = waiters.get(target) ?? []
          queued.push({ resolve, reject })
          waiters.set(target, queued)
          if (target === path.value) void refresh()
        })
        return await operation()
      } finally {
        const count = (waitingReads.value[target] ?? 1) - 1
        const next = { ...waitingReads.value }
        if (count) next[target] = count
        else delete next[target]
        waitingReads.value = next
      }
    }
  }

  async function submit(password: string) {
    const target = path.value
    if (!target || pending.value || state.value !== 'locked') return
    pending.value = true
    error.value = ''
    try {
      // Let Vue render the busy state before invoking the native command.
      await nextTick()
      if (disposed || target !== path.value) return
      await unlockPage(target, password)
      release(target)
      window.dispatchEvent(new Event('page-protection-changed'))
      if (target === path.value) await refresh()
    } catch (cause) {
      if (target === path.value) {
        const message = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'Incorrect password or damaged file.'
        error.value = message === 'Incorrect password or damaged file.' ? `${message} Please try again.` : message
      }
    } finally { pending.value = false }
  }

  watch(path, () => { void refresh() }, { immediate: true, flush: 'sync' })
  const onProtectionChanged = () => { void refresh() }
  window.addEventListener('page-protection-changed', onProtectionChanged)
  onScopeDispose(() => {
    disposed = true
    generation++
    window.removeEventListener('page-protection-changed', onProtectionChanged)
    for (const queue of waiters.values()) for (const waiter of queue) waiter.reject(new Error('Page is no longer open.'))
    waiters.clear()
  })
  return { state, error, pending, waitingReads, read, submit, refresh }
}
