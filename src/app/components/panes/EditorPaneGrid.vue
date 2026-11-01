<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { DnDProvider } from '@vue-dnd-kit/core'
import EditorPaneTabs, { type FileEditorStatus } from './EditorPaneTabs.vue'
import PaneSurfaceHost from './PaneSurfaceHost.vue'
import type { MultiPaneLayout, PaneState, PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import type { DocumentSession } from '../../../domains/editor/composables/useDocumentEditorSessions'
import type { WikilinkAnchor } from '../../../domains/editor/lib/wikilinks'
import type { ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import type {
  EditorSignalDirection,
  EditorSignalKind,
  EditorSignalSummary
} from '../../../domains/editor/lib/editorSignals'
import type { AppShellLaunchpadViewModel } from '../../lib/appShellViewModels'
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
  openNoteHistory: () => Promise<void>
  isActiveEditorSourceSurface: () => boolean
  setActiveMarkdownSourceMode: (enabled: boolean) => Promise<void>
  revealSnippet: (snippet: string) => Promise<boolean>
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
  saveOpenDocument: (path: string) => Promise<boolean>
  /** Scroll offset of a pane's editor surface, 0 when it is not mounted. */
  getPaneScrollTop: (paneId: string) => number
  /** Applies a scroll offset once the pane's surface is ready. */
  setPaneScrollTop: (paneId: string, value: number) => Promise<boolean>
}

type EditorViewExposed = {
  saveNow: () => Promise<void>
  reloadCurrent: () => Promise<void>
  applyWorkspaceFsChanges: (changes: WorkspaceFsChange[]) => Promise<void>
  focusEditor: () => void
  openNoteHistory: () => Promise<void>
  revealSnippet: (snippet: string) => Promise<boolean>
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
  isSourceSurface: () => boolean
  setMarkdownSourceSurfaceEnabled: (enabled: boolean) => Promise<void>
  saveOpenDocument: (path: string) => Promise<boolean>
  getScrollTop: () => number
  setScrollTop: (value: number) => boolean
}

const props = defineProps<{
  layout: MultiPaneLayout
  activeDocumentPath: string
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
  workspacePath: string
  launchpad: AppShellLaunchpadViewModel
}>()

const emit = defineEmits<{
  'pane-focus': [payload: { paneId: string }]
  'pane-tab-click': [payload: { paneId: string; tabId: string }]
  'pane-tab-close': [payload: { paneId: string; tabId: string }]
  'pane-tab-close-others': [payload: { paneId: string; tabId: string }]
  'pane-tab-close-left': [payload: { paneId: string; tabId: string }]
  'pane-tab-close-right': [payload: { paneId: string; tabId: string }]
  'pane-tab-close-all': [payload: { paneId: string }]
  'pane-tab-close-unpinned': [payload: { paneId: string }]
  'pane-tab-pin': [payload: { paneId: string; tabId: string; pinned: boolean }]
  'pane-tab-lock': [payload: { paneId: string; tabId: string }]
  'pane-tab-move-to-other-pane': [payload: { paneId: string; tabId: string }]
  'pane-tab-copy-link': [payload: { paneId: string; tabId: string }]
  'pane-tab-reveal-in-explorer': [payload: { paneId: string; tabId: string }]
  'pane-tab-reorder': [payload: { paneId: string; tabId: string; targetSlot: number }]
  'pane-tab-drop': [payload: { paneId: string; tabId: string }]
  'pane-create-note': [payload: { paneId: string }]
  'pane-request-move-tab': [payload: { paneId: string; direction: 'next' | 'previous' }]
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string }]
  'path-renamed': [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: Array<{ level: 1 | 2 | 3; text: string }>]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
  'signal-summary': [payload: { paneId: string; summary: EditorSignalSummary }]
  'external-reload': [payload: { path: string }]
  'breadcrumb-action': [payload: { kind: 'folder' | 'document'; path: string; action: 'reveal-in-explorer' | 'reveal-in-file-manager' | 'copy-link' }]
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

