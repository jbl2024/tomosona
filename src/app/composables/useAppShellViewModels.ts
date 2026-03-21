import { computed, type ComputedRef, type Ref } from 'vue'
import type { FileMetadata, SemanticLink } from '../../shared/api/apiTypes'
import type { AppSettingsAlters } from '../../shared/api/apiTypes'
import type { EchoesItem } from '../../domains/echoes/lib/echoes'
import type { ConstitutedContextItem } from '../../domains/editor/composables/useConstitutedContext'
import type { CosmosGraph, CosmosGraphNode } from '../../domains/cosmos/lib/graphIndex'
import type { DocumentHistoryEntry } from '../../domains/editor/composables/useDocumentHistory'
import type { AppThemeDefinition } from '../../shared/lib/themeRegistry'
import type { AppShellCosmosViewModel, AppShellLaunchpadViewModel, AppShellSecondBrainViewModel, AppShellAltersViewModel, LaunchpadRecentNote, LaunchpadRecentWorkspace } from '../lib/appShellViewModels'
import { basenameLabel, buildMetadataRows, buildShortcutSections, buildSystemThemeLabel, buildThemePickerItems, type ShellSurfaceType, type ThemePickerItem } from '../lib/appShellPresentation'

type ShortcutSection = {
  title: string
  items: Array<{ keys: string; action: string }>
}

type ViewModelCosmosState = {
  graph: Ref<CosmosGraph>
  loading: Ref<boolean>
  error: Ref<string>
  selectedNodeId: Ref<string>
  focusMode: Ref<boolean>
  focusDepth: Ref<number>
  summary: Ref<{ nodes: number; edges: number }>
  query: Ref<string>
  queryMatches: Ref<CosmosGraphNode[]>
  showSemanticEdges: Ref<boolean>
  selectedNode: Ref<CosmosGraphNode | null>
  selectedLinkCount: Ref<number>
  preview: Ref<string>
  previewLoading: Ref<boolean>
  previewError: Ref<string>
  outgoingNodes: Ref<CosmosGraphNode[]>
  incomingNodes: Ref<CosmosGraphNode[]>
}

type ViewModelOptions = {
  theme: {
    activeColorScheme: Ref<'light' | 'dark'>
    availableThemes: ReadonlyArray<AppThemeDefinition>
  }
  search: {
    shortcutsFilterQuery: Ref<string>
  }
  workspace: {
    workingFolderPath: Ref<string>
    activeFilePath: Ref<string>
    activeStatus: ComputedRef<{ saving: boolean; dirty: boolean }>
    activeFileMetadata: Ref<FileMetadata | null>
    virtualDocs: Ref<Record<string, { content: string; titleLine: string }>>
    editorZoom: Ref<number>
    getActiveTab: () => { type: ShellSurfaceType } | null
    toRelativePath: (path: string) => string
  }
  history: {
    backTargets: Ref<Array<{ index: number; entry: DocumentHistoryEntry }>>
    forwardTargets: Ref<Array<{ index: number; entry: DocumentHistoryEntry }>>
  }
  notes: {
    noteEchoes: Ref<EchoesItem[]>
    semanticLinks: Ref<SemanticLink[]>
  }
  context: {
    constitutedContext: {
      contains: (path: string) => boolean
      localItems: Ref<ConstitutedContextItem[]>
      pinnedItems: Ref<ConstitutedContextItem[]>
    }
  }
  cosmos: ViewModelCosmosState
  launchpad: {
    recentWorkspaces: Ref<LaunchpadRecentWorkspace[]>
    recentViewedNotes: Ref<LaunchpadRecentNote[]>
    recentUpdatedNotes: Ref<LaunchpadRecentNote[]>
    showWizardAction: Ref<boolean>
  }
  altersSettings: Ref<AppSettingsAlters>
  secondBrain: {
    workspacePath: Ref<string>
    allWorkspaceFiles: Ref<string[]>
    requestedSessionId: Ref<string>
    requestedSessionNonce: Ref<number>
    requestedPrompt: Ref<string>
    requestedPromptNonce: Ref<number>
    requestedAlterId: Ref<string>
    requestedAlterNonce: Ref<number>
    echoesRefreshToken: Ref<number>
  }
  labels: {
    formatTimestamp: (value: number | null | undefined) => string
  }
  isMacOs: boolean
  libs: {
    buildShortcutSections: typeof buildShortcutSections
    buildMetadataRows: typeof buildMetadataRows
    buildSystemThemeLabel: typeof buildSystemThemeLabel
    buildThemePickerItems: typeof buildThemePickerItems
    basenameLabel: typeof basenameLabel
  }
  historyLabels: {
    historyTargetLabel: (entry: DocumentHistoryEntry) => string
  }
}

