import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { DocumentSession } from './useDocumentEditorSessions'

/**
 * Runtime dependencies used by {@link useEditorPathWatchers}.
 */
export type UseEditorPathWatchersOptions = {
  path: Ref<string>
  openPaths: Ref<string[]>
  holder: Ref<HTMLElement | null>
  currentPath: Ref<string>
  nextRequestId: () => number
  ensureSession: (path: string) => DocumentSession
  setActiveSession: (path: string) => void
  loadCurrentFile: (path: string, options?: { forceReload?: boolean; requestId?: number }) => Promise<void>
  captureCaret: (path: string) => void
  getSession: (path: string) => DocumentSession | null
  getActivePath: () => string
  setActivePath: (path: string) => void
  clearActiveEditor: () => void
  listPaths: () => string[]
  closePath: (path: string) => void
  resetPropertySchemaState: () => void
  emitEmptyProperties: () => void
  closeSlashMenu: () => void
  closeWikilinkMenu: () => void
  closeBlockMenu: () => void
  hideTableToolbarAnchor: () => void
  emitEmptyOutline: () => void
  onMountInit: () => Promise<void>
  onUnmountCleanup: () => Promise<void>
}

/**
 * useEditorPathWatchers
 *
 * Purpose:
 * - Own path/open-path watch flows and component mount/unmount orchestration.
 *
 * Responsibilities:
 * - Handle path switching, stale-load token progression, and empty-path UI reset.
 * - Close orphan sessions not present in open paths.
 * - Run host-provided mount/unmount lifecycle hooks.
 */
export function useEditorPathWatchers(options: UseEditorPathWatchersOptions) {
  function shouldCaptureCaretFromHolder(): boolean {
    if (!options.holder.value) return false
    const active = typeof document !== 'undefined' ? document.activeElement : null
    return Boolean(active && options.holder.value.contains(active))
  }

  watch(
    () => options.path.value,
    async (next, prev) => {
      if (prev && options.holder.value) {
        if (shouldCaptureCaretFromHolder()) {
          options.captureCaret(prev)
        }
        const prevSession = options.getSession(prev)
        if (prevSession) prevSession.scrollTop = options.holder.value.scrollTop
      }

      const nextPath = next?.trim()
      if (!nextPath) {
        options.nextRequestId()
        const activePath = options.getActivePath()
        if (activePath) {
          if (shouldCaptureCaretFromHolder()) {
            options.captureCaret(activePath)
          }
          if (options.holder.value) {
            const activeSession = options.getSession(activePath)
            if (activeSession) activeSession.scrollTop = options.holder.value.scrollTop
          }
        }
        options.setActivePath('')
        options.clearActiveEditor()
        options.resetPropertySchemaState()
        options.emitEmptyProperties()
        options.closeSlashMenu()
        options.closeWikilinkMenu()
        options.closeBlockMenu()
        options.hideTableToolbarAnchor()
        options.emitEmptyOutline()
        return
      }

      const requestId = options.nextRequestId()
      options.ensureSession(nextPath)
      options.setActiveSession(nextPath)
      await nextTick()
      await options.loadCurrentFile(nextPath, { requestId })
    }
  )

  watch(
    () => options.openPaths.value,
    (nextOpenPaths) => {
      const keep = new Set(nextOpenPaths.map((path) => path.trim()).filter(Boolean))
      const activePath = options.getActivePath() || options.currentPath.value
      for (const sessionPath of options.listPaths()) {
        if (sessionPath === activePath) continue
        if (!keep.has(sessionPath)) {
          options.closePath(sessionPath)
        }
      }
    },
    { deep: true }
  )

  onMounted(async () => {
    await options.onMountInit()
  })

  onBeforeUnmount(async () => {
    await options.onUnmountCleanup()
  })
}
