import { ref, type Ref } from 'vue'
import type { FileMetadata, WorkspaceFsChange } from '../../shared/api/apiTypes'
import { toWorkspaceRelativePath } from '../../domains/explorer/lib/workspacePaths'
import { finishOpenTraceSpan, startOpenTraceSpan, traceOpenStep } from '../../shared/lib/openTrace'

/**
 * Module: useAppWorkspaceController
 *
 * Purpose:
 * - Own workspace-scoped shell state such as the markdown file list and active
 *   file metadata.
 * - Centralize workspace lifecycle helpers that are independent from view-level
 *   navigation concerns.
 */

type WorkspaceChildEntry = {
  path: string
  is_dir: boolean
  is_markdown: boolean
}

type RefreshActiveFileMetadataOptions = {
  traceId?: string | null
  parentSpanId?: string | null
}

/**
 * Shell state and persistence owned by the workspace controller.
 *
 * Ports group coherent dependencies so this composable reads like workspace
 * orchestration instead of a flat list of unrelated callbacks.
 */
export type AppWorkspaceShellPort = {
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
}

/** Filesystem and persistence operations required by the workspace controller. */
export type AppWorkspaceFsPort = {
  setWorkingFolder: (path: string) => Promise<string>
  clearWorkingFolder: () => Promise<void>
  initDb: () => Promise<void>
  readFileMetadata: (path: string) => Promise<FileMetadata>
  pathExists: (path: string) => Promise<boolean>
  listChildren: (path: string) => Promise<WorkspaceChildEntry[]>
  listMarkdownFiles: () => Promise<string[]>
  createEntry: (parentPath: string, name: string, kind: 'file' | 'folder', conflict: 'fail' | 'rename') => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>
}

/** Markdown-specific logic and schema helpers used by workspace flows. */
export type AppWorkspaceDocumentPort = {
  readPropertyTypeSchema: () => Promise<Record<string, string>>
  writePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  normalizePath: (path: string) => string
  normalizePathKey: (path: string) => string
  isMarkdownPath: (path: string) => boolean
  isIsoDate: (value: string) => boolean
  dailyNotePath: (root: string, date: string) => string
}

/** Optional side effects triggered by workspace changes. */
export type AppWorkspaceEffectsPort = {
  enqueueMarkdownReindex?: (path: string) => void
  removeMarkdownFromIndexInBackground?: (path: string) => void
  refreshCosmosGraph?: () => Promise<void>
  hasCosmosSurface?: () => boolean
}

/** Declares the cohesive ports required by the workspace controller. */
export type UseAppWorkspaceControllerOptions = {
  workspaceShellPort: AppWorkspaceShellPort
  workspaceFsPort: AppWorkspaceFsPort
  workspaceDocumentPort: AppWorkspaceDocumentPort
  workspaceEffectsPort?: AppWorkspaceEffectsPort
}

/**
 * Owns workspace-scoped shell state and filesystem-derived helpers that should
 * not stay inline in `App.vue`.
 */
