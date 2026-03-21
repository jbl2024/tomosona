import type { Ref } from 'vue'
import type { WorkspaceFsChange } from '../../shared/api/apiTypes'
import { listenWorkspaceFsChanged } from '../../shared/api/workspaceApi'

/** Groups shell state consumed by workspace filesystem watcher orchestration. */
export type AppShellWorkspaceFsSyncShellPort = {
  workingFolderPath: Readonly<Ref<string>>
  normalizePath: (path: string) => string
  notifyError: (message: string) => void
}

/** Groups workspace-controller hooks that respond to filesystem events. */
export type AppShellWorkspaceFsSyncControllerPort = {
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => void
  relayEditorFsChanges: (changes: WorkspaceFsChange[]) => Promise<void>
}

/** Groups favorites-domain hooks that respond to filesystem events. */
export type AppShellWorkspaceFsSyncFavoritesPort = {
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => void
  renameFavorite: (fromPath: string, toPath: string) => Promise<void>
}

/** Groups shell UI state that follows workspace filesystem changes. */
export type AppShellWorkspaceFsSyncUiPort = {
  invalidateRecentNotes: () => void
  removeLaunchpadRecentNote: (path: string) => void
  renameLaunchpadRecentNote: (fromPath: string, toPath: string) => void
}

/** Declares the dependencies required by the shell workspace filesystem sync helper. */
export type UseAppShellWorkspaceFsSyncOptions = {
  shellPort: AppShellWorkspaceFsSyncShellPort
  controllerPort: AppShellWorkspaceFsSyncControllerPort
  favoritesPort: AppShellWorkspaceFsSyncFavoritesPort
  uiPort: AppShellWorkspaceFsSyncUiPort
}

/**
 * Owns the workspace filesystem watcher subscription and event fan-out.
 *
 * Boundary:
 * - Subscribes to the shared workspace watcher once.
 * - Filters events to the active workspace root.
 * - Fan-outs change effects to shell-owned ports.
 */
export function useAppShellWorkspaceFsSync(options: UseAppShellWorkspaceFsSyncOptions) {
  let unlistenWorkspaceFsChanged: (() => void) | null = null
  let started = false

  function rootMatches(payloadRoot: string) {
    const activeRoot = options.shellPort.workingFolderPath.value
    if (!activeRoot) return false
    return options.shellPort.normalizePath(payloadRoot).toLowerCase() === options.shellPort.normalizePath(activeRoot).toLowerCase()
  }

  function syncFavoritesForWorkspaceChanges(changes: WorkspaceFsChange[]) {
    for (const change of changes) {
      if (change.kind !== 'renamed' || !change.old_path || !change.new_path) continue
      void options.favoritesPort.renameFavorite(change.old_path, change.new_path).catch((err) => {
        options.shellPort.notifyError(err instanceof Error ? err.message : 'Could not update favorite.')
      })
    }
  }

  function syncViewedNotesForWorkspaceChanges(changes: WorkspaceFsChange[]) {
    for (const change of changes) {
      if (change.kind === 'removed' && change.path) {
        options.uiPort.removeLaunchpadRecentNote(change.path)
        continue
      }
      if (change.kind === 'renamed' && change.old_path && change.new_path) {
        options.uiPort.renameLaunchpadRecentNote(change.old_path, change.new_path)
      }
    }
  }

  function handleWorkspaceFsChanges(payload: { root: string; changes: WorkspaceFsChange[] }) {
    if (!rootMatches(payload.root)) return
    options.controllerPort.applyWorkspaceFsChanges(payload.changes)
    void options.controllerPort.relayEditorFsChanges(payload.changes)
    options.favoritesPort.applyWorkspaceFsChanges(payload.changes)
    syncFavoritesForWorkspaceChanges(payload.changes)
    syncViewedNotesForWorkspaceChanges(payload.changes)
    if (payload.changes.some((change) =>
      change.kind === 'modified' || change.kind === 'created' || change.kind === 'removed' || change.kind === 'renamed'
    )) {
      options.uiPort.invalidateRecentNotes()
    }
  }

  async function start() {
    if (started) return
    started = true
    try {
      unlistenWorkspaceFsChanged = await listenWorkspaceFsChanged(handleWorkspaceFsChanges)
    } catch {
      unlistenWorkspaceFsChanged = null
    }
  }

  function dispose() {
    started = false
    if (unlistenWorkspaceFsChanged) {
      unlistenWorkspaceFsChanged()
      unlistenWorkspaceFsChanged = null
    }
  }

  return {
    start,
    dispose
  }
}
