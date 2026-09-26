import type { Ref } from 'vue'
/**
 * Module: useAppShellConstitutedContextActions
 *
 * Purpose:
 * - Own the shell actions that operate on constituted context.
 *
 * Boundary:
 * - Keeps context mutations out of `App.vue`.
 * - Does not own context storage itself; it only orchestrates existing APIs.
 */
export type ConstitutedContextLike = {
  anchorPath: Ref<string>
  paths: Ref<string[]>
  contains: (path: string) => boolean
  add: (path: string, anchorPath: string, makeItem: (path: string) => { path: string; title: string }) => void
  remove: (path: string) => void
  removeLocal: (path: string) => void
  removePinned: (path: string) => void
}

export type ContextActionFilesystemPort = {
  hasWorkspace: Ref<boolean>
  workingFolderPath: Ref<string>
  errorMessage: Ref<string>
  notifyError: (message: string) => void
}

export type UseAppShellConstitutedContextActionsOptions = {
  activeFilePath: Ref<string>
  constitutedContext: ConstitutedContextLike
  filesystem: ContextActionFilesystemPort
  contextActionLoading: Ref<boolean>
  noteTitleFromPath: (path: string) => string
}

export function useAppShellConstitutedContextActions(options: UseAppShellConstitutedContextActionsOptions) {
  function addPathToConstitutedContext(path: string) {
    const anchorPath = options.activeFilePath.value.trim() || options.constitutedContext.anchorPath.value.trim() || path.trim()
    if (!anchorPath || !path.trim()) return
    options.constitutedContext.add(path, anchorPath, (itemPath) => ({
      path: itemPath,
      title: options.noteTitleFromPath(itemPath)
    }))
  }

  function removePathFromConstitutedContext(path: string) {
    options.constitutedContext.remove(path)
  }

  function removeLocalPathFromConstitutedContext(path: string) {
    options.constitutedContext.removeLocal(path)
  }

  function removePinnedPathFromConstitutedContext(path: string) {
    options.constitutedContext.removePinned(path)
  }

  function toggleActiveNoteInConstitutedContext() {
    const path = options.activeFilePath.value.trim()
    if (!path) return
    if (options.constitutedContext.contains(path)) {
      options.constitutedContext.remove(path)
      return
    }
    addPathToConstitutedContext(path)
  }

  return {
    addPathToConstitutedContext,
    removePathFromConstitutedContext,
    removeLocalPathFromConstitutedContext,
    removePinnedPathFromConstitutedContext,
    toggleActiveNoteInConstitutedContext,
  }
}
