import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { RecentWorkspaceItem } from '../lib/recentWorkspaces'
import type { LaunchpadRecentNote, LaunchpadRecentWorkspace } from '../lib/appShellViewModels'

type RecentNoteStorageEntry = {
  path: string
  title: string
  lastViewedAtMs: number
}

/** Declares the dependencies required by the shell launchpad controller. */
export type UseAppShellLaunchpadOptions = {
  storageKey: string
  workingFolderPath: Readonly<Ref<string>>
  hasWorkspace: Readonly<Ref<boolean>>
  allWorkspaceFiles: Readonly<Ref<string[]>>
  loadingAllFiles: Readonly<Ref<boolean>>
  readFileMetadata: (path: string) => Promise<{ updated_at_ms: number | null }>
  readRecentWorkspaces: (storageKey: string) => RecentWorkspaceItem[]
  upsertRecentWorkspace: (storageKey: string, item: RecentWorkspaceItem) => RecentWorkspaceItem[]
  removeRecentWorkspace: (storageKey: string, path: string) => RecentWorkspaceItem[]
  readRecentNotes: (storageKey: string) => RecentNoteStorageEntry[]
  writeRecentNotes: (storageKey: string, entries: RecentNoteStorageEntry[]) => void
  upsertRecentNote: (storageKey: string, entry: RecentNoteStorageEntry) => void
  removeRecentNote: (storageKey: string, path: string) => void
  renameRecentNote: (storageKey: string, fromPath: string, toPath: string, title: string) => void
  normalizePathKey: (path: string) => string
  toRelativePath: (path: string) => string
  noteTitleFromPath: (path: string) => string
  basenameLabel: (path: string) => string
  formatRelativeTime: (tsMs: number | null, prefix?: string) => string
}

/**
 * Owns launchpad recents, workspace-local note recents, and the derived rows
 * shown by the Home surface.
 */
