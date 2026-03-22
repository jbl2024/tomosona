import type { Ref } from 'vue'
/**
 * Module: useAppShellConstitutedContextActions
 *
 * Purpose:
 * - Own the shell actions that operate on constituted context and route that
 *   context into Second Brain or Cosmos.
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
  setSecondBrainAlterId: (alterId: string, options?: { bumpNonce?: boolean }) => void
  openSecondBrainViewFromPalette: () => Promise<boolean>
}

export type ContextActionCosmosPort = {
  graph: Ref<{ nodes: Array<{ id: string; path: string }> }>
  error: Ref<string>
  refreshGraph: () => Promise<void>
  selectNode: (nodeId: string) => void
  openCosmosViewFromPalette: () => Promise<boolean>
  recordCosmosHistorySnapshot: () => void
}

export type UseAppShellConstitutedContextActionsOptions = {
  activeFilePath: Ref<string>
  constitutedContext: ConstitutedContextLike
  filesystem: ContextActionFilesystemPort
  contextActionLoading: Ref<boolean>
  noteTitleFromPath: (path: string) => string
  normalizeContextPathsForUpdate: (workspacePath: string, paths: string[]) => string[]
  secondBrain: ContextActionSecondBrainPort
  cosmos: ContextActionCosmosPort
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

  async function openConstitutedContextInCosmos() {
    if (!options.constitutedContext.paths.value.length) return false
    const opened = await options.cosmos.openCosmosViewFromPalette()
    if (!opened) return false

    const targetPath = options.constitutedContext.paths.value[0]
    const targetKey = targetPath.trim().toLowerCase()
    let match = options.cosmos.graph.value.nodes.find((node) =>
      node.path.trim().toLowerCase() === targetKey || node.id.trim().toLowerCase() === targetKey
    )
    if (!match) {
      await options.cosmos.refreshGraph()
      match = options.cosmos.graph.value.nodes.find((node) =>
        node.path.trim().toLowerCase() === targetKey || node.id.trim().toLowerCase() === targetKey
      )
    }
    if (!match) {
      if (options.cosmos.error.value) {
        options.filesystem.notifyError(options.cosmos.error.value)
        return false
      }
      options.filesystem.notifyError('Context anchor is not available in the current graph index.')
      return true
    }

    options.cosmos.selectNode(match.id)
    options.cosmos.recordCosmosHistorySnapshot()
    return true
  }

  async function openConstitutedContextInPulse() {
    if (!options.constitutedContext.paths.value.length) return false
    return await openConstitutedContextInSecondBrain(
      'Transform the current constituted context into a useful written output. Use Pulse from the Second Brain context surface.'
    )
  }

  async function openPulseContextInSecondBrain(payload: { contextPaths: string[]; prompt?: string }) {
    if (!options.filesystem.hasWorkspace.value) {
      options.filesystem.errorMessage.value = 'Open a workspace first.'
      return false
    }

    const normalized = options.normalizeContextPathsForUpdate(options.filesystem.workingFolderPath.value, payload.contextPaths)
    const seedPath = normalized[0] || options.activeFilePath.value
    if (!seedPath) {
      options.filesystem.errorMessage.value = 'No note context available for Second Brain.'
      return false
    }

    try {
      const sessionId = await options.secondBrain.resolveSecondBrainSessionForPath(seedPath)
      await options.secondBrain.replaceSessionContext(sessionId, normalized)
      options.secondBrain.setSecondBrainSessionId(sessionId, { bumpNonce: true })
      options.secondBrain.setSecondBrainPrompt(payload.prompt?.trim() ?? '', { bumpNonce: true })
      await options.secondBrain.openSecondBrainViewFromPalette()
      return true
    } catch (err) {
      options.filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not open Second Brain with Pulse context.'
      return false
    }
  }

  async function openAlterInSecondBrain(alterId: string) {
    if (!options.filesystem.hasWorkspace.value) {
      options.filesystem.errorMessage.value = 'Open a workspace first.'
      return false
    }
    options.secondBrain.setSecondBrainAlterId(alterId, { bumpNonce: true })
    await options.secondBrain.openSecondBrainViewFromPalette()
    return true
  }

  return {
    addPathToConstitutedContext,
    removePathFromConstitutedContext,
    removeLocalPathFromConstitutedContext,
    removePinnedPathFromConstitutedContext,
    toggleActiveNoteInConstitutedContext,
    openConstitutedContextInSecondBrain,
    openConstitutedContextInCosmos,
    openConstitutedContextInPulse,
    openPulseContextInSecondBrain,
    openAlterInSecondBrain
  }
}
