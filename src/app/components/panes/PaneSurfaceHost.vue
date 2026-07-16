<script setup lang="ts">
import { computed, ref } from 'vue'
import EditorView from '../../../domains/editor/components/EditorView.vue'
import CosmosPaneSurface from '../../../domains/cosmos/components/CosmosPaneSurface.vue'
import SecondBrainPaneSurface from '../../../domains/second-brain/components/SecondBrainPaneSurface.vue'
import AlterExplorationPaneSurface from '../../../domains/alters/components/AlterExplorationPaneSurface.vue'
import AlterManagerView from '../../../domains/alters/components/AlterManagerView.vue'
import FileInspectorPaneSurface from './FileInspectorPaneSurface.vue'
import WorkspaceLaunchpad from './WorkspaceLaunchpad.vue'
import type { PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import type { FileEditorStatus } from './EditorPaneTabs.vue'
import type { WikilinkAnchor } from '../../../domains/editor/lib/wikilinks'
import type { DocumentSession } from '../../../domains/editor/composables/useDocumentEditorSessions'
import type { PulseActionId, ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import type {
  AppShellCosmosViewModel,
  AppShellAltersViewModel,
  AppShellLaunchpadViewModel,
  AppShellSecondBrainViewModel
} from '../../lib/appShellViewModels'
import type { AppSettingsAlters } from '../../../shared/api/apiTypes'
import type { PulseApplyMode } from '../../../domains/pulse/lib/pulse'
import { createClosedPulseDrawerState, type PulseDrawerState } from '../../../domains/pulse/lib/pulseDrawer'
import type {
  EditorSignalDirection,
  EditorSignalKind,
  EditorSignalSummary
} from '../../../domains/editor/lib/editorSignals'

const props = defineProps<{
  paneId: string
  activeTab: PaneTab | null
  openTabs: PaneTab[]
  openDocumentPaths: string[]
  allWorkspaceFiles?: string[]
  getStatus: (path: string) => FileEditorStatus
  openFile?: (path: string) => Promise<string>
  openExternally?: (path: string) => Promise<void> | void
  saveFile?: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  readNoteSnapshot?: (path: string) => Promise<ReadNoteSnapshotResult>
  saveNoteBuffer?: (
    path: string,
    text: string,
    options: { explicit: boolean; expectedBaseVersion: DocumentSession['baseVersion']; force?: boolean }
  ) => Promise<SaveNoteResult>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
  spellcheckEnabled?: boolean
  rulerVisible?: boolean
  activeDocumentPath: string
  cosmos: AppShellCosmosViewModel
  alters?: AppShellAltersViewModel
  secondBrain: AppShellSecondBrainViewModel
  launchpad: AppShellLaunchpadViewModel & {
    showExperience: boolean
    mode: 'no-workspace' | 'workspace-launchpad'
  }
}>()

const emit = defineEmits<{
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string }]
  'path-renamed': [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: Array<{ level: 1 | 2 | 3; text: string }>]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
  'signal-summary': [payload: EditorSignalSummary]
  'pulse-state-change': [payload: PulseDrawerState]
  'pulse-open-second-brain': [payload: { contextPaths: string[]; prompt?: string }]
  'external-reload': [payload: { path: string }]
  'cosmos-query-update': [value: string]
  'cosmos-search-enter': []
  'cosmos-select-match': [nodeId: string]
  'cosmos-toggle-focus-mode': [value: boolean]
  'cosmos-toggle-semantic-edges': [value: boolean]
  'cosmos-expand-neighborhood': []
  'cosmos-jump-related': [nodeId: string]
  'cosmos-open-selected': []
  'cosmos-locate-selected': []
  'cosmos-reset-view': []
  'cosmos-select-node': [nodeId: string]
  'cosmos-add-to-context': [path: string]
  'open-note': [path: string]
  'launchpad-open-workspace': []
  'launchpad-open-wizard': []
  'launchpad-open-command-palette': []
  'launchpad-open-shortcuts': []
  'launchpad-open-recent-workspace': [path: string]
  'launchpad-open-today': []
  'launchpad-open-quick-open': []
  'launchpad-create-note': []
  'launchpad-open-recent-note': [path: string]
  'launchpad-quick-start': [kind: 'today' | 'second-brain' | 'cosmos' | 'command-palette' | 'alters']
  'second-brain-context-changed': [paths: string[]]
  'second-brain-session-changed': [sessionId: string]
  'second-brain-open-alter-exploration': []
  'alter-exploration-notify': [payload: { tone: 'info' | 'success' | 'error'; message: string }]
  'alter-open-second-brain': [alterId: string]
}>()

