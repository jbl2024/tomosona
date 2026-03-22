<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import EditorPaneTabs, { type FileEditorStatus } from './EditorPaneTabs.vue'
import PaneSurfaceHost from './PaneSurfaceHost.vue'
import type { MultiPaneLayout, PaneState, PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import type { DocumentSession } from '../../../domains/editor/composables/useDocumentEditorSessions'
import type { WikilinkAnchor } from '../../../domains/editor/lib/wikilinks'
import type { ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import type {
  AppShellCosmosViewModel,
  AppShellAltersViewModel,
  AppShellLaunchpadViewModel,
  AppShellSecondBrainViewModel
} from '../../lib/appShellViewModels'
import {
  collectPaneIds,
  computeSplitRatio,
  createSplitDragState,
  getPaneGridPosition,
  type SplitDragState
} from './editorPaneGridLayout'

export type EditorPaneGridExposed = {
  saveNow: () => Promise<void>
  reloadCurrent: () => Promise<void>
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => Promise<void>
  focusEditor: () => void
  focusFirstContentBlock: () => void
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

type EditorViewExposed = EditorPaneGridExposed

const props = defineProps<{
  layout: MultiPaneLayout
  activeDocumentPath: string
  getStatus: (path: string) => FileEditorStatus
  openFile?: (path: string) => Promise<string>
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
  cosmos: AppShellCosmosViewModel
  alters: AppShellAltersViewModel
  secondBrain: AppShellSecondBrainViewModel
  launchpad: AppShellLaunchpadViewModel
}>()

const emit = defineEmits<{
  'pane-focus': [payload: { paneId: string }]
  'pane-tab-click': [payload: { paneId: string; tabId: string }]
  'pane-tab-close': [payload: { paneId: string; tabId: string }]
  'pane-tab-close-others': [payload: { paneId: string; tabId: string }]
  'pane-tab-close-all': [payload: { paneId: string }]
  'pane-request-move-tab': [payload: { paneId: string; direction: 'next' | 'previous' }]
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string }]
  'path-renamed': [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: Array<{ level: 1 | 2 | 3; text: string }>]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
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
  'alter-open-second-brain': [alterId: string]
}>()

// Keep instance refs out of Vue reactivity to avoid render-feedback loops.
const editorRefs: Record<string, EditorViewExposed | null> = {}

const gridRoot = ref<HTMLElement | null>(null)

const paneList = computed<PaneState[]>(() => {
  const ids = listPaneIds(props.layout.root)
  return ids
    .map((id) => props.layout.panesById[id])
    .filter((pane): pane is PaneState => Boolean(pane))
})

const columnSplitRatio = ref(50)
const rowSplitRatio = ref(50)
const RESIZER_TRACK_PX = 6
const MIN_RATIO = 20
const MAX_RATIO = 80

const dragState = ref<SplitDragState | null>(null)

const hasColumnSplit = computed(() => paneList.value.length >= 2)
const hasRowSplit = computed(() => paneList.value.length >= 3)

const gridColumns = computed(() => {
  if (!hasColumnSplit.value) return '1fr'
  const a = `${columnSplitRatio.value}%`
  const b = `${100 - columnSplitRatio.value}%`
  return `${a} ${RESIZER_TRACK_PX}px ${b}`
})

const gridRows = computed(() => {
  if (!hasRowSplit.value) return '1fr'
  const a = `${rowSplitRatio.value}%`
  const b = `${100 - rowSplitRatio.value}%`
  return `${a} ${RESIZER_TRACK_PX}px ${b}`
})

function listPaneIds(node: MultiPaneLayout['root']): string[] {
  return collectPaneIds(node)
}

function paneGridPosition(index: number): { gridColumn: string; gridRow: string } {
  return getPaneGridPosition(index, hasColumnSplit.value, hasRowSplit.value)
}

function paneActiveTab(pane: PaneState): PaneTab | null {
  if (!pane.activeTabId) return null
  return pane.openTabs.find((tab) => tab.id === pane.activeTabId) ?? null
}

function paneDocumentPaths(pane: PaneState): string[] {
  return pane.openTabs
    .filter((tab): tab is Extract<PaneTab, { type: 'document' }> => tab.type === 'document')
    .map((tab) => tab.path)
}

function onResizerPointerDown(axis: 'column' | 'row', event: PointerEvent) {
  event.preventDefault()
  dragState.value = createSplitDragState(
    axis,
    axis === 'column' ? event.clientX : event.clientY,
    axis === 'column' ? columnSplitRatio.value : rowSplitRatio.value
  )
  window.addEventListener('pointermove', onResizerPointerMove)
  window.addEventListener('pointerup', onResizerPointerUp)
}

function onResizerPointerMove(event: PointerEvent) {
  const drag = dragState.value
  if (!drag) return
  const grid = gridRoot.value
  if (!grid) return
  const rect = grid.getBoundingClientRect()
  const size = drag.axis === 'column' ? rect.width : rect.height
  const next = computeSplitRatio(
    drag,
    drag.axis === 'column' ? event.clientX : event.clientY,
    size,
    RESIZER_TRACK_PX,
    MIN_RATIO,
    MAX_RATIO
  )
  if (drag.axis === 'column') {
    columnSplitRatio.value = next
  } else {
    rowSplitRatio.value = next
  }
}

function onResizerPointerUp() {
  dragState.value = null
  window.removeEventListener('pointermove', onResizerPointerMove)
  window.removeEventListener('pointerup', onResizerPointerUp)
}

function setEditorRef(paneId: string, instance: unknown) {
  editorRefs[paneId] = (instance as EditorViewExposed | null) ?? null
}

function activeEditor(): EditorViewExposed | null {
  return editorRefs[props.layout.activePaneId] ?? null
}

function ensureCall<T>(fn: ((editor: EditorViewExposed) => T), fallback: T): T {
  const editor = activeEditor()
  if (!editor) return fallback
  return fn(editor)
}

async function saveNow() {
  await ensureCall((editor) => editor.saveNow(), Promise.resolve())
}

async function reloadCurrent() {
  await ensureCall((editor) => editor.reloadCurrent(), Promise.resolve())
}

async function applyWorkspaceFsChanges(changes: WorkspaceFsChange[]) {
  for (const editor of Object.values(editorRefs)) {
    if (!editor) continue
    await editor.applyWorkspaceFsChanges(changes)
  }
}

function focusEditor() {
  ensureCall((editor) => editor.focusEditor(), undefined)
}

function focusFirstContentBlock() {
  ensureCall((editor) => editor.focusFirstContentBlock(), undefined)
}

async function revealSnippet(snippet: string) {
  await ensureCall((editor) => editor.revealSnippet(snippet), Promise.resolve())
}

async function revealOutlineHeading(index: number) {
  await ensureCall((editor) => editor.revealOutlineHeading(index), Promise.resolve())
}

async function revealAnchor(anchor: WikilinkAnchor): Promise<boolean> {
  return await ensureCall((editor) => editor.revealAnchor(anchor), Promise.resolve(false))
}

function zoomIn() {
  return ensureCall((editor) => editor.zoomIn(), 1)
}

function zoomOut() {
  return ensureCall((editor) => editor.zoomOut(), 1)
}

function resetZoom() {
  return ensureCall((editor) => editor.resetZoom(), 1)
}

function getZoom() {
  return ensureCall((editor) => editor.getZoom(), 1)
}

function resetCosmosView() {
  ensureCall((editor) => editor.resetCosmosView(), undefined)
}

function focusCosmosNodeById(nodeId: string): boolean {
  return ensureCall((editor) => editor.focusCosmosNodeById(nodeId), false)
}

defineExpose<EditorPaneGridExposed>({
  saveNow,
  reloadCurrent,
  applyWorkspaceFsChanges,
  focusEditor,
  focusFirstContentBlock,
  revealSnippet,
  revealOutlineHeading,
  revealAnchor,
  zoomIn,
  zoomOut,
  resetZoom,
  getZoom,
  resetCosmosView,
  focusCosmosNodeById
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onResizerPointerMove)
  window.removeEventListener('pointerup', onResizerPointerUp)
})
</script>