export function useAppShellLaunchpad(options: UseAppShellLaunchpadOptions) {
  const recentWorkspaces = ref<RecentWorkspaceItem[]>(typeof window === 'undefined'
    ? []
    : options.readRecentWorkspaces(options.storageKey))
  const recentViewedNotes = ref<LaunchpadRecentNote[]>([])
  const recentUpdatedNotes = ref<LaunchpadRecentNote[]>([])
  const recentNotesRefreshNonce = ref(0)

  let recentUpdatedNotesRequestToken = 0
  let recentUpdatedNotesCacheKey = ''

  function recentNotesStorageKey(workspaceRoot: string): string {
    return `tomosona:recent-notes:${encodeURIComponent(options.normalizePathKey(workspaceRoot))}`
  }

  function activeRecentNotesStorageKey(): string {
    const root = options.workingFolderPath.value
    return root ? recentNotesStorageKey(root) : ''
  }

  const launchpadRecentWorkspaces = computed<LaunchpadRecentWorkspace[]>(() =>
    recentWorkspaces.value.map((workspace) => ({
      path: workspace.path,
      label: workspace.label,
      subtitle: workspace.path,
      recencyLabel: options.formatRelativeTime(workspace.lastOpenedAtMs, 'opened')
    }))
  )

  const launchpadShowWizardAction = computed(() =>
    !options.hasWorkspace.value || options.allWorkspaceFiles.value.length === 0
  )

  function resetWorkspaceRecentState() {
    recentViewedNotes.value = []
    recentUpdatedNotes.value = []
    recentUpdatedNotesCacheKey = ''
  }

  function recordRecentWorkspace(path: string) {
    recentWorkspaces.value = options.upsertRecentWorkspace(options.storageKey, {
      path,
      label: options.basenameLabel(path),
      lastOpenedAtMs: Date.now()
    })
  }

  function removeRecentWorkspaceEntry(path: string) {
    recentWorkspaces.value = options.removeRecentWorkspace(options.storageKey, path)
  }

  function syncLaunchpadViewedNotes() {
    const storageKey = activeRecentNotesStorageKey()
    if (!storageKey) {
      recentViewedNotes.value = []
      return
    }

    const entries = options.readRecentNotes(storageKey)
    const canCleanMissingPaths = !options.loadingAllFiles.value && options.allWorkspaceFiles.value.length > 0
    const knownPaths = new Set(options.allWorkspaceFiles.value.map((path) => options.normalizePathKey(path)))
    const valid = canCleanMissingPaths
      ? entries.filter((entry) => knownPaths.has(options.normalizePathKey(entry.path)))
      : entries

    if (canCleanMissingPaths && valid.length !== entries.length) {
      options.writeRecentNotes(storageKey, valid)
    }

    recentViewedNotes.value = valid.map((item) => ({
      path: item.path,
      title: item.title,
      relativePath: options.toRelativePath(item.path),
      recencyLabel: options.formatRelativeTime(item.lastViewedAtMs, 'opened')
    }))
  }

  function recordRecentNote(path: string) {
    const storageKey = activeRecentNotesStorageKey()
    if (!storageKey) return
    options.upsertRecentNote(storageKey, {
      path,
      title: options.noteTitleFromPath(path),
      lastViewedAtMs: Date.now()
    })
    syncLaunchpadViewedNotes()
  }

  function removeLaunchpadRecentNote(path: string) {
    const storageKey = activeRecentNotesStorageKey()
    if (!storageKey) return
    options.removeRecentNote(storageKey, path)
    syncLaunchpadViewedNotes()
  }

  function renameLaunchpadRecentNote(fromPath: string, toPath: string) {
    const storageKey = activeRecentNotesStorageKey()
    if (!storageKey) return
    options.renameRecentNote(storageKey, fromPath, toPath, options.noteTitleFromPath(toPath))
    syncLaunchpadViewedNotes()
  }

  function invalidateRecentNotes() {
    recentUpdatedNotesCacheKey = ''
    recentNotesRefreshNonce.value += 1
  }

  async function refreshLaunchpadUpdatedNotes() {
    const root = options.workingFolderPath.value
    if (!root) {
      recentUpdatedNotes.value = []
      recentUpdatedNotesCacheKey = ''
      return
    }

    const fileSignature = options.allWorkspaceFiles.value.join('\n')
    const cacheKey = `${options.normalizePathKey(root)}::${recentNotesRefreshNonce.value}::${fileSignature}`
    if (cacheKey === recentUpdatedNotesCacheKey) return

    const requestToken = ++recentUpdatedNotesRequestToken
    const rows = await Promise.all(
      options.allWorkspaceFiles.value.map(async (path) => {
        try {
          const metadata = await options.readFileMetadata(path)
          return {
            path,
            title: options.noteTitleFromPath(path),
            relativePath: options.toRelativePath(path),
            updatedAtMs: metadata.updated_at_ms ?? 0
          }
        } catch {
          return null
        }
      })
    )
    if (requestToken !== recentUpdatedNotesRequestToken) return

    recentUpdatedNotes.value = rows
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.relativePath.localeCompare(right.relativePath))
      .slice(0, 7)
      .map((item) => ({
        path: item.path,
        title: item.title,
        relativePath: item.relativePath,
        recencyLabel: options.formatRelativeTime(item.updatedAtMs, 'updated')
      }))
    recentUpdatedNotesCacheKey = cacheKey
  }

  async function refreshLaunchpadRecentNotes() {
    syncLaunchpadViewedNotes()
    await refreshLaunchpadUpdatedNotes()
  }

  function dispose() {
    recentUpdatedNotesRequestToken += 1
  }

  watch(
    [
      () => options.workingFolderPath.value,
      () => options.allWorkspaceFiles.value,
      () => recentNotesRefreshNonce.value
    ],
    () => {
      void refreshLaunchpadRecentNotes()
    },
    { deep: true, immediate: true }
  )

  onScopeDispose(dispose)

  return {
    recentWorkspaces,
    recentViewedNotes,
    recentUpdatedNotes,
    launchpadRecentWorkspaces,
    launchpadShowWizardAction,
    resetWorkspaceRecentState,
    recordRecentWorkspace,
    removeRecentWorkspaceEntry,
    recordRecentNote,
    removeLaunchpadRecentNote,
    renameLaunchpadRecentNote,
    invalidateRecentNotes,
    refreshLaunchpadRecentNotes,
    dispose
  }
}
