<script setup lang="ts">
import { computed, ref } from 'vue'
import EditorView from '../EditorView.vue'
import CosmosPaneSurface from '../cosmos/CosmosPaneSurface.vue'
import SecondBrainPaneSurface from '../second-brain/SecondBrainPaneSurface.vue'
import WorkspaceLaunchpad from './WorkspaceLaunchpad.vue'
import type { PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import type { FileEditorStatus } from './EditorPaneTabs.vue'
import type { WikilinkAnchor } from '../../lib/wikilinks'

const props = defineProps<{
  paneId: string
  activeTab: PaneTab | null
  openTabs: PaneTab[]
  openDocumentPaths: string[]
  getStatus: (path: string) => FileEditorStatus
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
  activeDocumentPath: string
  cosmos: {
    graph: any
    loading: boolean
    error: string
    selectedNodeId: string
    focusMode: boolean
    focusDepth: number
    summary: { nodes: number; edges: number }
    query: string
    matches: any[]
    showSemanticEdges: boolean
    selectedNode: any | null
    selectedLinkCount: number
    preview: string
    previewLoading: boolean
    previewError: string
    outgoingNodes: any[]
    incomingNodes: any[]
  }
  secondBrain: {
    workspacePath: string
    allWorkspaceFiles: string[]
    requestedSessionId: string
    requestedSessionNonce: number
    activeNotePath: string
  }
  launchpad: {
    showExperience: boolean
    mode: 'no-workspace' | 'workspace-launchpad'
    workspaceLabel: string
    recentWorkspaces: Array<{ path: string; label: string; subtitle: string; recencyLabel: string }>
    recentNotes: Array<{ path: string; title: string; relativePath: string; updatedLabel: string }>
    showWizardAction: boolean
  }
}>()

const emit = defineEmits<{
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string }]
  'path-renamed': [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: Array<{ level: 1 | 2 | 3; text: string }>]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
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
  'launchpad-quick-start': [kind: 'today' | 'second-brain' | 'cosmos' | 'command-palette']
  'second-brain-context-changed': [paths: string[]]
  'second-brain-session-changed': [sessionId: string]
}>()

type EditorSurfaceExposed = {
  saveNow: () => Promise<void>
  reloadCurrent: () => Promise<void>
  focusEditor: () => void
  focusFirstContentBlock: () => Promise<void>
  revealSnippet: (snippet: string) => Promise<void>
  revealOutlineHeading: (index: number) => Promise<void>
  revealAnchor: (anchor: WikilinkAnchor) => Promise<boolean>
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
const showCosmosSurface = computed(() => props.activeTab?.type === 'cosmos')
const showSecondBrainSurface = computed(() => props.activeTab?.type === 'second-brain-chat')

function withEditor<T>(run: (editor: EditorSurfaceExposed) => T, fallback: T): T {
  const editor = editorSurfaceRef.value
  if (!editor) return fallback
  return run(editor)
}

defineExpose<EditorSurfaceExposed>({
  saveNow: async () => await withEditor((editor) => editor.saveNow(), Promise.resolve()),
  reloadCurrent: async () => await withEditor((editor) => editor.reloadCurrent(), Promise.resolve()),
  focusEditor: () => withEditor((editor) => editor.focusEditor(), undefined),
  focusFirstContentBlock: async () => await withEditor((editor) => editor.focusFirstContentBlock(), Promise.resolve()),
  revealSnippet: async (snippet: string) => await withEditor((editor) => editor.revealSnippet(snippet), Promise.resolve()),
  revealOutlineHeading: async (index: number) => await withEditor((editor) => editor.revealOutlineHeading(index), Promise.resolve()),
  revealAnchor: async (anchor: WikilinkAnchor) => await withEditor((editor) => editor.revealAnchor(anchor), Promise.resolve(false)),
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
    :openPaths="openDocumentPaths"
    :openFile="openFile"
    :saveFile="saveFile"
    :renameFileFromTitle="renameFileFromTitle"
    :loadLinkTargets="loadLinkTargets"
    :loadLinkHeadings="loadLinkHeadings"
    :loadPropertyTypeSchema="loadPropertyTypeSchema"
    :savePropertyTypeSchema="savePropertyTypeSchema"
    :openLinkTarget="openLinkTarget"
    @status="emit('status', $event)"
    @path-renamed="emit('path-renamed', $event)"
    @outline="emit('outline', $event)"
    @properties="emit('properties', $event)"
  />

  <WorkspaceLaunchpad
    v-if="activeTab?.type === 'home'"
    :mode="launchpad.mode"
    :workspace-label="launchpad.workspaceLabel"
    :recent-workspaces="launchpad.recentWorkspaces"
    :recent-notes="launchpad.recentNotes"
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
  />

  <SecondBrainPaneSurface
    v-if="hasSecondBrainTab"
    v-show="showSecondBrainSurface"
    :workspace-path="secondBrain.workspacePath"
    :all-workspace-files="secondBrain.allWorkspaceFiles"
    :requested-session-id="secondBrain.requestedSessionId"
    :requested-session-nonce="secondBrain.requestedSessionNonce"
    :active-note-path="secondBrain.activeNotePath"
    @open-note="emit('open-note', $event)"
    @context-changed="emit('second-brain-context-changed', $event)"
    @session-changed="emit('second-brain-session-changed', $event)"
  />

  <WorkspaceLaunchpad
    v-else-if="!activeTab && launchpad.showExperience"
    :mode="launchpad.mode"
    :workspace-label="launchpad.workspaceLabel"
    :recent-workspaces="launchpad.recentWorkspaces"
    :recent-notes="launchpad.recentNotes"
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
