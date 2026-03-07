/**
 * Echoes pack loading state for a reactive note anchor.
 *
 * The composable owns transport concerns only: request lifecycles, stale result
 * protection, and normalized loading/error state. Presentation stays in
 * dedicated components.
 */
import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { computeEchoesPack } from '../../../shared/api/indexApi'
import type { EchoesItem } from '../lib/echoes'

type UseEchoesPackOptions = {
  limit?: number
  enabled?: MaybeRefOrGetter<boolean>
}

/**
 * Loads Echoes suggestions for a reactive anchor path.
 */
export function useEchoesPack(
  anchorPath: MaybeRefOrGetter<string>,
  options: UseEchoesPackOptions = {}
) {
  const items = ref<EchoesItem[]>([])
  const loading = ref(false)
  const error = ref('')
  let requestToken = 0

  function resetState() {
    items.value = []
    loading.value = false
    error.value = ''
  }

  /**
   * Refreshes the current Echoes pack using the latest anchor.
   */
  async function refresh() {
    const resolvedAnchor = toValue(anchorPath)?.trim() || ''
    const enabled = toValue(options.enabled ?? true)
    if (!enabled || !resolvedAnchor) {
      resetState()
      return
    }

    const token = ++requestToken
    loading.value = true
    error.value = ''

    try {
      const pack = await computeEchoesPack(resolvedAnchor, {
        limit: options.limit
      })
      if (token !== requestToken) return
      items.value = pack.items
      error.value = ''
    } catch (err) {
      if (token !== requestToken) return
      items.value = []
      error.value = err instanceof Error ? err.message : 'Could not load Echoes.'
    } finally {
      if (token === requestToken) {
        loading.value = false
      }
    }
  }

  watch(
    () => [toValue(anchorPath)?.trim() || '', toValue(options.enabled ?? true)] as const,
    () => {
      void refresh()
    },
    { immediate: true }
  )

  return {
    items: computed(() => items.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    empty: computed(() => !loading.value && !error.value && items.value.length === 0),
    refresh
  }
}
