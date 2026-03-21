import type { Ref } from 'vue'
import { buildWorkspaceSetupPlan, type WorkspaceSetupOption, type WorkspaceSetupUseCase } from '../lib/workspaceSetupWizard'

/** Groups shell state used by the workspace setup wizard workflow. */
export type AppShellWorkspaceSetupStatePort = {
  workingFolderPath: Readonly<Ref<string>>
  hasWorkspace: Readonly<Ref<boolean>>
  busy: Ref<boolean>
}

/** Groups workspace loading and persistence actions used by the wizard. */
export type AppShellWorkspaceSetupWorkspacePort = {
  selectWorkingFolder: () => Promise<string | null>
  loadWorkingFolder: (path: string) => Promise<string | null>
  loadAllFiles: () => Promise<void>
  invalidateRecentNotes: () => void
}

/** Groups filesystem primitives used by the wizard. */
export type AppShellWorkspaceSetupFsPort = {
  pathExists: (path: string) => Promise<boolean>
  createEntry: (parentPath: string, name: string, kind: 'file' | 'folder', conflict: 'fail' | 'rename') => Promise<string>
  ensureParentFolders: (path: string) => Promise<void>
  enqueueMarkdownReindex: (path: string) => void
}

/** Groups shell UI actions used by the wizard. */
export type AppShellWorkspaceSetupUiPort = {
  notifySuccess: (message: string) => void
  notifyError: (message: string) => void
  closeWorkspaceSetupWizard: () => void
  upsertWorkspaceFilePath: (path: string) => void
}

/** Groups path helpers used by the wizard. */
export type AppShellWorkspaceSetupPathPort = {
  sanitizeRelativePath: (value: string) => string
}

/** Declares the dependencies required by the workspace setup wizard workflow. */
export type UseAppShellWorkspaceSetupOptions = {
  statePort: AppShellWorkspaceSetupStatePort
  workspacePort: AppShellWorkspaceSetupWorkspacePort
  fsPort: AppShellWorkspaceSetupFsPort
  uiPort: AppShellWorkspaceSetupUiPort
  pathPort: AppShellWorkspaceSetupPathPort
}

/**
 * Owns the shell workflow that creates a workspace starter structure from the setup wizard.
 *
 * Boundary:
 * - Handles the multi-step setup result and filesystem mutations.
 * - Relies on injected workspace/fs ports so App.vue stays an orchestrator.
 */
export function useAppShellWorkspaceSetup(options: UseAppShellWorkspaceSetupOptions) {
  async function ensureRelativeFolder(relativePath: string) {
    const root = options.statePort.workingFolderPath.value
    if (!root) throw new Error('Working folder is not set.')
    const normalized = options.pathPort.sanitizeRelativePath(relativePath)
    if (!normalized) return
    const parentPath = await ensureParentDirectoriesForRelativePath(normalized)
    const targetPath = `${parentPath}/${normalized.split('/').filter(Boolean).pop() ?? ''}`
    if (await options.fsPort.pathExists(targetPath)) return
    await options.fsPort.createEntry(parentPath, normalized.split('/').filter(Boolean).pop() ?? normalized, 'folder', 'fail')
  }

  async function ensureParentDirectoriesForRelativePath(relativePath: string): Promise<string> {
    const root = options.statePort.workingFolderPath.value
    if (!root) {
      throw new Error('Working folder is not set.')
    }

    const parts = relativePath.split('/').filter(Boolean)
    if (parts.length <= 1) return root

    let current = root
    for (const segment of parts.slice(0, -1)) {
      const next = `${current}/${segment}`
      const exists = await options.fsPort.pathExists(next)
      if (!exists) {
        await options.fsPort.createEntry(current, segment, 'folder', 'fail')
      }
      current = next
    }

    return current
  }

  async function applyWorkspaceSetupWizard(payload: {
    useCase: WorkspaceSetupUseCase
    options: WorkspaceSetupOption[]
  }) {
    options.statePort.busy.value = true
    try {
      if (!options.statePort.hasWorkspace.value) {
        const selectedPath = await options.workspacePort.selectWorkingFolder()
        if (!selectedPath) {
          options.statePort.busy.value = false
          return
        }
        await options.workspacePort.loadWorkingFolder(selectedPath)
        if (!options.statePort.hasWorkspace.value) {
          options.statePort.busy.value = false
          return
        }
      }

      const plan = buildWorkspaceSetupPlan(payload.useCase, payload.options)
      for (const entry of plan) {
        if (entry.kind === 'folder') {
          await ensureRelativeFolder(entry.path)
          continue
        }
        const root = options.statePort.workingFolderPath.value
        if (!root) throw new Error('Working folder is not set.')
        const fullPath = `${root}/${entry.path}`
        if (await options.fsPort.pathExists(fullPath)) continue
        await options.fsPort.ensureParentFolders(fullPath)
        const parts = entry.path.split('/').filter(Boolean)
        const name = parts.pop() ?? entry.path
        const parentPath = parts.length ? `${root}/${parts.join('/')}` : root
        await options.fsPort.createEntry(parentPath, name, 'file', 'fail')
        options.fsPort.enqueueMarkdownReindex(fullPath)
        options.uiPort.upsertWorkspaceFilePath(fullPath)
      }

      await options.workspacePort.loadAllFiles()
      options.workspacePort.invalidateRecentNotes()
      options.uiPort.notifySuccess('Workspace starter structure created.')
      options.uiPort.closeWorkspaceSetupWizard()
    } catch (err) {
      options.uiPort.notifyError(err instanceof Error ? err.message : 'Could not create starter structure.')
    } finally {
      options.statePort.busy.value = false
    }
  }

  return {
    applyWorkspaceSetupWizard
  }
}
