/** Loads protection flags for lists of page paths. */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { pageProtectionStatus } from '../api/pageProtectionApi'

/** Keeps badge state current as paths or page-protection settings change. */
export function usePageProtectionBadges(paths: () => string[]) {
  const protectedPaths = ref(new Set<string>())
  let generation = 0
  async function refresh() {
    const current = ++generation
    const items = [...new Set(paths())]
    if (!items.length) {
      protectedPaths.value = new Set()
      return
    }
    try {
      const statuses = await pageProtectionStatus(items)
      if (current === generation) protectedPaths.value = new Set(statuses.filter((item) => item.isProtected).map((item) => item.path))
    } catch {
      if (current === generation) protectedPaths.value = new Set()
    }
  }
  watch(paths, () => { void refresh() }, { immediate: true })
  onMounted(() => window.addEventListener('page-protection-changed', refresh))
  onUnmounted(() => { generation++; window.removeEventListener('page-protection-changed', refresh) })
  return protectedPaths
}
