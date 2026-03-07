import { ref } from 'vue'
import { parseWikilinkTarget } from '../lib/wikilinks'

/**
 * Module: useEditorWikilinkDataSource
 *
 * Owns cached wikilink target/headings loading and existence resolution.
 */

/**
 * Dependencies required by {@link useEditorWikilinkDataSource}.
 */
export type UseEditorWikilinkDataSourceOptions = {
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  targetsTtlMs?: number
  headingsTtlMs?: number
}

/**
 * useEditorWikilinkDataSource
 *
 * Purpose:
 * - Own wikilink target/headings cache and lookup logic.
 *
 * Responsibilities:
 * - Cache target and heading lookups with TTL invalidation.
 * - Provide target existence resolution for wikilink validation.
 * - Expose cache reset hook when editor path/transient UI resets.
 */
export function useEditorWikilinkDataSource(options: UseEditorWikilinkDataSourceOptions) {
  const cachedLinkTargets = ref<string[]>([])
  const cachedLinkTargetsAt = ref(0)
  const cachedHeadingsByTarget = ref<Record<string, string[]>>({})
  const cachedHeadingsAt = ref<Record<string, number>>({})
  const targetsTtlMs = options.targetsTtlMs ?? 15_000
  const headingsTtlMs = options.headingsTtlMs ?? 30_000

  function resetCache() {
    cachedLinkTargetsAt.value = 0
    cachedHeadingsByTarget.value = {}
    cachedHeadingsAt.value = {}
  }

  /**
   * Returns note targets, serving cached values within TTL.
   */
  async function loadWikilinkTargets() {
    const now = Date.now()
    if (cachedLinkTargets.value.length && now - cachedLinkTargetsAt.value < targetsTtlMs) {
      return cachedLinkTargets.value
    }
    try {
      const targets = await options.loadLinkTargets()
      cachedLinkTargets.value = targets
      cachedLinkTargetsAt.value = Date.now()
      return targets
    } catch {
      cachedLinkTargets.value = []
      cachedLinkTargetsAt.value = Date.now()
      return []
    }
  }

  /**
   * Returns target headings, using per-target ttl cache.
   */
  async function loadWikilinkHeadings(target: string) {
    const key = target.trim().toLowerCase()
    const now = Date.now()
    if (
      key &&
      cachedHeadingsByTarget.value[key] &&
      now - (cachedHeadingsAt.value[key] ?? 0) < headingsTtlMs
    ) {
      return cachedHeadingsByTarget.value[key]
    }
    try {
      const headings = await options.loadLinkHeadings(target)
      if (key) {
        cachedHeadingsByTarget.value = { ...cachedHeadingsByTarget.value, [key]: headings }
        cachedHeadingsAt.value = { ...cachedHeadingsAt.value, [key]: Date.now() }
      }
      return headings
    } catch {
      return []
    }
  }

  /**
   * Resolves whether wikilink target note path exists.
   */
  async function resolveWikilinkTarget(target: string): Promise<boolean> {
    const parsed = parseWikilinkTarget(target)
    if (!parsed.notePath) return true
    const targets = await loadWikilinkTargets()
    const wanted = parsed.notePath.toLowerCase()
    return targets.some((entry) => entry.toLowerCase() === wanted)
  }

  return {
    resetCache,
    loadWikilinkTargets,
    loadWikilinkHeadings,
    resolveWikilinkTarget
  }
}