type EditorSurfaceExposed = {
  saveNow: () => Promise<void>
  reloadCurrent: () => Promise<void>
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => Promise<void>
  focusEditor: () => void
  openNoteHistory: () => Promise<void>
  openPulseForNote: () => void
  openPulseForContext: (paths: string[]) => void
  getPulseDrawerState: () => PulseDrawerState
  setPulseAction: (actionId: PulseActionId) => void
  setPulseInstruction: (value: string, options?: { markDirty?: boolean }) => void
  runPulseFromEditor: () => Promise<void>
  cancelPulse: () => Promise<void>
  closePulsePanel: () => void
  applyPulseMode: (mode: PulseApplyMode) => void
  isSourceSurface: () => boolean
  setMarkdownSourceSurfaceEnabled: (enabled: boolean) => Promise<void>
  revealSnippet: (snippet: string) => Promise<void>
  revealOutlineHeading: (index: number) => Promise<void>
  revealAnchor: (anchor: WikilinkAnchor) => Promise<boolean>
  navigateSignal: (kind: EditorSignalKind, direction: EditorSignalDirection) => void
  zoomIn: () => number
  zoomOut: () => number
  resetZoom: () => number
  getZoom: () => number
  resetCosmosView: () => void
  focusCosmosNodeById: (nodeId: string) => boolean
}

const editorSurfaceRef = ref<EditorSurfaceExposed | null>(null)
const cosmosSurfaceRef = ref<{ resetView: () => void; focusNodeById: (nodeId: string) => boolean } | null>(null)
const hasCosmosTab = computed(() => props.openTabs.some((tab) => tab.type === 'cosmos'))
const hasSecondBrainTab = computed(() => props.openTabs.some((tab) => tab.type === 'second-brain-chat'))
const hasAlterExplorationTab = computed(() => props.openTabs.some((tab) => tab.type === 'alter-exploration'))
const hasAltersTab = computed(() => props.openTabs.some((tab) => tab.type === 'alters'))
const showCosmosSurface = computed(() => props.activeTab?.type === 'cosmos')
const showSecondBrainSurface = computed(() => props.activeTab?.type === 'second-brain-chat')
const showAlterExplorationSurface = computed(() => props.activeTab?.type === 'alter-exploration')
const showAltersSurface = computed(() => props.activeTab?.type === 'alters')
const activeInspectorTab = computed(() => props.activeTab?.type === 'file-inspector' ? props.activeTab : null)
const activeInspectorPath = computed(() => activeInspectorTab.value?.path ?? '')
const openActiveInspectorExternally = () => {
  if (!activeInspectorTab.value || !props.openExternally) return
  void props.openExternally(activeInspectorTab.value.path)
}
const defaultAlterSettings: AppSettingsAlters = {
  default_mode: 'neutral',
  show_badge_in_chat: true,
  default_influence_intensity: 'balanced'
}
const secondBrainViewModel = computed(() => ({
  workspacePath: props.secondBrain.workspacePath,
  allWorkspaceFiles: props.secondBrain.allWorkspaceFiles,
  requestedSessionId: props.secondBrain.requestedSessionId,
  requestedSessionNonce: props.secondBrain.requestedSessionNonce,
  requestedPrompt: props.secondBrain.requestedPrompt,
  requestedPromptNonce: props.secondBrain.requestedPromptNonce,
  requestedAlterId: props.secondBrain.requestedAlterId ?? '',
  requestedAlterNonce: props.secondBrain.requestedAlterNonce ?? 0,
  activeNotePath: props.secondBrain.activeNotePath,
  echoesRefreshToken: props.secondBrain.echoesRefreshToken,
  settings: props.secondBrain.settings ?? defaultAlterSettings
}))
const altersViewModel = computed<AppShellAltersViewModel>(() => props.alters ?? {
  workspacePath: '',
  settings: defaultAlterSettings
})

