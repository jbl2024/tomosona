/**
 * Module: useAppNotePersistence
 *
 * Purpose:
 * - Keep note snapshot, title-based rename, and save-buffer logic out of the
 *   root App shell.
 *
 * Boundaries:
 * - This composable owns only note IO orchestration.
 * - Workspace lifecycle, navigation, and pane state stay in `App.vue` or the
 *   domain controllers that already own them.
 */
import { type Ref } from 'vue'
import type { FileVersion, ReadNoteSnapshotResult, SaveNoteResult } from '../../shared/api/apiTypes'
import { readNoteSnapshot as readNoteSnapshotIpc, type SaveNoteBufferRequest, saveNoteBuffer as saveNoteBufferIpc } from '../../shared/api/editorSyncApi'
import { fileName, normalizePathKey } from '../lib/appShellPaths'
import { markdownExtensionFromPath, isTitleOnlyContent, noteTitleFromPath, sanitizeTitleForFileName } from '../lib/appShellDocuments'

type VirtualDoc = {
  content: string
  titleLine: string
}

export type AppNotePersistenceSaveOptions = {
  explicit: boolean
  expectedBaseVersion: FileVersion | null
  force?: boolean
}

export type AppNotePersistenceOptions = {
  workingFolderPath: Ref<string>
  virtualDocs: Ref<Record<string, VirtualDoc>>
  allWorkspaceFiles: Ref<string[]>
  ensureParentFolders: (path: string) => Promise<void>
  refreshActiveFileMetadata: (path: string) => Promise<void>
  upsertWorkspaceFilePath: (path: string) => void
  loadAllFiles: () => Promise<void>
  enqueueMarkdownReindex: (path: string) => void
  pathExists: (path: string) => Promise<boolean>
  renameEntry: (path: string, nextName: string, conflict: 'rename') => Promise<string>
}

export type AppNotePersistenceApi = {
  readNoteSnapshot: (path: string) => Promise<ReadNoteSnapshotResult>
  renameFileFromTitle: (path: string, rawTitle: string) => Promise<{ path: string; title: string }>
  saveNoteBuffer: (path: string, content: string, options: AppNotePersistenceSaveOptions) => Promise<SaveNoteResult>
}

/**
 * Owns the root shell's note snapshot, rename, and save-buffer orchestration.
 *
 * The helper keeps App-specific persistence rules explicit and testable while
 * leaving workspace lifecycle, navigation, and UI orchestration in the shell.
 */
export function useAppNotePersistence(options: AppNotePersistenceOptions): AppNotePersistenceApi {
  /**
   * Reads a note snapshot, returning the virtual document buffer when the
   * editor is holding unsaved content for the same path.
   */
  async function readNoteSnapshot(path: string): Promise<ReadNoteSnapshotResult> {
    if (!options.workingFolderPath.value) {
      throw new Error('Working folder is not set.')
    }

    const virtual = options.virtualDocs.value[path]
    if (virtual) {
      return {
        path,
        content: virtual.content,
        version: null
      }
    }

    return await readNoteSnapshotIpc(path)
  }

  /**
   * Renames a note from a requested title while preserving the current file
   * extension and choosing a unique fallback path when the source does not yet
   * exist on disk.
   */
  async function renameFileFromTitle(path: string, rawTitle: string): Promise<{ path: string; title: string }> {
    const root = options.workingFolderPath.value
    if (!root) {
      throw new Error('Working folder is not set.')
    }

    const normalizedTitle = sanitizeTitleForFileName(rawTitle)
    const ext = markdownExtensionFromPath(path)
    const nextName = `${normalizedTitle}${ext}`

    if (fileName(path) === nextName) {
      return { path, title: normalizedTitle }
    }

    const exists = await options.pathExists(path)
    if (!exists) {
      const parent = path.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
      let candidate = `${parent}/${nextName}`
      let idx = 1
      while (await options.pathExists(candidate)) {
        const alt = `${normalizedTitle} (${idx})${ext}`
        candidate = `${parent}/${alt}`
        idx += 1
        if (idx > 9_999) {
          throw new Error('Could not choose a unique filename.')
        }
      }
      return {
        path: candidate,
        title: noteTitleFromPath(candidate)
      }
    }

    const renamedPath = await options.renameEntry(path, nextName, 'rename')
    return {
      path: renamedPath,
      title: noteTitleFromPath(renamedPath)
    }
  }

  /**
   * Saves the current buffer and refreshes shell-side file state on success.
   *
   * The save flow keeps the existing virtual-document shortcut, then updates
   * workspace state only after the backend confirms persistence.
   */
  async function saveNoteBuffer(path: string, content: string, saveOptions: AppNotePersistenceSaveOptions): Promise<SaveNoteResult> {
    if (!options.workingFolderPath.value) {
      throw new Error('Working folder is not set.')
    }

    const virtual = options.virtualDocs.value[path]
    if (virtual && !saveOptions.explicit && isTitleOnlyContent(content, virtual.titleLine)) {
      return {
        ok: true,
        version: saveOptions.expectedBaseVersion
      }
    }

    await options.ensureParentFolders(path)
    const result = await saveNoteBufferIpc({
      path,
      content,
      expectedBaseVersion: saveOptions.expectedBaseVersion,
      requestId: crypto.randomUUID(),
      force: saveOptions.force
    } satisfies SaveNoteBufferRequest)

    if (!result.ok) {
      return result
    }

    await options.refreshActiveFileMetadata(path)

    if (virtual) {
      const nextVirtual = { ...options.virtualDocs.value }
      delete nextVirtual[path]
      options.virtualDocs.value = nextVirtual
    }

    const normalizedPathKey = normalizePathKey(path)
    const isNewWorkspacePath = !options.allWorkspaceFiles.value.some((item) => normalizePathKey(item) === normalizedPathKey)

    options.upsertWorkspaceFilePath(path)
    options.enqueueMarkdownReindex(path)

    if (virtual || isNewWorkspacePath) {
      await options.loadAllFiles()
    }

    return result
  }

  return {
    readNoteSnapshot,
    renameFileFromTitle,
    saveNoteBuffer
  }
}
