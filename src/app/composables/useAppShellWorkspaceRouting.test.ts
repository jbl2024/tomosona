import { describe, expect, it, vi } from 'vitest'
import { useAppShellWorkspaceRouting } from './useAppShellWorkspaceRouting'

describe('useAppShellWorkspaceRouting', () => {
  it('routes workspace picker and recent-workspace entrypoints to the owning lifecycle port', async () => {
    const openWorkspacePicker = vi.fn(async () => true)
    const openRecentWorkspace = vi.fn(async (_path: string) => {})
    const api = useAppShellWorkspaceRouting({
      lifecyclePort: {
        openWorkspacePicker,
        openRecentWorkspace
      },
      modalPort: {
        openWorkspaceSetupWizard: vi.fn(async () => {}),
        closeWorkspaceSetupWizard: vi.fn()
      },
      setupPort: {
        applyWorkspaceSetupWizard: vi.fn(async () => {})
      }
    })

    expect(await api.openWorkspacePicker()).toBe(true)
    await api.openRecentWorkspace('/vault/notes')

    expect(openWorkspacePicker).toHaveBeenCalledTimes(1)
    expect(openRecentWorkspace).toHaveBeenCalledWith('/vault/notes')
  })

  it('routes workspace setup wizard entrypoints to the modal and setup owners', async () => {
    const openWorkspaceSetupWizard = vi.fn(async () => {})
    const closeWorkspaceSetupWizard = vi.fn()
    const applyWorkspaceSetupWizard = vi.fn(async () => {})
    const api = useAppShellWorkspaceRouting({
      lifecyclePort: {
        openWorkspacePicker: vi.fn(async () => false),
        openRecentWorkspace: vi.fn(async () => {})
      },
      modalPort: {
        openWorkspaceSetupWizard,
        closeWorkspaceSetupWizard
      },
      setupPort: {
        applyWorkspaceSetupWizard
      }
    })

    await api.openWorkspaceSetupWizard()
    api.closeWorkspaceSetupWizard()
    await api.applyWorkspaceSetupWizard({ useCase: 'journal', options: [] })

    expect(openWorkspaceSetupWizard).toHaveBeenCalledTimes(1)
    expect(closeWorkspaceSetupWizard).toHaveBeenCalledTimes(1)
    expect(applyWorkspaceSetupWizard).toHaveBeenCalledWith({ useCase: 'journal', options: [] })
  })
})
