/** Loads protection flags for lists of page paths. */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { pageProtectionStatus } from '../api/pageProtectionApi'

/**
 * Tracks which paths are protected and which are still locked for the session.
 *
 * The two sets are kept apart because the UI must not present a page that was
 * unlocked for this session as if it were currently inaccessible.
 */
export function usePageProtectionStates(paths: () => string[]) {
  const protectedPaths = ref(new Set<string>())
  const lockedPaths = ref(new Set<string>())
  let generation = 0
  async function refresh() {
    const current = ++generation
    const items = [...new Set(paths())]
    if (!items.length) {
      protectedPaths.value = new Set()
      lockedPaths.value = new Set()
      return
    }
    try {
      const statuses = await pageProtectionStatus(items)
      if (current !== generation) return
      protectedPaths.value = new Set(statuses.filter((item) => item.isProtected).map((item) => item.path))
      lockedPaths.value = new Set(statuses.filter((item) => item.isLocked).map((item) => item.path))
    } catch {
      if (current !== generation) return
      protectedPaths.value = new Set()
      lockedPaths.value = new Set()
    }
  }
  watch(paths, () => { void refresh() }, { immediate: true })
  onMounted(() => window.addEventListener('page-protection-changed', refresh))
  onUnmounted(() => { generation++; window.removeEventListener('page-protection-changed', refresh) })
  return { protectedPaths, lockedPaths }
}

/** Keeps badge state current as paths or page-protection settings change. */
export function usePageProtectionBadges(paths: () => string[]) {
  return usePageProtectionStates(paths).protectedPaths
}
