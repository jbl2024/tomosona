import type { WorkspaceFsChange } from '../../../shared/api/apiTypes'
import type { DocumentSession } from './useDocumentEditorSessions'

function logEditorSync(event: string, detail: Record<string, unknown>) {
  console.info('[editor-sync]', event, detail)
}

function sameVersion(
  left: DocumentSession['baseVersion'] | DocumentSession['currentDiskVersion'] | undefined,
  right: WorkspaceFsChange['version'] | undefined | null
) {
  return Boolean(left && right && left.mtimeMs === right.mtimeMs && left.size === right.size)
}

export type UseEditorFilesystemSyncOptions = {
  getSession: (path: string) => DocumentSession | null
  listPaths: () => string[]
  currentPath: () => string
  renameSessionPath: (from: string, to: string) => void
  moveLifecyclePathState: (from: string, to: string) => void
  moveFrontmatterPathState: (from: string, to: string) => void
  moveTitlePathState: (from: string, to: string) => void
  setActiveSession: (path: string) => void
  nextRequestId: () => number
  loadCurrentFile: (path: string, options?: { forceReload?: boolean; requestId?: number }) => Promise<void>
  emitExternalReload: (payload: { path: string }) => void
  shouldIgnoreOwnSaveWatcherChange?: (path: string) => boolean
}

/**
 * Applies external workspace filesystem changes to path-scoped editor sessions.
 */
export function useEditorFilesystemSync(options: UseEditorFilesystemSyncOptions) {
  function noteConflict(session: DocumentSession, kind: 'modified' | 'deleted', payload?: { diskContent?: string }) {
    const existing = session.conflict
    if (
      existing?.kind === kind &&
      sameVersion(existing.diskVersion ?? null, session.currentDiskVersion) &&
      existing.diskContent === payload?.diskContent
    ) {
      return
    }
    session.conflict = {
      kind,
      diskVersion: session.currentDiskVersion ?? undefined,
      diskContent: payload?.diskContent,
      detectedAt: Date.now()
    }
  }

  async function reloadCleanSession(path: string) {
    const session = options.getSession(path)
    if (!session) return
    const requestId = options.nextRequestId()
    logEditorSync('fs:reload_clean_session', { path, requestId })
    if (options.currentPath() === path) {
      options.setActiveSession(path)
    }
    await options.loadCurrentFile(path, { forceReload: true, requestId })
    options.emitExternalReload({ path })
  }

  async function applyWorkspaceFsChanges(changes: WorkspaceFsChange[]) {
    const openPaths = new Set(options.listPaths())

    for (const change of changes) {
      if (change.kind === 'renamed') {
        const oldPath = change.old_path?.trim() ?? ''
        const newPath = change.new_path?.trim() ?? ''
        if (
          (oldPath && options.shouldIgnoreOwnSaveWatcherChange?.(oldPath)) ||
          (newPath && options.shouldIgnoreOwnSaveWatcherChange?.(newPath))
        ) {
          logEditorSync('fs:ignore_rename', { change })
          continue
        }
      }

      if (change.kind === 'renamed' && change.old_path && change.new_path && openPaths.has(change.old_path)) {
        logEditorSync('fs:apply_rename', { change })
        options.renameSessionPath(change.old_path, change.new_path)
        options.moveLifecyclePathState(change.old_path, change.new_path)
        options.moveFrontmatterPathState(change.old_path, change.new_path)
        options.moveTitlePathState(change.old_path, change.new_path)
        continue
      }

      const path = change.path?.trim()
      if (!path || !openPaths.has(path) || change.is_dir) continue
      if (options.shouldIgnoreOwnSaveWatcherChange?.(path)) {
        logEditorSync('fs:ignore_path_change', { change })
        continue
      }

      const session = options.getSession(path)
      if (!session) continue

      if (change.kind === 'removed') {
        logEditorSync('fs:removed', {
          path,
          dirty: session.dirty,
          saving: session.saving
        })
        session.currentDiskVersion = null
        if (session.dirty || session.saving) {
          noteConflict(session, 'deleted')
          logEditorSync('fs:removed_conflict', { path })
        } else {
          session.baseVersion = null
          session.conflict = {
            kind: 'deleted',
            detectedAt: Date.now()
          }
          logEditorSync('fs:removed_mark_deleted', { path })
        }
        continue
      }

      if (change.kind === 'created' || change.kind === 'modified') {
        if (sameVersion(session.currentDiskVersion, change.version)) {
          logEditorSync('fs:skip_duplicate_version', {
            path,
            version: change.version,
            dirty: session.dirty,
            saving: session.saving
          })
          continue
        }
        session.currentDiskVersion = change.version ?? session.currentDiskVersion
        logEditorSync('fs:content_change', {
          change,
          dirty: session.dirty,
          saving: session.saving,
          currentDiskVersion: session.currentDiskVersion
        })
        if (session.dirty || session.saving) {
          noteConflict(session, 'modified')
          logEditorSync('fs:content_change_conflict', { path })
          continue
        }
        await reloadCleanSession(path)
      }
    }
  }

  return {
    applyWorkspaceFsChanges
  }
}
