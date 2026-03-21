import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellWorkspaceSetup } from './useAppShellWorkspaceSetup'

function createSetup(overrides?: Partial<{
  hasWorkspace: boolean
  selectWorkingFolder: () => Promise<string | null>
}>) {
  const busy = ref(false)
  const statePort = {
    workingFolderPath: ref('/vault'),
    hasWorkspace: ref(overrides?.hasWorkspace ?? true),
    busy
  }
  const workspacePort = {
    selectWorkingFolder: overrides?.selectWorkingFolder ?? vi.fn(async () => '/vault'),
    loadWorkingFolder: vi.fn(async (path: string) => path),
    loadAllFiles: vi.fn(async () => {}),
    invalidateRecentNotes: vi.fn()
  }
  const fsPort = {
    pathExists: vi.fn(async () => false),
    createEntry: vi.fn(async (parentPath: string, name: string) => `${parentPath}/${name}`),
    ensureParentFolders: vi.fn(async () => {}),
    enqueueMarkdownReindex: vi.fn()
  }
  const uiPort = {
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    closeWorkspaceSetupWizard: vi.fn(),
    upsertWorkspaceFilePath: vi.fn()
  }
  const pathPort = {
    sanitizeRelativePath: (value: string) => value.trim().replace(/\\/g, '/')
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellWorkspaceSetup({
    statePort,
    workspacePort,
    fsPort,
    uiPort,
    pathPort
  }))
  if (!api) throw new Error('Expected setup controller')

  return { api, scope, statePort, workspacePort, fsPort, uiPort }
}

describe('useAppShellWorkspaceSetup', () => {
  it('creates the starter structure and resets the wizard on success', async () => {
    const { api, scope, workspacePort, fsPort, uiPort, statePort } = createSetup()

    await api.applyWorkspaceSetupWizard({
      useCase: 'projects',
      options: ['references-folder']
    })

    expect(workspacePort.loadAllFiles).toHaveBeenCalled()
    expect(workspacePort.invalidateRecentNotes).toHaveBeenCalled()
    expect(fsPort.createEntry).toHaveBeenCalledWith('/vault', 'References', 'folder', 'fail')
    expect(fsPort.createEntry).toHaveBeenCalledWith('/vault', 'Sources', 'folder', 'fail')
    expect(fsPort.createEntry).toHaveBeenCalledWith('/vault', 'Project template.md', 'file', 'fail')
    expect(fsPort.enqueueMarkdownReindex).toHaveBeenCalledWith('/vault/Project template.md')
    expect(uiPort.upsertWorkspaceFilePath).toHaveBeenCalledWith('/vault/Project template.md')
    expect(uiPort.notifySuccess).toHaveBeenCalledWith('Workspace starter structure created.')
    expect(uiPort.closeWorkspaceSetupWizard).toHaveBeenCalled()
    expect(statePort.busy.value).toBe(false)
    scope.stop()
  })

  it('asks for a workspace and stops when the picker is cancelled', async () => {
    const { api, scope, workspacePort, uiPort, statePort } = createSetup({
      hasWorkspace: false,
      selectWorkingFolder: vi.fn(async () => null)
    })

    await api.applyWorkspaceSetupWizard({
      useCase: 'journal',
      options: ['daily-notes']
    })

    expect(workspacePort.selectWorkingFolder).toHaveBeenCalled()
    expect(workspacePort.loadWorkingFolder).not.toHaveBeenCalled()
    expect(uiPort.closeWorkspaceSetupWizard).not.toHaveBeenCalled()
    expect(statePort.busy.value).toBe(false)
    scope.stop()
  })
})