export type AppShellViewModels = {
  systemThemeLabel: ComputedRef<string>
  themePickerItems: ComputedRef<ThemePickerItem[]>
  shortcutSections: ComputedRef<ShortcutSection[]>
  filteredShortcutSections: ComputedRef<ShortcutSection[]>
  metadataRows: ComputedRef<ReturnType<typeof buildMetadataRows>>
  backlinkCount: ComputedRef<number>
  semanticLinkCount: ComputedRef<number>
  activeNoteInContext: ComputedRef<boolean>
  localContextItems: ComputedRef<ConstitutedContextItem[]>
  pinnedContextItems: ComputedRef<ConstitutedContextItem[]>
  noteEchoesForPanel: ComputedRef<Array<EchoesItem & { isInContext: boolean }>>
  cosmosSelectedNodeForPanel: ComputedRef<CosmosGraphNode | null>
  cosmosPaneViewModel: ComputedRef<AppShellCosmosViewModel>
  secondBrainPaneViewModel: ComputedRef<AppShellSecondBrainViewModel>
  altersPaneViewModel: ComputedRef<AppShellAltersViewModel>
  launchpadPaneViewModel: ComputedRef<AppShellLaunchpadViewModel>
  backShortcutLabel: ComputedRef<string>
  forwardShortcutLabel: ComputedRef<string>
  homeShortcutLabel: ComputedRef<string>
  commandPaletteShortcutLabel: ComputedRef<string>
  zoomPercentLabel: ComputedRef<string>
  primaryModLabel: ComputedRef<string>
  backHistoryItems: ComputedRef<Array<{ index: number; key: string; label: string }>>
  forwardHistoryItems: ComputedRef<Array<{ index: number; key: string; label: string }>>
}

/**
 * Module: useAppShellViewModels
 *
 * Purpose:
 * - Own the shell's derived view-models so App.vue stays focused on wiring and rendering.
 *
 * Boundary:
 * - This composable only derives presentation state.
 * - It must not own side effects or mutate shell/domain state.
 */