<template>
  <div
    ref="gridRoot"
    class="pane-grid"
    :style="{ gridTemplateColumns: gridColumns, gridTemplateRows: gridRows }"
  >
    <section
      v-for="(pane, index) in paneList"
      :key="pane.id"
      class="editor-pane"
      :class="{ 'editor-pane-active': pane.id === layout.activePaneId }"
      :style="paneGridPosition(index)"
      @pointerdown.capture="emit('pane-focus', { paneId: pane.id })"
      @focusin.capture="emit('pane-focus', { paneId: pane.id })"
    >
      <EditorPaneTabs
        :pane="pane"
        :is-active-pane="pane.id === layout.activePaneId"
        :get-status="getStatus"
        @pane-focus="emit('pane-focus', $event)"
        @tab-click="emit('pane-tab-click', $event)"
        @tab-close="emit('pane-tab-close', $event)"
        @tab-close-others="emit('pane-tab-close-others', $event)"
        @tab-close-all="emit('pane-tab-close-all', $event)"
        @request-move-tab="emit('pane-request-move-tab', $event)"
      />

      <PaneSurfaceHost
        :ref="(instance: unknown) => setEditorRef(pane.id, instance)"
        :pane-id="pane.id"
        :active-tab="paneActiveTab(pane)"
        :open-tabs="pane.openTabs"
        :open-document-paths="paneDocumentPaths(pane)"
        :active-document-path="activeDocumentPath"
        :launchpad="{
          showExperience: pane.id === layout.activePaneId,
          mode: secondBrain.workspacePath ? 'workspace-launchpad' : 'no-workspace',
          workspaceLabel: launchpad.workspaceLabel,
          recentWorkspaces: launchpad.recentWorkspaces,
          recentViewedNotes: launchpad.recentViewedNotes,
          recentUpdatedNotes: launchpad.recentUpdatedNotes,
          showWizardAction: launchpad.showWizardAction
        }"
        :cosmos="cosmos"
        :alters="alters"
        :second-brain="secondBrain"
        :get-status="getStatus"
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
        @status="emit('status', $event)"
        @path-renamed="emit('path-renamed', $event)"
        @outline="emit('outline', $event)"
        @properties="emit('properties', $event)"
        @pulse-open-second-brain="emit('pulse-open-second-brain', $event)"
        @external-reload="emit('external-reload', $event)"
        @cosmos-query-update="emit('cosmos-query-update', $event)"
        @cosmos-search-enter="emit('cosmos-search-enter')"
        @cosmos-select-match="emit('cosmos-select-match', $event)"
        @cosmos-toggle-focus-mode="emit('cosmos-toggle-focus-mode', $event)"
        @cosmos-toggle-semantic-edges="emit('cosmos-toggle-semantic-edges', $event)"
        @cosmos-expand-neighborhood="emit('cosmos-expand-neighborhood')"
        @cosmos-jump-related="emit('cosmos-jump-related', $event)"
        @cosmos-open-selected="emit('cosmos-open-selected')"
        @cosmos-locate-selected="emit('cosmos-locate-selected')"
        @cosmos-reset-view="emit('cosmos-reset-view')"
        @cosmos-select-node="emit('cosmos-select-node', $event)"
        @cosmos-add-to-context="emit('cosmos-add-to-context', $event)"
        @open-note="emit('open-note', $event)"
        @launchpad-open-workspace="emit('launchpad-open-workspace')"
        @launchpad-open-wizard="emit('launchpad-open-wizard')"
        @launchpad-open-command-palette="emit('launchpad-open-command-palette')"
        @launchpad-open-shortcuts="emit('launchpad-open-shortcuts')"
        @launchpad-open-recent-workspace="emit('launchpad-open-recent-workspace', $event)"
        @launchpad-open-today="emit('launchpad-open-today')"
        @launchpad-open-quick-open="emit('launchpad-open-quick-open')"
        @launchpad-create-note="emit('launchpad-create-note')"
        @launchpad-open-recent-note="emit('launchpad-open-recent-note', $event)"
        @launchpad-quick-start="emit('launchpad-quick-start', $event)"
        @second-brain-context-changed="emit('second-brain-context-changed', $event)"
        @second-brain-session-changed="emit('second-brain-session-changed', $event)"
        @alter-open-second-brain="emit('alter-open-second-brain', $event)"
      />
    </section>

    <div
      v-if="hasColumnSplit"
      class="pane-resizer pane-resizer-col"
      :style="{ gridColumn: '2', gridRow: hasRowSplit ? '1 / 4' : '1' }"
      @pointerdown="onResizerPointerDown('column', $event)"
    ></div>

    <div
      v-if="hasRowSplit"
      class="pane-resizer pane-resizer-row"
      :style="{ gridColumn: '1 / 4', gridRow: '2' }"
      @pointerdown="onResizerPointerDown('row', $event)"
    ></div>
  </div>
</template>

<style scoped>
.pane-grid {
  width: 100%;
  height: 100%;
  display: grid;
  gap: 0;
  padding: 2px;
  box-sizing: border-box;
  background: transparent;
}

.editor-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--workspace-pane-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--workspace-pane-bg);
}

.pane-resizer {
  position: relative;
  z-index: 15;
  background: transparent;
}

.pane-resizer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--shell-chrome-bg);
}

.pane-resizer-col {
  cursor: col-resize;
}

.pane-resizer-row {
  cursor: row-resize;
}

.editor-pane-active {
  border-color: var(--workspace-pane-active-border);
  box-shadow: 0 0 0 1px var(--workspace-pane-active-shadow);
}

.editor-pane :deep(.editor-shell) {
  flex: 1;
  min-height: 0;
}
</style>
