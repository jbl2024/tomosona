import type { WorkspaceSetupOption, WorkspaceSetupUseCase } from '../lib/workspaceSetupWizard'

/**
 * Module: useAppShellWorkspaceRouting
 *
 * Purpose:
 * - Own the shell-root routing for workspace entrypoints.
 *
 * Boundary:
 * - Keeps `App.vue` from rebuilding workspace picker, recent-workspace, and
 *   setup-wizard call-throughs inline.
 * - Delegates the actual lifecycle, modal, and setup behavior to the owning
 *   composables.
 */

/** Groups the workspace setup payload forwarded through the routing bridge. */
export type AppShellWorkspaceRoutingSetupPayload = {
  useCase: WorkspaceSetupUseCase
  options: WorkspaceSetupOption[]
}

/** Groups the lifecycle entrypoints that the workspace routing bridge forwards. */
export type AppShellWorkspaceRoutingLifecyclePort = {
  openWorkspacePicker: () => Promise<boolean>
  openRecentWorkspace: (path: string) => Promise<void>
}

/** Groups the modal entrypoints that the workspace routing bridge forwards. */
export type AppShellWorkspaceRoutingModalPort = {
  openWorkspaceSetupWizard: () => Promise<void>
  closeWorkspaceSetupWizard: () => void
}

/** Groups the setup workflow entrypoint forwarded by the routing bridge. */
export type AppShellWorkspaceRoutingSetupPort = {
  applyWorkspaceSetupWizard: (payload: AppShellWorkspaceRoutingSetupPayload) => Promise<void>
}

/** Declares the dependencies required by the workspace routing bridge. */
export type UseAppShellWorkspaceRoutingOptions = {
  lifecyclePort: AppShellWorkspaceRoutingLifecyclePort
  modalPort: AppShellWorkspaceRoutingModalPort
  setupPort: AppShellWorkspaceRoutingSetupPort
}

/**
 * Owns the shell-root routing surface for workspace picker, reopen, and setup
 * wizard entrypoints.
 */
export function useAppShellWorkspaceRouting(options: UseAppShellWorkspaceRoutingOptions) {
  function openWorkspacePicker() {
    return options.lifecyclePort.openWorkspacePicker()
  }

  function openRecentWorkspace(path: string) {
    return options.lifecyclePort.openRecentWorkspace(path)
  }

  function openWorkspaceSetupWizard() {
    return options.modalPort.openWorkspaceSetupWizard()
  }

  function closeWorkspaceSetupWizard() {
    options.modalPort.closeWorkspaceSetupWizard()
  }

  function applyWorkspaceSetupWizard(payload: AppShellWorkspaceRoutingSetupPayload) {
    return options.setupPort.applyWorkspaceSetupWizard(payload)
  }

  return {
    openWorkspacePicker,
    openRecentWorkspace,
    openWorkspaceSetupWizard,
    closeWorkspaceSetupWizard,
    applyWorkspaceSetupWizard
  }
}