export function useAppShellViewModels(options: ViewModelOptions): AppShellViewModels {
  const systemThemeLabel = computed(() =>
    options.libs.buildSystemThemeLabel(options.theme.activeColorScheme.value)
  )

  const themePickerItems = computed(() =>
    options.libs
      .buildThemePickerItems(options.theme.availableThemes, options.theme.activeColorScheme.value)
      .filter((item) => {
        const q = options.search.shortcutsFilterQuery.value.trim().toLowerCase()
        if (!q) return true
        return `${item.label} ${item.meta}`.toLowerCase().includes(q)
      })
  )

  const shortcutSections = computed(() =>
    options.libs.buildShortcutSections({
      primaryModLabel: options.isMacOs ? 'Cmd' : 'Ctrl',
      backShortcutLabel: options.isMacOs ? 'Cmd+[' : 'Alt+Left',
      forwardShortcutLabel: options.isMacOs ? 'Cmd+]' : 'Alt+Right',
      homeShortcutLabel: options.isMacOs ? 'Cmd+Shift+H' : 'Ctrl+Shift+H',
      commandPaletteShortcutLabel: options.isMacOs ? 'Cmd+Shift+P' : 'Ctrl+Shift+P'
    })
  )

  const filteredShortcutSections = computed(() => {
    const query = options.search.shortcutsFilterQuery.value.trim().toLowerCase()
    if (!query) return shortcutSections.value

    return shortcutSections.value
      .map((section) => {
        const titleMatches = section.title.toLowerCase().includes(query)
        if (titleMatches) return section
        const items = section.items.filter((item) =>
          item.keys.toLowerCase().includes(query) || item.action.toLowerCase().includes(query)
        )
        return { ...section, items }
      })
      .filter((section) => section.items.length > 0)
  })

  const metadataRows = computed(() =>
    options.libs.buildMetadataRows({
      activeFilePath: options.workspace.activeFilePath.value,
      activeStatus: options.workspace.activeStatus.value,
      virtualDocExists: Boolean(options.workspace.virtualDocs.value[options.workspace.activeFilePath.value]),
      activeTab: options.workspace.getActiveTab(),
      activeFileMetadata: options.workspace.activeFileMetadata.value,
      workspacePath: options.workspace.workingFolderPath.value,
      toRelativePath: options.workspace.toRelativePath,
      formatTimestamp: options.labels.formatTimestamp
    })
  )

  const backlinkCount = computed(() => options.notes.noteEchoes.value.length)
  const semanticLinkCount = computed(() => options.notes.semanticLinks.value.length)
  const activeNoteInContext = computed(() => {
    const path = options.workspace.activeFilePath.value.trim()
    return path ? options.context.constitutedContext.contains(path) : false
  })
  const localContextItems = computed(() => options.context.constitutedContext.localItems.value)
  const pinnedContextItems = computed(() => options.context.constitutedContext.pinnedItems.value)
  const noteEchoesForPanel = computed(() =>
    options.notes.noteEchoes.value.map((item) => ({
      ...item,
      isInContext: options.context.constitutedContext.contains(item.path)
    }))
  )
  const cosmosSelectedNodeForPanel = computed(() => {
    if (!options.cosmos.selectedNode.value) return null
    return {
      ...options.cosmos.selectedNode.value,
      path: options.workspace.toRelativePath(options.cosmos.selectedNode.value.path)
    }
  })
  const cosmosPaneViewModel = computed<AppShellCosmosViewModel>(() => ({
    graph: options.cosmos.graph.value,
    loading: options.cosmos.loading.value,
    error: options.cosmos.error.value,
    selectedNodeId: options.cosmos.selectedNodeId.value,
    focusMode: options.cosmos.focusMode.value,
    focusDepth: options.cosmos.focusDepth.value,
    summary: options.cosmos.summary.value,
    query: options.cosmos.query.value,
    matches: options.cosmos.queryMatches.value,
    showSemanticEdges: options.cosmos.showSemanticEdges.value,
    selectedNode: cosmosSelectedNodeForPanel.value,
    selectedLinkCount: options.cosmos.selectedLinkCount.value,
    preview: options.cosmos.preview.value,
    previewLoading: options.cosmos.previewLoading.value,
    previewError: options.cosmos.previewError.value,
    outgoingNodes: options.cosmos.outgoingNodes.value,
    incomingNodes: options.cosmos.incomingNodes.value
  }))
  const secondBrainPaneViewModel = computed<AppShellSecondBrainViewModel>(() => ({
    workspacePath: options.secondBrain.workspacePath.value,
    allWorkspaceFiles: options.secondBrain.allWorkspaceFiles.value,
    requestedSessionId: options.secondBrain.requestedSessionId.value,
    requestedSessionNonce: options.secondBrain.requestedSessionNonce.value,
    requestedPrompt: options.secondBrain.requestedPrompt.value,
    requestedPromptNonce: options.secondBrain.requestedPromptNonce.value,
    requestedAlterId: options.secondBrain.requestedAlterId.value,
    requestedAlterNonce: options.secondBrain.requestedAlterNonce.value,
    activeNotePath: options.workspace.activeFilePath.value,
    echoesRefreshToken: options.secondBrain.echoesRefreshToken.value,
    settings: options.altersSettings.value
  }))
  const altersPaneViewModel = computed<AppShellAltersViewModel>(() => ({
    workspacePath: options.workspace.workingFolderPath.value,
    settings: options.altersSettings.value
  }))
  const launchpadPaneViewModel = computed<AppShellLaunchpadViewModel>(() => ({
    workspaceLabel: options.workspace.workingFolderPath.value
      ? options.libs.basenameLabel(options.workspace.workingFolderPath.value)
      : '',
    recentWorkspaces: options.launchpad.recentWorkspaces.value,
    recentViewedNotes: options.launchpad.recentViewedNotes.value,
    recentUpdatedNotes: options.launchpad.recentUpdatedNotes.value,
    showWizardAction: options.launchpad.showWizardAction.value
  }))

  const backShortcutLabel = computed(() => (options.isMacOs ? 'Cmd+[' : 'Alt+Left'))
  const forwardShortcutLabel = computed(() => (options.isMacOs ? 'Cmd+]' : 'Alt+Right'))
  const homeShortcutLabel = computed(() => (options.isMacOs ? 'Cmd+Shift+H' : 'Ctrl+Shift+H'))
  const commandPaletteShortcutLabel = computed(() => (options.isMacOs ? 'Cmd+Shift+P' : 'Ctrl+Shift+P'))
  const zoomPercentLabel = computed(() => `${Math.round(options.workspace.editorZoom.value * 100)}%`)
  const primaryModLabel = computed(() => (options.isMacOs ? 'Cmd' : 'Ctrl'))
  const backHistoryItems = computed(() =>
    options.history.backTargets.value.slice(0, 14).map((target) => ({
      index: target.index,
      key: `back-${target.index}-${target.entry.stateKey}`,
      label: options.historyLabels.historyTargetLabel(target.entry)
    }))
  )
  const forwardHistoryItems = computed(() =>
    options.history.forwardTargets.value.slice(0, 14).map((target) => ({
      index: target.index,
      key: `forward-${target.index}-${target.entry.stateKey}`,
      label: options.historyLabels.historyTargetLabel(target.entry)
    }))
  )

  return {
    systemThemeLabel,
    themePickerItems,
    shortcutSections,
    filteredShortcutSections,
    metadataRows,
    backlinkCount,
    semanticLinkCount,
    activeNoteInContext,
    localContextItems,
    pinnedContextItems,
    noteEchoesForPanel,
    cosmosSelectedNodeForPanel,
    cosmosPaneViewModel,
    secondBrainPaneViewModel,
    altersPaneViewModel,
    launchpadPaneViewModel,
    backShortcutLabel,
    forwardShortcutLabel,
    homeShortcutLabel,
    commandPaletteShortcutLabel,
    zoomPercentLabel,
    primaryModLabel,
    backHistoryItems,
    forwardHistoryItems
  }
}
