import type { CosmosGraph, CosmosGraphNode } from '../../domains/cosmos/lib/graphIndex'

/** Launchpad row shown for a recently opened workspace. */
export type LaunchpadRecentWorkspace = {
  path: string
  label: string
  subtitle: string
  recencyLabel: string
}

/** Launchpad row shown for a recently viewed or updated note. */
export type LaunchpadRecentNote = {
  path: string
  title: string
  relativePath: string
  recencyLabel: string
}

/** View-model consumed by pane-native Cosmos surfaces. */
export type AppShellCosmosViewModel = {
  graph: CosmosGraph
  loading: boolean
  error: string
  selectedNodeId: string
  focusMode: boolean
  focusDepth: number
  summary: { nodes: number; edges: number }
  query: string
  matches: CosmosGraphNode[]
  showSemanticEdges: boolean
  selectedNode: CosmosGraphNode | null
  selectedLinkCount: number
  preview: string
  previewLoading: boolean
  previewError: string
  outgoingNodes: CosmosGraphNode[]
  incomingNodes: CosmosGraphNode[]
}

/** View-model consumed by pane-native Second Brain surfaces. */
export type AppShellSecondBrainViewModel = {
  workspacePath: string
  allWorkspaceFiles: string[]
  requestedSessionId: string
  requestedSessionNonce: number
  requestedPrompt: string
  requestedPromptNonce: number
  activeNotePath: string
  echoesRefreshToken: number
}

/** View-model consumed by Home/Launchpad pane surfaces. */
export type AppShellLaunchpadViewModel = {
  workspaceLabel: string
  recentWorkspaces: LaunchpadRecentWorkspace[]
  recentViewedNotes: LaunchpadRecentNote[]
  recentUpdatedNotes: LaunchpadRecentNote[]
  showWizardAction: boolean
}
