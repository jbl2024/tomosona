import type { Ref } from 'vue'
/**
 * Module: useAppShellConstitutedContextActions
 *
 * Purpose:
 * - Own the shell actions that operate on constituted context and route that
 *   context into Second Brain.
 *
 * Boundary:
 * - Keeps context-to-workflow glue out of `App.vue`.
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

export type ContextActionSecondBrainPort = {
  resolveSecondBrainSessionForPath: (path: string) => Promise<string>
  replaceSessionContext: (sessionId: string, paths: string[]) => Promise<unknown>
  setSecondBrainSessionId: (sessionId: string, options?: { bumpNonce?: boolean }) => void
  setSecondBrainPrompt: (prompt: string, options?: { bumpNonce?: boolean }) => void
  openSecondBrainViewFromPalette: () => Promise<boolean>
}

export type UseAppShellConstitutedContextActionsOptions = {
  activeFilePath: Ref<string>
  constitutedContext: ConstitutedContextLike
  filesystem: ContextActionFilesystemPort
  contextActionLoading: Ref<boolean>
  noteTitleFromPath: (path: string) => string
  normalizeContextPathsForUpdate: (workspacePath: string, paths: string[]) => string[]
  secondBrain: ContextActionSecondBrainPort
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

  async function openConstitutedContextInSecondBrain(prompt?: string) {
    if (!options.filesystem.hasWorkspace.value) {
      options.filesystem.errorMessage.value = 'Open a workspace first.'
      return false
    }

    const normalized = options.normalizeContextPathsForUpdate(
      options.filesystem.workingFolderPath.value,
      options.constitutedContext.paths.value
    )
    const seedPath = normalized[0] || options.activeFilePath.value
    if (!seedPath) {
      options.filesystem.errorMessage.value = 'No note context available for Second Brain.'
      return false
    }

    options.contextActionLoading.value = true
    try {
      const sessionId = await options.secondBrain.resolveSecondBrainSessionForPath(seedPath)
      await options.secondBrain.replaceSessionContext(sessionId, normalized)
      options.secondBrain.setSecondBrainSessionId(sessionId, { bumpNonce: true })
      options.secondBrain.setSecondBrainPrompt(prompt?.trim() ?? '', { bumpNonce: true })
      await options.secondBrain.openSecondBrainViewFromPalette()
      return true
    } catch (err) {
      options.filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not open Second Brain with this context.'
      return false
    } finally {
      options.contextActionLoading.value = false
    }
  }

  return {
    addPathToConstitutedContext,
    removePathFromConstitutedContext,
    removeLocalPathFromConstitutedContext,
    removePinnedPathFromConstitutedContext,
    toggleActiveNoteInConstitutedContext,
    openConstitutedContextInSecondBrain,
  }
}
