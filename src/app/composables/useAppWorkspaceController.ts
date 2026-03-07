import { ref, type Ref } from 'vue'
import type { FileMetadata, WorkspaceFsChange } from '../../shared/api/apiTypes'
import { toWorkspaceRelativePath } from '../../domains/explorer/lib/workspacePaths'

/**
 * Module: useAppWorkspaceController
 *
 * Purpose:
 * - Own workspace-scoped shell state such as the markdown file list and active
 *   file metadata.
 * - Centralize workspace lifecycle helpers that are independent from view-level
 *   navigation concerns.
 */

/** Declares the services and reactive shell state required by the workspace controller. */
export type UseAppWorkspaceControllerOptions = {
  workingFolderPath: Readonly<Ref<string>>
  hasWorkspace: Readonly<Ref<boolean>>
  activeFilePath: Readonly<Ref<string>>
  indexingState: Ref<'idle' | 'indexing' | 'indexed' | 'out_of_sync'>
  errorMessage: Ref<string>
  selectedCount: Ref<number>
  storageKey: string
  setWorkspacePath: (path: string) => void
  clearWorkspacePath: () => void
  resetIndexingState: () => void
  setWorkingFolder: (path: string) => Promise<string>
  clearWorkingFolder: () => Promise<void>
  initDb: () => Promise<void>
  readFileMetadata: (path: string) => Promise<FileMetadata>
  pathExists: (path: string) => Promise<boolean>
  listChildren: (path: string) => Promise<Array<{ path: string; is_dir: boolean; is_markdown: boolean }>>
  listMarkdownFiles: () => Promise<string[]>
  readPropertyTypeSchema: () => Promise<Record<string, string>>
  writePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  createEntry: (parentPath: string, name: string, kind: 'file' | 'folder', conflict: 'fail' | 'rename') => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>
  normalizePath: (path: string) => string
  normalizePathKey: (path: string) => string
  isMarkdownPath: (path: string) => boolean
  isIsoDate: (value: string) => boolean
  dailyNotePath: (root: string, date: string) => string
  enqueueMarkdownReindex?: (path: string) => void
  removeMarkdownFromIndexInBackground?: (path: string) => void
  refreshBacklinks?: () => Promise<void>
  refreshCosmosGraph?: () => Promise<void>
  hasCosmosSurface?: () => boolean
}

/**
 * Owns workspace-scoped shell state and filesystem-derived helpers that should
 * not stay inline in `App.vue`.
 */
