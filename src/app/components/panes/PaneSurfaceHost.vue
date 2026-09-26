<script setup lang="ts">
import { computed, ref } from 'vue'
import EditorView from '../../../domains/editor/components/EditorView.vue'
import FileInspectorPaneSurface from './FileInspectorPaneSurface.vue'
import WorkspaceLaunchpad from './WorkspaceLaunchpad.vue'
import type { PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import type { FileEditorStatus } from './EditorPaneTabs.vue'
import type { WikilinkAnchor } from '../../../domains/editor/lib/wikilinks'
import type { DocumentSession } from '../../../domains/editor/composables/useDocumentEditorSessions'
import type { ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import type { AppShellLaunchpadViewModel } from '../../lib/appShellViewModels'
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
  workspacePath: string
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
  'external-reload': [payload: { path: string }]
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
  'launchpad-quick-start': [kind: 'today' | 'command-palette']
}>()

type EditorSurfaceExposed = {
  saveNow: () => Promise<void>
  reloadCurrent: () => Promise<void>
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => Promise<void>
  focusEditor: () => void
  openNoteHistory: () => Promise<void>
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
}

const editorSurfaceRef = ref<EditorSurfaceExposed | null>(null)
const activeInspectorTab = computed(() => props.activeTab?.type === 'file-inspector' ? props.activeTab : null)
const activeInspectorPath = computed(() => activeInspectorTab.value?.path ?? '')
const openActiveInspectorExternally = () => {
  if (!activeInspectorTab.value || !props.openExternally) return
  void props.openExternally(activeInspectorTab.value.path)
}

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
})
</script>

<template>
  <EditorView
    v-if="activeTab?.type === 'document'"
    ref="editorSurfaceRef"
    :path="activeTab.path"
    :workspace-path="workspacePath"
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