export function useAppWorkspaceController(options: UseAppWorkspaceControllerOptions) {
  const {
    workspaceShellPort,
    workspaceFsPort,
    workspaceDocumentPort,
    workspaceEffectsPort
  } = options
  const allWorkspaceFiles = ref<string[]>([])
  const loadingAllFiles = ref(false)
  const activeFileMetadata = ref<FileMetadata | null>(null)
  let activeFileMetadataRequestToken = 0
  const internalDirNames = new Set(['.tomosona', '.tomosona-trash'])

  /** Converts an absolute workspace path into a path relative to the current workspace root. */
  function toRelativePath(path: string): string {
    return toWorkspaceRelativePath(workspaceShellPort.workingFolderPath.value, path)
  }

  /** Clears workspace-scoped derived state when the active workspace changes or closes. */
  function resetWorkspaceState() {
    allWorkspaceFiles.value = []
    loadingAllFiles.value = false
    activeFileMetadata.value = null
  }

  /** Adds a markdown path to the in-memory workspace file list if it is not already present. */
  function upsertWorkspaceFilePath(path: string) {
    if (!workspaceDocumentPort.isMarkdownPath(path)) return
    const normalized = workspaceDocumentPort.normalizePathKey(path)
    const exists = allWorkspaceFiles.value.some((item) => workspaceDocumentPort.normalizePathKey(item) === normalized)
    if (exists) return
    allWorkspaceFiles.value = [...allWorkspaceFiles.value, path].sort((left, right) => left.localeCompare(right))
  }

  /** Removes a file or folder subtree from the in-memory workspace file list. */
  function removeWorkspaceFilePath(path: string) {
    const normalized = workspaceDocumentPort.normalizePathKey(path)
    const normalizedPrefix = `${normalized}/`
    allWorkspaceFiles.value = allWorkspaceFiles.value.filter((item) => {
      const candidate = workspaceDocumentPort.normalizePathKey(item)
      return candidate !== normalized && !candidate.startsWith(normalizedPrefix)
    })
  }

  /** Rewrites one path subtree inside the in-memory workspace file list after a rename. */
  function replaceWorkspaceFilePath(oldPath: string, newPath: string) {
    if (!oldPath || !newPath) return
    const oldNormalized = workspaceDocumentPort.normalizePath(oldPath)
    const newNormalized = workspaceDocumentPort.normalizePath(newPath)
    const oldKey = oldNormalized.toLowerCase()
    const newKey = newNormalized.toLowerCase()
    if (oldKey === newKey) return

    const next = allWorkspaceFiles.value.map((entry) => {
      const entryNormalized = workspaceDocumentPort.normalizePath(entry)
      const entryKey = entryNormalized.toLowerCase()
      if (entryKey === oldKey || entryKey.startsWith(`${oldKey}/`)) {
        return `${newNormalized}${entryNormalized.slice(oldNormalized.length)}`
      }
      return entry
    })
    allWorkspaceFiles.value = Array.from(new Set(next)).sort((left, right) => left.localeCompare(right))
  }

  /** Refreshes active-file metadata while discarding stale responses from older requests. */
  async function refreshActiveFileMetadata(
    path: string | null = workspaceShellPort.activeFilePath.value,
    options: RefreshActiveFileMetadataOptions = {}
  ) {
    const targetPath = path?.trim() || ''
    const requestToken = ++activeFileMetadataRequestToken
    if (!targetPath) {
      activeFileMetadata.value = null
      return
    }
    const spanId = startOpenTraceSpan(options.traceId ?? null, 'open.metadata', {
      parentSpanId: options.parentSpanId,
      bucket: 'metadata',
      payload: { path: targetPath }
    })
    try {
      const next = await workspaceFsPort.readFileMetadata(targetPath)
      if (requestToken === activeFileMetadataRequestToken && workspaceShellPort.activeFilePath.value === targetPath) {
        activeFileMetadata.value = next
        finishOpenTraceSpan(options.traceId ?? null, spanId, 'done')
      } else {
        traceOpenStep(options.traceId ?? null, 'metadata response ignored', {
          path: targetPath
        })
        finishOpenTraceSpan(options.traceId ?? null, spanId, 'blocked', {
          stage: 'stale_metadata_response'
        })
      }
    } catch {
      if (requestToken === activeFileMetadataRequestToken && workspaceShellPort.activeFilePath.value === targetPath) {
        activeFileMetadata.value = null
        finishOpenTraceSpan(options.traceId ?? null, spanId, 'error', {
          stage: 'read_file_metadata'
        })
      } else {
        finishOpenTraceSpan(options.traceId ?? null, spanId, 'blocked', {
          stage: 'stale_metadata_error'
        })
      }
    }
  }

  /** Ensures every parent directory of a target file exists before writing it. */
  async function ensureParentFolders(filePath: string) {
    const root = workspaceShellPort.workingFolderPath.value
    if (!root) throw new Error('Working folder is not set.')

    const relative = toRelativePath(filePath)
    const parts = relative.split('/').filter(Boolean)
    if (parts.length <= 1) return

    let current = root
    for (const segment of parts.slice(0, -1)) {
      const next = `${current}/${segment}`
      const exists = await workspaceFsPort.pathExists(next)
      if (!exists) {
        await workspaceFsPort.createEntry(current, segment, 'folder', 'fail')
      }
      current = next
    }
  }

  /** Traverses the workspace tree and caches every markdown file path for shell features. */
  async function loadAllFiles() {
    if (!workspaceShellPort.workingFolderPath.value || loadingAllFiles.value) return
    loadingAllFiles.value = true

    try {
      const files: string[] = []
      const queue: string[] = [workspaceShellPort.workingFolderPath.value]
      const queuedDirs = new Set<string>([
        workspaceDocumentPort.normalizePathKey(workspaceShellPort.workingFolderPath.value)
      ])

      while (queue.length > 0) {
        const dir = queue.shift()
        if (!dir) continue
        const children = await workspaceFsPort.listChildren(dir)
        for (const child of children) {
          if (child.is_dir) {
            const dirName = child.path.split('/').filter(Boolean).pop()?.trim() ?? ''
            if (internalDirNames.has(dirName)) {
              continue
            }
            const childKey = workspaceDocumentPort.normalizePathKey(child.path)
            if (queuedDirs.has(childKey)) {
              continue
            }
            queuedDirs.add(childKey)
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
      workspaceShellPort.errorMessage.value = err instanceof Error ? err.message : 'Could not load file list.'
    } finally {
      loadingAllFiles.value = false
    }
  }

  /** Opens or creates a daily note, then defers the actual tab navigation to the caller. */
  async function openDailyNote(date: string, openPath: (path: string) => Promise<boolean>) {
    const root = workspaceShellPort.workingFolderPath.value
    if (!root) {
      workspaceShellPort.errorMessage.value = 'Working folder is not set.'
      return false
    }
    if (!workspaceDocumentPort.isIsoDate(date)) {
      workspaceShellPort.errorMessage.value = 'Invalid date format. Use YYYY-MM-DD.'
      return false
    }

    const path = workspaceDocumentPort.dailyNotePath(root, date)
    let exists = false
    try {
      exists = await workspaceFsPort.pathExists(path)
    } catch {
      exists = false
    }

    if (!exists) {
      await ensureParentFolders(path)
      await workspaceFsPort.writeTextFile(path, '')
      upsertWorkspaceFilePath(path)
    }

    return await openPath(path)
  }

  /** Loads markdown-only wikilink targets used by wikilink resolution and completion. */
  async function loadWikilinkTargets(): Promise<string[]> {
    if (!workspaceShellPort.workingFolderPath.value) return []
    try {
      return await workspaceFsPort.listMarkdownFiles()
    } catch (err) {
      workspaceShellPort.errorMessage.value = err instanceof Error ? err.message : 'Could not load wikilink targets.'
      return []
    }
  }

  /** Reads the persisted property schema for the current workspace. */
  async function loadPropertyTypeSchema(): Promise<Record<string, string>> {
    if (!workspaceShellPort.workingFolderPath.value) return {}
    try {
      return await workspaceDocumentPort.readPropertyTypeSchema()
    } catch (err) {
      workspaceShellPort.errorMessage.value = err instanceof Error ? err.message : 'Could not load property types.'
      return {}
    }
  }

  /** Persists the property schema for the current workspace when one is open. */
  async function savePropertyTypeSchema(schema: Record<string, string>): Promise<void> {
    if (!workspaceShellPort.workingFolderPath.value) return
    await workspaceDocumentPort.writePropertyTypeSchema(schema)
  }

  /** Applies external filesystem watcher events to the cached workspace file list and related shell state. */
  function applyWorkspaceFsChanges(changes: WorkspaceFsChange[]) {
    if (!changes.length) return
    const activePath = workspaceShellPort.activeFilePath.value
    const activePathKey = activePath ? workspaceDocumentPort.normalizePathKey(activePath) : ''
    let shouldRefreshActiveMetadata = false
    let shouldRefreshCosmos = false

    for (const change of changes) {
      if (change.kind === 'removed' && change.path) {
        removeWorkspaceFilePath(change.path)
        if (workspaceDocumentPort.isMarkdownPath(change.path)) {
          shouldRefreshCosmos = true
          workspaceEffectsPort?.removeMarkdownFromIndexInBackground?.(change.path)
        }
        if (activePathKey && workspaceDocumentPort.normalizePathKey(change.path) === activePathKey) {
          activeFileMetadata.value = null
        }
        continue
      }

      if (change.kind === 'renamed') {
        if (change.old_path && change.new_path) {
          replaceWorkspaceFilePath(change.old_path, change.new_path)
          if (workspaceDocumentPort.isMarkdownPath(change.old_path) || workspaceDocumentPort.isMarkdownPath(change.new_path)) {
            shouldRefreshCosmos = true
            if (workspaceDocumentPort.isMarkdownPath(change.old_path)) {
              workspaceEffectsPort?.removeMarkdownFromIndexInBackground?.(change.old_path)
            }
            if (workspaceDocumentPort.isMarkdownPath(change.new_path)) {
              workspaceEffectsPort?.enqueueMarkdownReindex?.(change.new_path)
            }
          }
        } else if (change.old_path) {
          removeWorkspaceFilePath(change.old_path)
          if (workspaceDocumentPort.isMarkdownPath(change.old_path)) {
            shouldRefreshCosmos = true
            workspaceEffectsPort?.removeMarkdownFromIndexInBackground?.(change.old_path)
          }
        } else if (!change.is_dir && change.new_path) {
          upsertWorkspaceFilePath(change.new_path)
          if (workspaceDocumentPort.isMarkdownPath(change.new_path)) {
            shouldRefreshCosmos = true
            workspaceEffectsPort?.enqueueMarkdownReindex?.(change.new_path)
          }
        }

        if (
          activePathKey &&
          ((change.old_path && workspaceDocumentPort.normalizePathKey(change.old_path) === activePathKey) ||
            (change.new_path && workspaceDocumentPort.normalizePathKey(change.new_path) === activePathKey))
        ) {
          shouldRefreshActiveMetadata = true
        }
        continue
      }

      if ((change.kind === 'created' || change.kind === 'modified') && !change.is_dir && change.path) {
        upsertWorkspaceFilePath(change.path)
        if (workspaceDocumentPort.isMarkdownPath(change.path)) {
          shouldRefreshCosmos = true
          workspaceEffectsPort?.enqueueMarkdownReindex?.(change.path)
        }
        if (activePathKey && workspaceDocumentPort.normalizePathKey(change.path) === activePathKey) {
          shouldRefreshActiveMetadata = true
        }
      }
    }

    if (shouldRefreshActiveMetadata && activePath) {
      void refreshActiveFileMetadata(activePath)
    }
    if (shouldRefreshCosmos && workspaceEffectsPort?.hasCosmosSurface?.()) {
      void workspaceEffectsPort.refreshCosmosGraph?.()
    }
  }

  /** Closes the current workspace and clears persisted shell state tied to it. */
  async function closeWorkspace() {
    if (!workspaceShellPort.hasWorkspace.value) return
    workspaceShellPort.resetIndexingState()
    resetWorkspaceState()
    workspaceShellPort.selectedCount.value = 0
    workspaceShellPort.clearWorkspacePath()
    try {
      await workspaceFsPort.clearWorkingFolder()
    } catch (err) {
      workspaceShellPort.errorMessage.value = err instanceof Error ? err.message : 'Could not close workspace.'
    }
    window.localStorage.removeItem(workspaceShellPort.storageKey)
    workspaceShellPort.indexingState.value = 'indexed'
  }

  /** Opens a workspace, initializes persisted services, and resets workspace-scoped shell caches. */
  async function loadWorkingFolder(path: string): Promise<string | null> {
    try {
      workspaceShellPort.resetIndexingState()
      const canonical = await workspaceFsPort.setWorkingFolder(path)
      workspaceShellPort.setWorkspacePath(canonical)
      workspaceShellPort.indexingState.value = 'indexing'
      await workspaceFsPort.initDb()
      resetWorkspaceState()
      window.localStorage.setItem(workspaceShellPort.storageKey, canonical)
      return canonical
    } catch (err) {
      workspaceShellPort.clearWorkspacePath()
      resetWorkspaceState()
      window.localStorage.removeItem(workspaceShellPort.storageKey)
      workspaceShellPort.errorMessage.value = err instanceof Error ? err.message : 'Could not open working folder.'
      return null
    } finally {
      if (workspaceShellPort.hasWorkspace.value) {
        workspaceShellPort.indexingState.value = 'indexed'
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