/** Document paths open in every pane except the given one, for cross-pane gating. */
function otherPaneDocumentPaths(paneId: string): string[] {
  return paneList.value
    .filter((pane) => pane.id !== paneId)
    .flatMap((pane) => paneDocumentPaths(pane))
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
  const next = (instance as EditorViewExposed | null) ?? null
  if (!next) {
    delete editorRefs[paneId]
    return
  }
  editorRefs[paneId] = next
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

/** Saves the buffer of any open note across panes; false when no pane holds it. */
async function saveOpenDocument(path: string): Promise<boolean> {
  const editors = Object.values(editorRefs).filter((editor) => editor !== null)
  if (!editors.length) return false
  const results = await Promise.all(editors.map((editor) => editor.saveOpenDocument(path)))
  return results.some(Boolean)
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

async function openNoteHistory() {
  await ensureCall((editor) => editor.openNoteHistory(), Promise.resolve())
}

function isActiveEditorSourceSurface(): boolean {
  return Boolean(activeEditor()?.isSourceSurface?.())
}

async function setActiveMarkdownSourceMode(enabled: boolean) {
  await ensureCall((editor) => editor.setMarkdownSourceSurfaceEnabled(enabled), Promise.resolve())
}

async function revealSnippet(snippet: string): Promise<boolean> {
  return await ensureCall((editor) => editor.revealSnippet(snippet), Promise.resolve(false))
}

async function revealOutlineHeading(index: number) {
  await ensureCall((editor) => editor.revealOutlineHeading(index), Promise.resolve())
}

async function revealAnchor(anchor: WikilinkAnchor): Promise<boolean> {
  return await ensureCall((editor) => editor.revealAnchor(anchor), Promise.resolve(false))
}

function navigateSignal(kind: EditorSignalKind, direction: EditorSignalDirection) {
  ensureCall((editor) => editor.navigateSignal(kind, direction), undefined)
}

function getSelectionText() {
  return ensureCall((editor) => editor.getSelectionText(), '')
}

function getSelectionMarkdown() {
  return ensureCall((editor) => editor.getSelectionMarkdown(), '')
}

function extractSelectionToLinkedNote() {
  return ensureCall((editor) => editor.extractSelectionToLinkedNote(), Promise.resolve(false))
}

function transformSelectionToHeading() {
  return ensureCall((editor) => editor.transformSelectionToHeading(), false)
}

function transformSelectionToList() {
  return ensureCall((editor) => editor.transformSelectionToList(), false)
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

function getPaneScrollTop(paneId: string): number {
  return editorRefs[paneId]?.getScrollTop() ?? 0
}

/**
 * Applies a scroll offset to a pane's editor surface.
 *
 * The surface is not mounted while the note loads, so the request is retried
 * across a few frames instead of being dropped.
 */
async function setPaneScrollTop(paneId: string, value: number): Promise<boolean> {
  const editor = editorRefs[paneId]
  if (!editor) return false
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (editor.setScrollTop(value)) return true
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  return false
}

defineExpose<EditorPaneGridExposed>({
  saveNow,
  saveOpenDocument,
  reloadCurrent,
  applyWorkspaceFsChanges,
  focusEditor,
  openNoteHistory,
  isActiveEditorSourceSurface,
  setActiveMarkdownSourceMode,
  revealSnippet,
  revealOutlineHeading,
  revealAnchor,
  navigateSignal,
  getSelectionText,
  getSelectionMarkdown,
  extractSelectionToLinkedNote,
  transformSelectionToHeading,
  transformSelectionToList,
  zoomIn,
  zoomOut,
  resetZoom,
  getZoom,
  getPaneScrollTop,
  setPaneScrollTop,
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onResizerPointerMove)
  window.removeEventListener('pointerup', onResizerPointerUp)
})
</script>

<template>
  <!-- The tab strip registers draggables and droppables, so the grid owns the
       provider. The explorer keeps its own, separate one. -->
  <DnDProvider :auto-scroll-viewport="true" preview-to="body">
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
          :pane-count="paneList.length"
          :other-pane-paths="otherPaneDocumentPaths(pane.id)"
          @pane-focus="emit('pane-focus', $event)"
          @tab-click="emit('pane-tab-click', $event)"
          @tab-close="emit('pane-tab-close', $event)"
          @tab-close-others="emit('pane-tab-close-others', $event)"
          @tab-close-left="emit('pane-tab-close-left', $event)"
          @tab-close-right="emit('pane-tab-close-right', $event)"
          @tab-close-all="emit('pane-tab-close-all', $event)"
          @tab-close-unpinned="emit('pane-tab-close-unpinned', $event)"
          @tab-pin="emit('pane-tab-pin', $event)"
          @tab-lock="emit('pane-tab-lock', $event)"
          @tab-move-to-other-pane="emit('pane-tab-move-to-other-pane', $event)"
          @tab-copy-link="emit('pane-tab-copy-link', $event)"
          @tab-reveal-in-explorer="emit('pane-tab-reveal-in-explorer', $event)"
          @tab-reorder="emit('pane-tab-reorder', $event)"
          @tab-drop="emit('pane-tab-drop', $event)"
          @create-note="emit('pane-create-note', $event)"
          @request-move-tab="emit('pane-request-move-tab', $event)"
        />

        <PaneSurfaceHost
          :ref="(instance: unknown) => setEditorRef(pane.id, instance)"
          :pane-id="pane.id"
          :is-active-pane="pane.id === layout.activePaneId"
          :active-tab="paneActiveTab(pane)"
          :open-tabs="pane.openTabs"
          :open-document-paths="paneDocumentPaths(pane)"
          :all-workspace-files="allWorkspaceFiles"
          :active-document-path="activeDocumentPath"
          :open-externally="openExternally"
          :launchpad="{
            showExperience: pane.id === layout.activePaneId,
            mode: workspacePath ? 'workspace-launchpad' : 'no-workspace',
            workspaceLabel: launchpad.workspaceLabel,
            recentWorkspaces: launchpad.recentWorkspaces,
            recentViewedNotes: launchpad.recentViewedNotes,
            recentUpdatedNotes: launchpad.recentUpdatedNotes,
            showWizardAction: launchpad.showWizardAction
          }"
          :workspace-path="workspacePath"
          :get-status="getStatus"
          :open-file="openFile"
          :save-file="saveFile"
          :read-note-snapshot="readNoteSnapshot"
          :save-note-buffer="saveNoteBuffer"
          :rename-file-from-title="renameFileFromTitle"
          :load-link-targets="loadLinkTargets"
          :load-link-headings="loadLinkHeadings"
          :load-property-type-schema="loadPropertyTypeSchema"
          :save-property-type-schema="savePropertyTypeSchema"
          :open-link-target="openLinkTarget"
          :spellcheck-enabled="spellcheckEnabled"
          :ruler-visible="rulerVisible"
          :cursor-style="cursorStyle"
          :cursor-blink="cursorBlink"
          @status="emit('status', $event)"
          @path-renamed="emit('path-renamed', $event)"
          @outline="emit('outline', $event)"
          @properties="emit('properties', $event)"
          @signal-summary="emit('signal-summary', { paneId: pane.id, summary: $event })"
          @external-reload="emit('external-reload', $event)"
          @breadcrumb-action="emit('breadcrumb-action', $event)"
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
  </DnDProvider>
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