function withEditor<T>(run: (editor: EditorSurfaceExposed) => T, fallback: T): T {
  const editor = editorSurfaceRef.value
  if (!editor) return fallback
  return run(editor)
}

defineExpose<EditorSurfaceExposed>({
  saveNow: async () => await withEditor((editor) => editor.saveNow(), Promise.resolve()),
  reloadCurrent: async () => await withEditor((editor) => editor.reloadCurrent(), Promise.resolve()),
  applyWorkspaceFsChanges: async (changes: WorkspaceFsChange[]) => await withEditor((editor) => editor.applyWorkspaceFsChanges(changes), Promise.resolve()),
  focusEditor: () => withEditor((editor) => editor.focusEditor(), undefined),
  openNoteHistory: async () => await withEditor((editor) => editor.openNoteHistory(), Promise.resolve()),
  openPulseForNote: () => withEditor((editor) => editor.openPulseForNote(), undefined),
  openPulseForContext: (paths: string[]) => withEditor((editor) => editor.openPulseForContext(paths), undefined),
  getPulseDrawerState: () => withEditor((editor) => editor.getPulseDrawerState(), createClosedPulseDrawerState()),
  setPulseAction: (actionId: PulseActionId) => withEditor((editor) => editor.setPulseAction(actionId), undefined),
  setPulseInstruction: (value: string, options?: { markDirty?: boolean }) => withEditor((editor) => editor.setPulseInstruction(value, options), undefined),
  runPulseFromEditor: async () => await withEditor((editor) => editor.runPulseFromEditor(), Promise.resolve()),
  cancelPulse: async () => await withEditor((editor) => editor.cancelPulse(), Promise.resolve()),
  closePulsePanel: () => withEditor((editor) => editor.closePulsePanel(), undefined),
  applyPulseMode: (mode: PulseApplyMode) => withEditor((editor) => editor.applyPulseMode(mode), undefined),
  isSourceSurface: () => withEditor((editor) => editor.isSourceSurface(), false),
  setMarkdownSourceSurfaceEnabled: async (enabled: boolean) => await withEditor((editor) => editor.setMarkdownSourceSurfaceEnabled(enabled), Promise.resolve()),
  revealSnippet: async (snippet: string) => await withEditor((editor) => editor.revealSnippet(snippet), Promise.resolve()),
  revealOutlineHeading: async (index: number) => await withEditor((editor) => editor.revealOutlineHeading(index), Promise.resolve()),
  revealAnchor: async (anchor: WikilinkAnchor) => await withEditor((editor) => editor.revealAnchor(anchor), Promise.resolve(false)),
  navigateSignal: (kind: EditorSignalKind, direction: EditorSignalDirection) => withEditor((editor) => editor.navigateSignal(kind, direction), undefined),
  zoomIn: () => withEditor((editor) => editor.zoomIn(), 1),
  zoomOut: () => withEditor((editor) => editor.zoomOut(), 1),
  resetZoom: () => withEditor((editor) => editor.resetZoom(), 1),
  getZoom: () => withEditor((editor) => editor.getZoom(), 1),
  resetCosmosView: () => cosmosSurfaceRef.value?.resetView(),
  focusCosmosNodeById: (nodeId: string) => cosmosSurfaceRef.value?.focusNodeById(nodeId) ?? false
})
</script>

