
import type { AppSettingsAlters } from '../../shared/api/apiTypes'

/** Launchpad row shown for a recently opened workspace. */
export type LaunchpadRecentWorkspace = {
  path: string
  label: string
  subtitle: string
  recencyLabel: string
}

/** Launchpad row shown for a recently viewed or updated file. */
export type LaunchpadRecentNote = {
  path: string
  title: string
  relativePath: string
  recencyLabel: string
}

/** View-model consumed by pane-native Second Brain surfaces. */
export type AppShellSecondBrainViewModel = {
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedPrompt: string
  requestedPromptNonce: number
  requestedAlterId?: string
  requestedAlterNonce?: number
  activeNotePath: string
  echoesRefreshToken: number
  settings?: AppSettingsAlters
}

/** View-model consumed by pane-native Alters surfaces. */
export type AppShellAltersViewModel = {
  workspacePath: string
  settings: AppSettingsAlters
}

/** View-model consumed by Home/Launchpad pane surfaces. */
export type AppShellLaunchpadViewModel = {
  workspaceLabel: string
  recentWorkspaces: LaunchpadRecentWorkspace[]
  recentViewedNotes: LaunchpadRecentNote[]
  recentUpdatedNotes: LaunchpadRecentNote[]
  showWizardAction: boolean
}