export function useAppWorkspaceController(options: UseAppWorkspaceControllerOptions) {
  const allWorkspaceFiles = ref<string[]>([])
  const loadingAllFiles = ref(false)
  const activeFileMetadata = ref<FileMetadata | null>(null)
  let activeFileMetadataRequestToken = 0

  /** Converts an absolute workspace path into a path relative to the current workspace root. */
  function toRelativePath(path: string): string {
    return toWorkspaceRelativePath(options.workingFolderPath.value, path)
  }

  /** Clears workspace-scoped derived state when the active workspace changes or closes. */
  function resetWorkspaceState() {
    allWorkspaceFiles.value = []
    loadingAllFiles.value = false
    activeFileMetadata.value = null
  }

  /** Adds a markdown path to the in-memory workspace file list if it is not already present. */
  function upsertWorkspaceFilePath(path: string) {
    if (!options.isMarkdownPath(path)) return
    const normalized = options.normalizePathKey(path)
    const exists = allWorkspaceFiles.value.some((item) => options.normalizePathKey(item) === normalized)
    if (exists) return
    allWorkspaceFiles.value = [...allWorkspaceFiles.value, path].sort((left, right) => left.localeCompare(right))
  }

  /** Removes a file or folder subtree from the in-memory workspace file list. */
  function removeWorkspaceFilePath(path: string) {
    const normalized = options.normalizePathKey(path)
    const normalizedPrefix = `${normalized}/`
    allWorkspaceFiles.value = allWorkspaceFiles.value.filter((item) => {
      const candidate = options.normalizePathKey(item)
      return candidate !== normalized && !candidate.startsWith(normalizedPrefix)
    })
  }

  /** Rewrites one path subtree inside the in-memory workspace file list after a rename. */
  function replaceWorkspaceFilePath(oldPath: string, newPath: string) {
    if (!oldPath || !newPath) return
    const oldNormalized = options.normalizePath(oldPath)
    const newNormalized = options.normalizePath(newPath)
    const oldKey = oldNormalized.toLowerCase()
    const newKey = newNormalized.toLowerCase()
    if (oldKey === newKey) return

    const next = allWorkspaceFiles.value.map((entry) => {
      const entryNormalized = options.normalizePath(entry)
      const entryKey = entryNormalized.toLowerCase()
      if (entryKey === oldKey || entryKey.startsWith(`${oldKey}/`)) {
        return `${newNormalized}${entryNormalized.slice(oldNormalized.length)}`
      }
      return entry
    })
    allWorkspaceFiles.value = Array.from(new Set(next)).sort((left, right) => left.localeCompare(right))
  }

  /** Refreshes active-file metadata while discarding stale responses from older requests. */
  async function refreshActiveFileMetadata(path: string | null = options.activeFilePath.value) {
    const targetPath = path?.trim() || ''
    const requestToken = ++activeFileMetadataRequestToken
    if (!targetPath) {
      activeFileMetadata.value = null
      return
    }
    try {
      const next = await options.readFileMetadata(targetPath)
      if (requestToken === activeFileMetadataRequestToken && options.activeFilePath.value === targetPath) {
        activeFileMetadata.value = next
      }
    } catch {
      if (requestToken === activeFileMetadataRequestToken && options.activeFilePath.value === targetPath) {
        activeFileMetadata.value = null
      }
    }
  }

  /** Ensures every parent directory of a target file exists before writing it. */
  async function ensureParentFolders(filePath: string) {
    const root = options.workingFolderPath.value
    if (!root) throw new Error('Working folder is not set.')

    const relative = toRelativePath(filePath)
    const parts = relative.split('/').filter(Boolean)
    if (parts.length <= 1) return

    let current = root
    for (const segment of parts.slice(0, -1)) {
      const next = `${current}/${segment}`
      const exists = await options.pathExists(next)
      if (!exists) {
        await options.createEntry(current, segment, 'folder', 'fail')
      }
      current = next
    }
  }

  /** Traverses the workspace tree and caches every markdown file path for shell features. */
  async function loadAllFiles() {
    if (!options.workingFolderPath.value || loadingAllFiles.value) return
    loadingAllFiles.value = true

    try {
      const files: string[] = []
      const queue: string[] = [options.workingFolderPath.value]

      while (queue.length > 0) {
        const dir = queue.shift()
        if (!dir) continue
        const children = await options.listChildren(dir)
        for (const child of children) {
          if (child.is_dir) {
            queue.push(child.path)
            continue
          }
          if (child.is_markdown) {
            files.push(child.path)
          }
        }
      }

      allWorkspaceFiles.value = files.sort((left, right) => left.localeCompare(right))
    } catch (err) {
      options.errorMessage.value = err instanceof Error ? err.message : 'Could not load file list.'
    } finally {
      loadingAllFiles.value = false
    }
  }

  /** Opens or creates a daily note, then defers the actual tab navigation to the caller. */
  async function openDailyNote(date: string, openPath: (path: string) => Promise<boolean>) {
    const root = options.workingFolderPath.value
    if (!root) {
      options.errorMessage.value = 'Working folder is not set.'
      return false
    }
    if (!options.isIsoDate(date)) {
      options.errorMessage.value = 'Invalid date format. Use YYYY-MM-DD.'
      return false
    }

    const path = options.dailyNotePath(root, date)
    let exists = false
    try {
      exists = await options.pathExists(path)
    } catch {
      exists = false
    }

    if (!exists) {
      await ensureParentFolders(path)
      await options.writeTextFile(path, '')
      upsertWorkspaceFilePath(path)
    }

    return await openPath(path)
  }

  /** Loads markdown-only wikilink targets used by wikilink resolution and completion. */
  async function loadWikilinkTargets(): Promise<string[]> {
    if (!options.workingFolderPath.value) return []
    try {
      return await options.listMarkdownFiles()
    } catch (err) {
      options.errorMessage.value = err instanceof Error ? err.message : 'Could not load wikilink targets.'
      return []
    }
  }

  /** Reads the persisted property schema for the current workspace. */
  async function loadPropertyTypeSchema(): Promise<Record<string, string>> {
    if (!options.workingFolderPath.value) return {}
    try {
      return await options.readPropertyTypeSchema()
    } catch (err) {
      options.errorMessage.value = err instanceof Error ? err.message : 'Could not load property types.'
      return {}
    }
  }

  /** Persists the property schema for the current workspace when one is open. */
  async function savePropertyTypeSchema(schema: Record<string, string>): Promise<void> {
    if (!options.workingFolderPath.value) return
    await options.writePropertyTypeSchema(schema)
  }

  /** Applies external filesystem watcher events to the cached workspace file list and related shell state. */
  function applyWorkspaceFsChanges(changes: WorkspaceFsChange[]) {
    if (!changes.length) return
    const activePath = options.activeFilePath.value
    const activePathKey = activePath ? options.normalizePathKey(activePath) : ''
    let shouldRefreshActiveMetadata = false
    let shouldRefreshCosmos = false

    for (const change of changes) {
      if (change.kind === 'removed' && change.path) {
        removeWorkspaceFilePath(change.path)
        if (options.isMarkdownPath(change.path)) {
          shouldRefreshCosmos = true
          options.removeMarkdownFromIndexInBackground?.(change.path)
        }
        if (activePathKey && options.normalizePathKey(change.path) === activePathKey) {
          activeFileMetadata.value = null
        }
        continue
      }

      if (change.kind === 'renamed') {
        if (change.old_path && change.new_path) {
          replaceWorkspaceFilePath(change.old_path, change.new_path)
          if (options.isMarkdownPath(change.old_path) || options.isMarkdownPath(change.new_path)) {
            shouldRefreshCosmos = true
            if (options.isMarkdownPath(change.old_path)) {
              options.removeMarkdownFromIndexInBackground?.(change.old_path)
            }
            if (options.isMarkdownPath(change.new_path)) {
              options.enqueueMarkdownReindex?.(change.new_path)
            }
          }
        } else if (change.old_path) {
          removeWorkspaceFilePath(change.old_path)
          if (options.isMarkdownPath(change.old_path)) {
            shouldRefreshCosmos = true
            options.removeMarkdownFromIndexInBackground?.(change.old_path)
          }
        } else if (!change.is_dir && change.new_path) {
          upsertWorkspaceFilePath(change.new_path)
          if (options.isMarkdownPath(change.new_path)) {
            shouldRefreshCosmos = true
            options.enqueueMarkdownReindex?.(change.new_path)
          }
        }

        if (
          activePathKey &&
          ((change.old_path && options.normalizePathKey(change.old_path) === activePathKey) ||
            (change.new_path && options.normalizePathKey(change.new_path) === activePathKey))
        ) {
          shouldRefreshActiveMetadata = true
        }
        continue
      }

      if ((change.kind === 'created' || change.kind === 'modified') && !change.is_dir && change.path) {
        upsertWorkspaceFilePath(change.path)
        if (options.isMarkdownPath(change.path)) {
          shouldRefreshCosmos = true
          options.enqueueMarkdownReindex?.(change.path)
        }
        if (activePathKey && options.normalizePathKey(change.path) === activePathKey) {
          shouldRefreshActiveMetadata = true
        }
      }
    }

    if (shouldRefreshActiveMetadata && activePath) {
      void refreshActiveFileMetadata(activePath)
    }
    if (shouldRefreshCosmos && options.hasCosmosSurface?.()) {
      void options.refreshCosmosGraph?.()
    }
  }

  /** Closes the current workspace and clears persisted shell state tied to it. */
  async function closeWorkspace() {
    if (!options.hasWorkspace.value) return
    options.resetIndexingState()
    resetWorkspaceState()
    options.selectedCount.value = 0
    options.clearWorkspacePath()
    try {
      await options.clearWorkingFolder()
    } catch (err) {
      options.errorMessage.value = err instanceof Error ? err.message : 'Could not close workspace.'
    }
    window.localStorage.removeItem(options.storageKey)
    options.indexingState.value = 'indexed'
  }

  /** Opens a workspace, initializes persisted services, and resets workspace-scoped shell caches. */
  async function loadWorkingFolder(path: string): Promise<string | null> {
    try {
      options.resetIndexingState()
      const canonical = await options.setWorkingFolder(path)
      options.setWorkspacePath(canonical)
      options.indexingState.value = 'indexing'
      await options.initDb()
      resetWorkspaceState()
      window.localStorage.setItem(options.storageKey, canonical)
      return canonical
    } catch (err) {
      options.clearWorkspacePath()
      resetWorkspaceState()
      window.localStorage.removeItem(options.storageKey)
      options.errorMessage.value = err instanceof Error ? err.message : 'Could not open working folder.'
      return null
    } finally {
      if (options.hasWorkspace.value) {
        options.indexingState.value = 'indexed'
      }
    }
  }

  return {
    allWorkspaceFiles,
    loadingAllFiles,
    activeFileMetadata,
    toRelativePath,
    resetWorkspaceState,
    upsertWorkspaceFilePath,
    removeWorkspaceFilePath,
    replaceWorkspaceFilePath,
    refreshActiveFileMetadata,
    ensureParentFolders,
    loadAllFiles,
    openDailyNote,
    loadWikilinkTargets,
    loadPropertyTypeSchema,
    savePropertyTypeSchema,
    applyWorkspaceFsChanges,
    closeWorkspace,
    loadWorkingFolder
  }
}