<template>
  <EditorView
    v-if="activeTab?.type === 'document'"
    ref="editorSurfaceRef"
    :path="activeTab.path"
    :workspace-path="secondBrain.workspacePath"
    :openPaths="openDocumentPaths"
    :all-workspace-files="allWorkspaceFiles"
    :openFile="openFile"
    :saveFile="saveFile"
    :readNoteSnapshot="readNoteSnapshot"
    :saveNoteBuffer="saveNoteBuffer"
    :renameFileFromTitle="renameFileFromTitle"
    :loadLinkTargets="loadLinkTargets"
    :loadLinkHeadings="loadLinkHeadings"
    :loadPropertyTypeSchema="loadPropertyTypeSchema"
    :savePropertyTypeSchema="savePropertyTypeSchema"
    :openLinkTarget="openLinkTarget"
    :spellcheckEnabled="spellcheckEnabled"
    :ruler-visible="rulerVisible"
    @status="emit('status', $event)"
    @path-renamed="emit('path-renamed', $event)"
    @outline="emit('outline', $event)"
    @properties="emit('properties', $event)"
    @signal-summary="emit('signal-summary', $event)"
    @pulse-state-change="emit('pulse-state-change', $event)"
    @pulse-open-second-brain="emit('pulse-open-second-brain', $event)"
    @external-reload="emit('external-reload', $event)"
  />

  <FileInspectorPaneSurface
    v-else-if="activeInspectorTab"
    :path="activeInspectorPath"
    :open-externally="openActiveInspectorExternally"
  />

  <WorkspaceLaunchpad
    v-if="activeTab?.type === 'home'"
    :mode="launchpad.mode"
    :workspace-label="launchpad.workspaceLabel"
    :recent-workspaces="launchpad.recentWorkspaces"
    :recent-viewed-notes="launchpad.recentViewedNotes"
    :recent-updated-notes="launchpad.recentUpdatedNotes"
    :show-wizard-action="launchpad.showWizardAction"
    @open-workspace="emit('launchpad-open-workspace')"
    @open-wizard="emit('launchpad-open-wizard')"
    @open-command-palette="emit('launchpad-open-command-palette')"
    @open-shortcuts="emit('launchpad-open-shortcuts')"
    @open-recent-workspace="emit('launchpad-open-recent-workspace', $event)"
    @open-today="emit('launchpad-open-today')"
    @open-quick-open="emit('launchpad-open-quick-open')"
    @create-note="emit('launchpad-create-note')"
    @open-recent-note="emit('launchpad-open-recent-note', $event)"
    @quick-start="emit('launchpad-quick-start', $event)"
  />

  <CosmosPaneSurface
    v-if="hasCosmosTab"
    v-show="showCosmosSurface"
    ref="cosmosSurfaceRef"
    :graph="cosmos.graph"
    :loading="cosmos.loading"
    :error="cosmos.error"
    :selected-node-id="cosmos.selectedNodeId"
    :focus-mode="cosmos.focusMode"
    :focus-depth="cosmos.focusDepth"
    :summary="cosmos.summary"
    :query="cosmos.query"
    :matches="cosmos.matches"
    :show-semantic-edges="cosmos.showSemanticEdges"
    :selected-node="cosmos.selectedNode"
    :selected-link-count="cosmos.selectedLinkCount"
    :preview="cosmos.preview"
    :preview-loading="cosmos.previewLoading"
    :preview-error="cosmos.previewError"
    :outgoing-nodes="cosmos.outgoingNodes"
    :incoming-nodes="cosmos.incomingNodes"
    @update:query="emit('cosmos-query-update', $event)"
    @search-enter="emit('cosmos-search-enter')"
    @select-match="emit('cosmos-select-match', $event)"
    @toggle-focus-mode="emit('cosmos-toggle-focus-mode', $event)"
    @toggle-semantic-edges="emit('cosmos-toggle-semantic-edges', $event)"
    @expand-neighborhood="emit('cosmos-expand-neighborhood')"
    @jump-related="emit('cosmos-jump-related', $event)"
    @open-selected="emit('cosmos-open-selected')"
    @locate-selected="emit('cosmos-locate-selected')"
    @reset-view="emit('cosmos-reset-view')"
    @select-node="emit('cosmos-select-node', $event)"
    @add-to-context="emit('cosmos-add-to-context', $event)"
    @pulse-open-second-brain="emit('pulse-open-second-brain', $event)"
  />

  <SecondBrainPaneSurface
    v-if="hasSecondBrainTab"
    v-show="showSecondBrainSurface"
    :workspace-path="secondBrainViewModel.workspacePath"
    :all-workspace-files="secondBrainViewModel.allWorkspaceFiles"
    :requested-session-id="secondBrainViewModel.requestedSessionId"
    :requested-session-nonce="secondBrainViewModel.requestedSessionNonce"
    :requested-prompt="secondBrainViewModel.requestedPrompt"
    :requested-prompt-nonce="secondBrainViewModel.requestedPromptNonce"
    :requested-alter-id="secondBrainViewModel.requestedAlterId"
    :requested-alter-nonce="secondBrainViewModel.requestedAlterNonce"
    :active-note-path="secondBrainViewModel.activeNotePath"
    :echoes-refresh-token="secondBrainViewModel.echoesRefreshToken"
    :settings="secondBrainViewModel.settings"
    @open-note="emit('open-note', $event)"
    @open-alter-exploration="emit('second-brain-open-alter-exploration')"
    @context-changed="emit('second-brain-context-changed', $event)"
    @session-changed="emit('second-brain-session-changed', $event)"
  />

  <AlterExplorationPaneSurface
    v-if="hasAlterExplorationTab"
    v-show="showAlterExplorationSurface"
    :workspace-path="secondBrainViewModel.workspacePath"
    :all-workspace-files="secondBrainViewModel.allWorkspaceFiles"
    :active-note-path="secondBrainViewModel.activeNotePath"
    @open-note="emit('open-note', $event)"
    @notify="emit('alter-exploration-notify', $event)"
  />

  <AlterManagerView
    v-if="hasAltersTab"
    v-show="showAltersSurface"
    :workspace-path="altersViewModel.workspacePath"
    :active-note-path="activeDocumentPath"
    :settings="altersViewModel.settings"
    @open-second-brain="emit('alter-open-second-brain', $event)"
  />

  <WorkspaceLaunchpad
    v-else-if="!activeTab && launchpad.showExperience"
    :mode="launchpad.mode"
    :workspace-label="launchpad.workspaceLabel"
    :recent-workspaces="launchpad.recentWorkspaces"
    :recent-viewed-notes="launchpad.recentViewedNotes"
    :recent-updated-notes="launchpad.recentUpdatedNotes"
    :show-wizard-action="launchpad.showWizardAction"
    @open-workspace="emit('launchpad-open-workspace')"
    @open-wizard="emit('launchpad-open-wizard')"
    @open-command-palette="emit('launchpad-open-command-palette')"
    @open-shortcuts="emit('launchpad-open-shortcuts')"
    @open-recent-workspace="emit('launchpad-open-recent-workspace', $event)"
    @open-today="emit('launchpad-open-today')"
    @open-quick-open="emit('launchpad-open-quick-open')"
    @create-note="emit('launchpad-create-note')"
    @open-recent-note="emit('launchpad-open-recent-note', $event)"
    @quick-start="emit('launchpad-quick-start', $event)"
  />

  <div v-else-if="!activeTab" class="surface-placeholder">Open a tab to start.</div>
</template>

<style scoped>
.surface-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 0.86rem;
  background: var(--surface-bg);
}
</style>
