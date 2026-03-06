/**
 * Lightweight discoverability state for Echoes.
 *
 * The note-side helper stays local to the device/workspace session model and
 * intentionally avoids introducing a dedicated settings surface in v1.
 */
import { computed, ref } from 'vue'

const STORAGE_KEY = 'tomosona:echoes:hint:seen-count'
const MAX_HINT_SEEN_COUNT = 3

function readSeenCount(): number {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = Number.parseInt(raw ?? '0', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * Tracks whether the inline Echoes hint should still be shown.
 */
export function useEchoesDiscoverability() {
  const seenCount = ref(readSeenCount())

  /**
   * Records that a visible, non-empty Echoes pack was shown to the user.
   */
  function markPackShown() {
    if (typeof window === 'undefined') return
    if (seenCount.value >= MAX_HINT_SEEN_COUNT) return
    seenCount.value += 1
    window.localStorage.setItem(STORAGE_KEY, String(seenCount.value))
  }

  return {
    hintVisible: computed(() => seenCount.value < MAX_HINT_SEEN_COUNT),
    markPackShown
  }
}
