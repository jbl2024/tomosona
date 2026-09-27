import { computed, nextTick, watch, type Ref } from 'vue'
import type { ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import { isMarkdownPath } from '../../../app/lib/appShellPaths'
import { editorSurfaceModeForPath } from '../../../app/lib/appShellDocuments'
import { useEditorSessionLifecycle } from './useEditorSessionLifecycle'
import { useTextEditorSessions, type TextEditorSession } from './useTextEditorSessions'
import { useTextEditorSessionStatus } from './useTextEditorSessionStatus'
import type { WaitForHeavyRenderIdle, HasPendingHeavyRender, CaptureHeavyRenderEpoch } from './useEditorFileLifecycle'

const MAIN_PANE_ID = 'main'

type ReadTextResult = {
  content: string
  version: ReadNoteSnapshotResult['version'] | null
}

function detectLineEnding(text: string): 'lf' | 'crlf' {
  return /\r\n/.test(text) ? 'crlf' : 'lf'
}

function normalizeLineEndings(text: string, lineEnding: 'lf' | 'crlf') {
  const normalized = text.replace(/\r\n?/g, '\n')
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}

/**
 * Module: useSourceEditorRuntime
 *
 * Owns raw-text file loading, save/autosave, and path-scoped raw editor session
 * state for the source editor surface.
 */
export type UseSourceEditorRuntimeOptions = {
  path: Ref<string>
  openPaths: Ref<string[]>
  openFile?: (path: string) => Promise<string>
  readNoteSnapshot?: (path: string) => Promise<ReadNoteSnapshotResult>
  saveFile?: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  saveNoteBuffer?: (
    path: string,
    text: string,
    options: { explicit: boolean; expectedBaseVersion: TextEditorSession['baseVersion']; force?: boolean }
  ) => Promise<SaveNoteResult>
  emitStatus: (payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) => void
  emitOutline: (payload: Array<{ text: string; level: number; id: string }>) => void
  isSourceMode: (path: string) => boolean
  isEditingTitle: () => boolean
  waitForHeavyRenderIdle?: WaitForHeavyRenderIdle
  hasPendingHeavyRender?: HasPendingHeavyRender
  captureHeavyRenderEpoch?: CaptureHeavyRenderEpoch
}

export function useSourceEditorRuntime(options: UseSourceEditorRuntimeOptions) {
  const sessions = useTextEditorSessions()
  const currentPath = computed(() => sessions.getActivePath(MAIN_PANE_ID) || options.path.value?.trim() || '')

  const lifecycle = useEditorSessionLifecycle({
    emitStatus: (payload) => options.emitStatus(payload),
    saveCurrentFile: (manual) => saveCurrentFile(manual),
    isEditingTitle: options.isEditingTitle,
    autosaveIdleMs: 1800
  })

  const sessionStatus = useTextEditorSessionStatus({
    getSession: (path) => sessions.getSession(path),
    patchStatus: (path, patch) => lifecycle.patchStatus(path, patch),
    clearAutosaveTimer: () => lifecycle.clearAutosaveTimer(),
    scheduleAutosave: () => lifecycle.scheduleAutosave()
  })

  function ensureSession(path: string) {
    return sessions.ensureSession(path)
  }

  function getSession(path: string) {
    return sessions.getSession(path)
  }

  function setActiveSession(path: string) {
    sessions.setActivePath(MAIN_PANE_ID, path)
  }

  watch(
    () => options.openPaths.value,
    (nextOpenPaths) => {
      const keep = new Set(nextOpenPaths.map((path) => path.trim()).filter(Boolean))
      for (const sessionPath of sessions.listPaths()) {
        if (!keep.has(sessionPath)) {
          sessions.closePath(sessionPath)
        }
      }
      for (const path of keep) {
        sessions.ensureSession(path)
      }
    },
    { immediate: true, deep: true }
  )

  function setText(path: string, text: string) {
    const session = ensureSession(path)
    if (session.text === text) return
    session.text = text
    sessionStatus.setDirty(path, true)
    sessionStatus.setSaveError(path, '')
    sessionStatus.scheduleAutosave(path)
  }

  /** Stores source-surface presentation state with the file session. */
  function setViewState(path: string, state: { scrollTop?: number; scrollLeft?: number; wordWrap?: boolean }) {
    const session = ensureSession(path)
    if (typeof state.scrollTop === 'number') session.scrollTop = state.scrollTop
    if (typeof state.scrollLeft === 'number') session.scrollLeft = state.scrollLeft
    if (typeof state.wordWrap === 'boolean') session.wordWrap = state.wordWrap
  }

  async function readSnapshot(path: string): Promise<ReadTextResult> {
    if (options.isSourceMode(path) && isMarkdownPath(path) && options.readNoteSnapshot) {
      const snapshot = await options.readNoteSnapshot(path)
      return { content: snapshot.content, version: snapshot.version }
    }
    if (options.openFile) {
      return { content: await options.openFile(path), version: null }
    }
    return { content: '', version: null }
  }

  async function loadCurrentFile(path: string, loadOptions?: { forceReload?: boolean; requestId?: number }) {
    if (!path || !options.isSourceMode(path)) return
    const session = ensureSession(path)
    const shouldReloadContent = !session.isLoaded || Boolean(loadOptions?.forceReload)
    if (!shouldReloadContent) return

    sessionStatus.setSaveError(path, '')
    sessionStatus.clearAutosaveTimer()

    const snapshot = await readSnapshot(path)
    if (!options.isSourceMode(path)) return

    session.text = snapshot.content
    session.loadedText = snapshot.content
    session.lineEnding = detectLineEnding(snapshot.content)
    session.baseVersion = snapshot.version
    session.currentDiskVersion = snapshot.version
    session.conflict = null
    session.isLoaded = true
    sessionStatus.setDirty(path, false)
    options.emitOutline([])
    await nextTick()
  }

  async function saveCurrentFile(manual = true, saveOptions?: { force?: boolean }) {
    const path = currentPath.value
    const session = getSession(path)
    if (!path || !session || session.saving || !options.isSourceMode(path)) return

    const text = normalizeLineEndings(session.text, session.lineEnding)
    if (!manual && text === session.loadedText) {
      sessionStatus.setDirty(path, false)
      return
    }

    sessionStatus.setSaving(path, true)
    if (manual) sessionStatus.setSaveError(path, '')

    try {
      let result: SaveNoteResult | { ok: true; version: TextEditorSession['baseVersion'] } | { persisted: boolean }
      if (isMarkdownPath(path) && options.saveNoteBuffer) {
        result = await options.saveNoteBuffer(path, text, {
          explicit: manual,
          expectedBaseVersion: session.baseVersion,
          force: Boolean(saveOptions?.force)
        })
        if (!result.ok) {
          if (result.reason === 'CONFLICT') {
            session.currentDiskVersion = result.diskVersion
            session.conflict = {
              kind: 'modified',
              diskVersion: result.diskVersion,
              diskContent: result.diskContent,
              detectedAt: Date.now()
            }
            sessionStatus.setDirty(path, true)
            sessionStatus.setSaveError(path, 'File changed on disk. Resolve the conflict before saving.')
            return
          }
          sessionStatus.setSaveError(path, result.message)
          sessionStatus.setDirty(path, true)
          return
        }
        session.loadedText = text
        session.baseVersion = result.version
        session.currentDiskVersion = result.version
      } else if (options.saveFile) {
        await options.saveFile(path, text, { explicit: manual })
        session.loadedText = text
        session.baseVersion = null
        session.currentDiskVersion = null
      } else {
        throw new Error('No save handler is available for this file.')
      }

      session.conflict = null
      session.isLoaded = true
      sessionStatus.setDirty(path, false)
    } catch (error) {
      sessionStatus.setSaveError(path, error instanceof Error ? error.message : 'Could not save file.')
      sessionStatus.setDirty(path, true)
    } finally {
      sessionStatus.setSaving(path, false)
      options.emitOutline([])
    }
  }

  async function applyWorkspaceFsChanges(changes: WorkspaceFsChange[]) {
    for (const change of changes) {
      const path = change.path?.trim()
      const current = path ? sessions.getSession(path) : null
      if (!path || !current || change.is_dir || !options.isSourceMode(path)) continue
      if (change.kind === 'removed') {
        current.currentDiskVersion = null
        if (current.dirty || current.saving) {
          current.conflict = {
            kind: 'deleted',
            detectedAt: Date.now()
          }
        } else {
          current.baseVersion = null
          current.conflict = {
            kind: 'deleted',
            detectedAt: Date.now()
          }
        }
        continue
      }
      if (change.kind === 'modified' || change.kind === 'created') {
        if (current.dirty || current.saving) {
          current.conflict = {
            kind: 'modified',
            diskVersion: current.currentDiskVersion ?? undefined,
            diskContent: change.kind === 'modified' ? undefined : current.loadedText,
            detectedAt: Date.now()
          }
          continue
        }
        await loadCurrentFile(path, { forceReload: true })
      }
      if (change.kind === 'renamed' && change.old_path && change.new_path && sessions.getSession(change.old_path)) {
        sessions.renamePath(change.old_path, change.new_path)
      }
    }
  }

  watch(
    currentPath,
    async (path) => {
      if (!path || !options.isSourceMode(path)) {
        options.emitOutline([])
        return
      }
      sessions.ensureSession(path)
      sessions.setActivePath(MAIN_PANE_ID, path)
      await loadCurrentFile(path, { forceReload: false })
    },
    { immediate: true }
  )

  return {
    currentPath,
    renderPaths: computed(() => options.openPaths.value.map((path) => path.trim()).filter(Boolean)),
    getSession,
    ensureSession,
    setActiveSession,
    loadCurrentFile,
    saveCurrentFile,
    setText,
    setViewState,
    applyWorkspaceFsChanges,
    nextRequestId: lifecycle.nextRequestId,
    isCurrentRequest: lifecycle.isCurrentRequest,
    isSourceMode: options.isSourceMode,
    sourceSurfaceModeForPath: (path: string) => editorSurfaceModeForPath(path),
    shouldIgnoreWatcherChangeForPath: (_path: string) => false
  }
}
