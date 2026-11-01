<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EditorView from '../../../domains/editor/components/EditorView.vue'
import FileInspectorPaneSurface from './FileInspectorPaneSurface.vue'
import LockedPageSurface from './LockedPageSurface.vue'
import { useInlinePageUnlock } from '../../composables/useInlinePageUnlock'
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
  isActivePane?: boolean
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
  cursorStyle?: 'block' | 'bar' | 'underline'
  cursorBlink?: boolean
  activeDocumentPath: string
  workspacePath: string
  launchpad: AppShellLaunchpadViewModel & {
    showExperience: boolean
    mode: 'no-workspace' | 'workspace-launchpad'
  }
}>()

const emit = defineEmits<{
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string; inaccessible?: boolean }]
  'path-renamed': [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: Array<{ level: 1 | 2 | 3; text: string }>]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
  'signal-summary': [payload: EditorSignalSummary]
  'external-reload': [payload: { path: string }]
  'breadcrumb-action': [payload: { kind: 'folder' | 'document'; path: string; action: 'reveal' | 'copy-link' }]
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
  getSelectionText: () => string
  getSelectionMarkdown: () => string
  extractSelectionToLinkedNote: () => Promise<boolean>
  transformSelectionToHeading: () => boolean
  transformSelectionToList: () => boolean
  zoomIn: () => number
  zoomOut: () => number
  resetZoom: () => number
  getZoom: () => number
  getScrollTop: () => number
  setScrollTop: (value: number) => boolean
}

const activeNotePath = computed(() => props.activeTab?.type === 'document' ? props.activeTab.path : '')
const pageUnlock = useInlinePageUnlock(activeNotePath)
const pageReady = computed(() => pageUnlock.state.value === 'unlocked' && !pageUnlock.waitingReads.value[activeNotePath.value])
const readSnapshot = (path: string) => pageUnlock.read(() => props.readNoteSnapshot!(path))
const readFile = (path: string) => pageUnlock.read(() => props.openFile!(path))

// A note that fails to load is still an open tab, so the strip has to be able
// to flag it. The editor never emits a status for such a path, so the pane
// surface reports the read failure itself and merges it with the last known
// save state.
watch([activeNotePath, () => pageUnlock.state.value], () => {
  const path = activeNotePath.value
  if (!path) return
  const current = props.getStatus(path)
  emit('status', {
    path,
    dirty: current.dirty,
    saving: current.saving,
    saveError: current.saveError,
    inaccessible: pageUnlock.state.value === 'error'
  })
})

const editorSurfaceRef = ref<EditorSurfaceExposed | null>(null)
const activeInspectorTab = computed(() => props.activeTab?.type === 'file-inspector' ? props.activeTab : null)
const activeInspectorPath = computed(() => activeInspectorTab.value?.path ?? '')
const openActiveInspectorExternally = () => {
  if (!activeInspectorTab.value || !props.openExternally) return
  void props.openExternally(activeInspectorTab.value.path)
}

function withEditor<T>(run: (editor: EditorSurfaceExposed) => T, fallback: T): T {
  const editor = editorSurfaceRef.value
  if (!editor || !pageReady.value) return fallback
  return run(editor)
}

