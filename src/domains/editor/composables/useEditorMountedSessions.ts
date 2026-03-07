import { computed, ref, watch, type Ref } from 'vue'

/**
 * Module: useEditorMountedSessions
 *
 * Owns the in-memory mounted session list used by EditorView multi-instance rendering.
 */

/**
 * Dependencies required by {@link useEditorMountedSessions}.
 */
export type UseEditorMountedSessionsOptions = {
  openPaths: Ref<string[]>
  currentPath: Ref<string>
  ensureSession: (path: string) => void
}

/**
 * Creates mounted-session selectors for path-scoped editors.
 *
 * Responsibilities:
 * - Derive stable `renderPaths` from open tabs + active path.
 * - Keep active path rendered even when `openPaths` temporarily omits it.
 * - Pre-create session editors for renderable paths without loading file text.
 *
 * Invariants:
 * - Side effects (session pre-creation) are watcher-driven; computed selectors stay pure.
 * - Path order remains stable across rapid switches unless caller open-order changes.
 *
 * Failure behavior:
 * - Silently ignores empty/whitespace paths.
 */
export function useEditorMountedSessions(options: UseEditorMountedSessionsOptions) {
  const renderPaths = ref<string[]>([])

  const activePath = computed(() => options.currentPath.value.trim())

  function normalizePaths(values: string[]): string[] {
    const next: string[] = []
    const seen = new Set<string>()
    for (const raw of values) {
      const path = raw.trim()
      if (!path || seen.has(path)) continue
      seen.add(path)
      next.push(path)
    }
    return next
  }

  function syncRenderPaths() {
    const open = normalizePaths(options.openPaths.value)
    const active = activePath.value

    const desiredSet = new Set<string>(open)
    if (active) desiredSet.add(active)

    const prev = renderPaths.value
    const ordered = prev.filter((path) => desiredSet.has(path))
    for (const path of open) {
      if (!ordered.includes(path)) ordered.push(path)
    }
    if (active && !ordered.includes(active)) {
      ordered.push(active)
    }

    renderPaths.value = ordered
    for (const path of renderPaths.value) {
      options.ensureSession(path)
    }
  }

  watch(
    () => [options.openPaths.value, options.currentPath.value] as const,
    () => {
      syncRenderPaths()
    },
    { immediate: true, deep: true, flush: 'sync' }
  )

  function isRenderedPath(path: string): boolean {
    return renderPaths.value.includes(path.trim())
  }

  function isActivePath(path: string): boolean {
    return path.trim() === activePath.value
  }

  return {
    activePath,
    renderPaths,
    isRenderedPath,
    isActivePath
  }
}