defineExpose<EditorSurfaceExposed>({
  saveNow: async () => await withEditor((editor) => editor.saveNow(), Promise.resolve()),
  reloadCurrent: async () => await withEditor((editor) => editor.reloadCurrent(), Promise.resolve()),
  applyWorkspaceFsChanges: async (changes: WorkspaceFsChange[]) => { await editorSurfaceRef.value?.applyWorkspaceFsChanges(changes) },
  // Focus is not gated on `pageReady`: the editor surface queues the request
  // while the note is still loading and replays it once the content is committed.
  focusEditor: () => editorSurfaceRef.value?.focusEditor(),
  openNoteHistory: async () => await withEditor((editor) => editor.openNoteHistory(), Promise.resolve()),
  isSourceSurface: () => withEditor((editor) => editor.isSourceSurface(), false),
  setMarkdownSourceSurfaceEnabled: async (enabled: boolean) => await withEditor((editor) => editor.setMarkdownSourceSurfaceEnabled(enabled), Promise.resolve()),
  revealSnippet: async (snippet: string) => await withEditor((editor) => editor.revealSnippet(snippet), Promise.resolve()),
  revealOutlineHeading: async (index: number) => await withEditor((editor) => editor.revealOutlineHeading(index), Promise.resolve()),
  revealAnchor: async (anchor: WikilinkAnchor) => await withEditor((editor) => editor.revealAnchor(anchor), Promise.resolve(false)),
  navigateSignal: (kind: EditorSignalKind, direction: EditorSignalDirection) => withEditor((editor) => editor.navigateSignal(kind, direction), undefined),
  getSelectionText: () => withEditor((editor) => editor.getSelectionText(), ''),
  getSelectionMarkdown: () => withEditor((editor) => editor.getSelectionMarkdown(), ''),
  extractSelectionToLinkedNote: async () => await withEditor((editor) => editor.extractSelectionToLinkedNote(), Promise.resolve(false)),
  transformSelectionToHeading: () => withEditor((editor) => editor.transformSelectionToHeading(), false),
  transformSelectionToList: () => withEditor((editor) => editor.transformSelectionToList(), false),
  zoomIn: () => withEditor((editor) => editor.zoomIn(), 1),
  zoomOut: () => withEditor((editor) => editor.zoomOut(), 1),
  resetZoom: () => withEditor((editor) => editor.resetZoom(), 1),
  getZoom: () => withEditor((editor) => editor.getZoom(), 1),
  getScrollTop: () => withEditor((editor) => editor.getScrollTop(), 0),
  setScrollTop: (value: number) => withEditor((editor) => editor.setScrollTop(value), false),
})
</script>

<template>
  <EditorView
    v-if="activeTab?.type === 'document'"
    v-show="pageReady"
    ref="editorSurfaceRef"
    :path="activeTab.path"
    :workspace-path="workspacePath"
    :openPaths="openDocumentPaths"
    :all-workspace-files="allWorkspaceFiles"
    :openFile="openFile ? readFile : undefined"
    :saveFile="saveFile"
    :readNoteSnapshot="readNoteSnapshot ? readSnapshot : undefined"
    :saveNoteBuffer="saveNoteBuffer"
    :renameFileFromTitle="renameFileFromTitle"
    :loadLinkTargets="loadLinkTargets"
    :loadLinkHeadings="loadLinkHeadings"
    :loadPropertyTypeSchema="loadPropertyTypeSchema"
    :savePropertyTypeSchema="savePropertyTypeSchema"
    :openLinkTarget="openLinkTarget"
    :spellcheckEnabled="spellcheckEnabled"
    :ruler-visible="rulerVisible"
    :cursor-style="cursorStyle"
    :cursor-blink="cursorBlink"
    @status="emit('status', $event)"
    @path-renamed="emit('path-renamed', $event)"
    @outline="emit('outline', $event)"
    @properties="emit('properties', $event)"
    @signal-summary="emit('signal-summary', $event)"
    @external-reload="emit('external-reload', $event)"
    @breadcrumb-action="emit('breadcrumb-action', $event)"
  />

  <LockedPageSurface
    v-if="activeTab?.type === 'document' && pageUnlock.state.value === 'locked'"
    :key="activeNotePath"
    :path="activeNotePath"
    :active="Boolean(isActivePane)"
    :error="pageUnlock.error.value"
    :pending="pageUnlock.pending.value"
    @submit="pageUnlock.submit"
  />
  <div v-else-if="activeTab?.type === 'document' && !pageReady" class="surface-placeholder" role="status">
    <template v-if="pageUnlock.state.value === 'error'">{{ pageUnlock.error.value }} <button type="button" @click="pageUnlock.refresh">Retry</button></template>
    <template v-else>Loading note…</template>
  </div>

  <FileInspectorPaneSurface
    v-if="activeInspectorTab"
    :path="activeInspectorPath"
    :open-externally="openActiveInspectorExternally"
  />

  <WorkspaceLaunchpad
    v-if="!activeTab || activeTab.type === 'home'"
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
