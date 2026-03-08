<script setup lang="ts">
import { computed, ref, type Ref } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { DragHandle as DragHandleVue3 } from '@tiptap/extension-drag-handle-vue-3'
import { openExternalUrl } from '../../../shared/api/workspaceApi'
import type { PulseActionId } from '../../../shared/api/apiTypes'
import { PULSE_ACTIONS_BY_SOURCE, type PulseApplyMode } from '../../pulse/lib/pulse'
import type { DocumentSession } from '../composables/useDocumentEditorSessions'
import { hasPendingHeavyRender, waitForHeavyRenderIdle } from '../lib/tiptap/renderStabilizer'
import { useEditorChromeRuntime } from '../composables/useEditorChromeRuntime'
import { useEditorDocumentRuntime } from '../composables/useEditorDocumentRuntime'
import { useEditorInteractionRuntime } from '../composables/useEditorInteractionRuntime'
import EditorContextOverlays from './editor/EditorContextOverlays.vue'
import EditorFindToolbar from './editor/EditorFindToolbar.vue'
import EditorInlineFormatToolbar from './editor/EditorInlineFormatToolbar.vue'
import EditorLargeDocOverlay from './editor/EditorLargeDocOverlay.vue'
import EditorMermaidReplaceDialog from './editor/EditorMermaidReplaceDialog.vue'
import EditorPropertiesPanel from './editor/EditorPropertiesPanel.vue'
import EditorSlashOverlay from './editor/EditorSlashOverlay.vue'
import EditorTableEdgeControls from './editor/EditorTableEdgeControls.vue'
import EditorTitleField from './editor/EditorTitleField.vue'
import EditorWikilinkOverlay from './editor/EditorWikilinkOverlay.vue'
import PulsePanel from '../../pulse/components/PulsePanel.vue'
import './editor/EditorViewContent.css'

type HeadingNode = { text: string; level: number; id?: string }
type CorePropertyOption = { key: string; label?: string; description?: string }

const CORE_PROPERTY_OPTIONS: CorePropertyOption[] = [
  { key: 'tags', label: 'tags', description: 'Tag list' },
  { key: 'aliases', label: 'aliases', description: 'Alternative names' },
  { key: 'cssclasses', label: 'cssclasses', description: 'Note CSS classes' },
  { key: 'date', label: 'date', description: 'Primary date (YYYY-MM-DD)' },
  { key: 'deadline', label: 'deadline', description: 'Due date (YYYY-MM-DD)' },
  { key: 'archive', label: 'archive', description: 'Archive flag' },
  { key: 'published', label: 'published', description: 'Publish flag' }
]

const props = defineProps<{
  path: string
  workspacePath?: string
  openPaths?: string[]
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
}>()

const emit = defineEmits([
  'status',
  'path-renamed',
  'outline',
  'properties',
  'pulse-open-second-brain'
])

function emitStatus(payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) {
  emit('status', payload)
}

function emitPathRenamed(payload: { from: string; to: string; manual: boolean }) {
  emit('path-renamed', payload)
}

function emitOutline(payload: HeadingNode[]) {
  emit('outline', payload)
}

function emitProperties(payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }) {
  emit('properties', payload)
}

function emitPulseOpenSecondBrain(payload: { contextPaths: string[]; prompt?: string }) {
  emit('pulse-open-second-brain', payload)
}

const holder = ref<HTMLDivElement | null>(null)
const contentShell = ref<HTMLDivElement | null>(null)
const pulsePanelWrap = ref<HTMLDivElement | null>(null)
const activeEditor = ref<Editor | null>(null) as Ref<Editor | null>
const pathRef = computed(() => props.path ?? '')
const openPathsRef = computed(() => props.openPaths ?? [])
const currentPathSource = computed(() => props.path?.trim() || '')

let getSession: (path: string) => DocumentSession | null = () => null
let saveCurrentFileInternal: (manual?: boolean) => Promise<void> = async () => {}
let onEditorDocChangedInternal: (path: string) => void = () => {}
let closeSlashMenuInternal = () => {}
let dismissSlashMenuInternal = () => {}
let closeWikilinkMenuInternal = () => {}
let openSlashAtSelectionInternal = () => {}
let currentTextSelectionContextInternal: () => { text: string; nodeType: string; from: number; to: number } | null = () => null
let insertBlockFromDescriptorInternal: (
  type: string,
  data: Record<string, unknown>,
  options?: { replaceRange?: { from: number; to: number } | null }
) => boolean = () => false
let onEditorKeydownInternal = (_event: KeyboardEvent) => {}
let onEditorKeyupInternal = () => {}
let onEditorContextMenuInternal = (_event: MouseEvent) => {}
let onEditorPasteInternal = (_event: ClipboardEvent) => {}
let markEditorInteractionInternal = () => {}
let resetWikilinkDataCacheInternal = () => {}

const chromeRuntime = useEditorChromeRuntime({
  hostPort: {
    holder,
    contentShell,
    pulsePanelWrap,
    currentPath: currentPathSource,
    activeEditor,
    getSession: (path) => getSession(path)
  },
  interactionPort: {
    closeSlashMenu: () => closeSlashMenuInternal(),
    dismissSlashMenu: () => dismissSlashMenuInternal(),
    closeWikilinkMenu: () => closeWikilinkMenuInternal(),
    openSlashAtSelection: () => openSlashAtSelectionInternal(),
    currentTextSelectionContext: () => currentTextSelectionContextInternal(),
    insertBlockFromDescriptor: (type, data, options) => insertBlockFromDescriptorInternal(type, data, options),
    onEditorKeydown: (event) => onEditorKeydownInternal(event),
    onEditorKeyup: () => onEditorKeyupInternal(),
    onEditorContextMenu: (event) => onEditorContextMenuInternal(event),
    onEditorPaste: (event) => onEditorPasteInternal(event),
    markEditorInteraction: () => markEditorInteractionInternal(),
    resetWikilinkDataCache: () => resetWikilinkDataCacheInternal()
  },
  emitPort: {
    emitPulseOpenSecondBrain
  }
})

const interactionRuntime = useEditorInteractionRuntime({
  documentPort: {
    currentPath: currentPathSource,
    holder,
    activeEditor,
    getSession: (path) => getSession(path),
    saveCurrentFile: (manual) => saveCurrentFileInternal(manual),
    onEditorDocChanged: (path) => onEditorDocChangedInternal(path)
  },
  chromePort: {
    blockMenuOpen: chromeRuntime.blockMenuOpen,
    tableToolbarOpen: chromeRuntime.tableToolbarOpen,
    isDragMenuOpen: () => chromeRuntime.dragHandleUiState.value.menuOpen,
    closeBlockMenu: () => chromeRuntime.closeBlockMenu(),
    hideTableToolbar: () => chromeRuntime.hideTableToolbar(),
    updateFormattingToolbar: () => chromeRuntime.updateFormattingToolbar(),
    updateTableToolbar: () => chromeRuntime.updateTableToolbar(),
    zoomEditorBy: (delta) => chromeRuntime.zoomEditorBy(delta),
    resetEditorZoom: () => chromeRuntime.resetEditorZoom(),
    inlineFormatToolbar: {
      updateFormattingToolbar: chromeRuntime.inlineFormatToolbar.updateFormattingToolbar,
      openLinkPopover: chromeRuntime.inlineFormatToolbar.openLinkPopover,
      linkPopoverOpen: chromeRuntime.inlineFormatToolbar.linkPopoverOpen,
      cancelLink: chromeRuntime.inlineFormatToolbar.cancelLink
    }
  },
  ioPort: {
    loadLinkTargets: props.loadLinkTargets,
    loadLinkHeadings: props.loadLinkHeadings,
    openLinkTarget: props.openLinkTarget,
    openExternalUrl
  },
  emitPort: {
    emitOutline
  },
  requestMermaidReplaceConfirm: chromeRuntime.requestMermaidReplaceConfirm
})

closeSlashMenuInternal = interactionRuntime.closeSlashMenu
dismissSlashMenuInternal = interactionRuntime.dismissSlashMenu
closeWikilinkMenuInternal = interactionRuntime.closeWikilinkMenu
openSlashAtSelectionInternal = interactionRuntime.openSlashAtSelection
currentTextSelectionContextInternal = interactionRuntime.currentTextSelectionContext
insertBlockFromDescriptorInternal = interactionRuntime.insertBlockFromDescriptor
onEditorKeydownInternal = interactionRuntime.onEditorKeydown
onEditorKeyupInternal = interactionRuntime.onEditorKeyup
onEditorContextMenuInternal = interactionRuntime.onEditorContextMenu
onEditorPasteInternal = interactionRuntime.onEditorPaste
markEditorInteractionInternal = interactionRuntime.markEditorInteraction
resetWikilinkDataCacheInternal = interactionRuntime.resetWikilinkDataCache

const documentRuntime = useEditorDocumentRuntime({
  propsPort: {
    path: pathRef,
    openPaths: openPathsRef,
    openFile: props.openFile,
    saveFile: props.saveFile,
    renameFileFromTitle: props.renameFileFromTitle,
    loadPropertyTypeSchema: props.loadPropertyTypeSchema,
    savePropertyTypeSchema: props.savePropertyTypeSchema
  },
  emitPort: {
    emitStatus,
    emitOutline,
    emitProperties,
    emitPathRenamed
  },
  sessionPort: {
    holder,
    activeEditor,
    isEditingTitle: () => chromeRuntime.titleEditorFocused.value,
    createSessionEditor: interactionRuntime.createSessionEditor
  },
  interactionPort: {
    captureCaret: interactionRuntime.captureCaret,
    restoreCaret: interactionRuntime.restoreCaret,
    clearOutlineTimer: interactionRuntime.clearOutlineTimer,
    emitOutlineSoon: interactionRuntime.emitOutlineSoon,
    closeSlashMenu: interactionRuntime.closeSlashMenu,
    closeWikilinkMenu: interactionRuntime.closeWikilinkMenu,
    syncWikilinkUiFromPluginState: interactionRuntime.syncWikilinkUiFromPluginState
  },
  chromePort: {
    largeDocThreshold: chromeRuntime.largeDocThreshold,
    loadUiState: chromeRuntime.loadUiState,
    resetTransientUiState: chromeRuntime.resetTransientUiState,
    updateGutterHitboxStyle: chromeRuntime.updateGutterHitboxStyle,
    hideTableToolbarAnchor: chromeRuntime.hideTableToolbarAnchor,
    closeBlockMenu: chromeRuntime.closeBlockMenu,
    onActiveSessionChanged: chromeRuntime.onActiveSessionChanged,
    onDocumentContentChanged: chromeRuntime.onDocumentContentChanged,
    onMountInit: chromeRuntime.onMountInit,
    onUnmountCleanup: chromeRuntime.onUnmountCleanup
  },
  waitForHeavyRenderIdle,
  hasPendingHeavyRender
})

getSession = documentRuntime.getSession
saveCurrentFileInternal = documentRuntime.saveCurrentFile
onEditorDocChangedInternal = documentRuntime.onEditorDocChanged

const currentPath = documentRuntime.currentPath
const currentTitle = documentRuntime.currentTitle
const renderPaths = documentRuntime.renderPaths
const renderedEditorsByPath = documentRuntime.renderedEditorsByPath
const isActiveMountedPath = documentRuntime.isActiveMountedPath
const getZoom = chromeRuntime.getZoom
const onTitleInput = documentRuntime.onTitleInput
const onTitleCommit = documentRuntime.onTitleCommit
const focusEditor = chromeRuntime.focusEditor
// Kept as local bindings so Pulse contract tests can reach them through setupState
// without reintroducing a broader public API on the component itself.
const setPulseInstruction = chromeRuntime.setPulseInstruction
const pulseSelectionRange = chromeRuntime.pulseSelectionRange
void setPulseInstruction
void pulseSelectionRange
const {
  propertyEditorMode,
  activeParseErrors,
  activeRawYaml,
  canUseStructuredProperties,
  structuredPropertyFields,
  structuredPropertyKeys,
  addPropertyField,
  removePropertyField,
  onPropertyTypeChange,
  onPropertyKeyInput,
  onPropertyValueInput,
  onPropertyCheckboxInput,
  onPropertyTokensChange,
  effectiveTypeForField,
  isPropertyTypeLocked,
  propertiesExpanded,
  togglePropertiesVisibility,
  onRawYamlInput,
  isLoadingLargeDocument,
  loadStageLabel,
  loadProgressPercent,
  loadProgressIndeterminate,
  loadDocumentStats
} = documentRuntime
const {
  titleEditorFocused,
  pulse,
  pulseOpen,
  pulseSourceKind,
  pulseActionId,
  pulseInstruction,
  pulseSourceText,
  mermaidReplaceDialog,
  resolveMermaidReplaceDialog,
  pulsePanelStyle,
  renderedEditor,
  blockMenuFloatingEl,
  tableToolbarFloatingEl,
  blockMenuPos,
  tableMenuBtnLeft,
  tableMenuBtnTop,
  tableBoxLeft,
  tableBoxTop,
  tableBoxWidth,
  tableBoxHeight,
  tableToolbarViewportLeft,
  tableToolbarViewportTop,
  tableToolbarViewportMaxHeight,
  dragHandleUiState,
  computedDragLock,
  debugTargetPos,
  DRAG_HANDLE_PLUGIN_KEY,
  DRAG_HANDLE_DEBUG,
  TABLE_MARKDOWN_MODE,
  dragHandleComputePositionConfig,
  inlineFormatToolbar,
  findToolbar,
  blockMenuOpen,
  blockMenuIndex,
  blockMenuActions,
  blockMenuConvertActions,
  closeBlockMenu,
  toggleBlockMenu,
  onBlockMenuPlus,
  onBlockMenuSelect,
  onBlockHandleNodeChange,
  onHandleControlsEnter,
  onHandleControlsLeave,
  onHandleDragStart,
  onHandleDragEnd,
  tableToolbarTriggerVisible,
  tableAddTopVisible,
  tableAddBottomVisible,
  tableAddLeftVisible,
  tableAddRightVisible,
  tableToolbarOpen,
  tableToolbarActions,
  hideTableToolbar,
  onTableToolbarSelect,
  toggleTableToolbar,
  addRowAfterFromTrigger,
  addRowBeforeFromTrigger,
  addColumnBeforeFromTrigger,
  addColumnAfterFromTrigger,
  onEditorMouseMove,
  onEditorMouseLeave,
  editorZoomStyle,
  zoomEditorBy,
  resetEditorZoom,
  gutterHitboxStyle,
  onInlineToolbarCopyAs,
  onPulseActionChange,
  onPulseInstructionChange,
  runPulseFromEditor,
  closePulsePanel,
  openPulseForSelection,
  replaceSelectionWithPulseOutput,
  insertPulseBelow,
  sendPulseContextToSecondBrain
} = chromeRuntime
const {
  slashOpen,
  slashIndex,
  slashLeft,
  slashTop,
  slashQuery,
  visibleSlashCommands,
  closeWikilinkMenu,
  dismissSlashMenu,
  setSlashQuery,
  insertBlockFromDescriptor,
  wikilinkOpen,
  wikilinkIndex,
  wikilinkLeft,
  wikilinkTop,
  wikilinkResults,
  onWikilinkMenuSelect,
  onWikilinkMenuIndexUpdate,
  revealSnippet,
  revealOutlineHeading,
  revealAnchor
} = interactionRuntime

async function focusFirstContentBlock() {
  const editor = activeEditor.value
  if (!editor) return
  let targetPos = 1
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      targetPos = pos + 1
      return false
    }
  })
  editor.chain().focus().setTextSelection(targetPos).run()
}

defineExpose({
  saveNow: async () => {
    await documentRuntime.saveCurrentFile(true)
  },
  reloadCurrent: async () => {
    if (!currentPath.value) return
    const requestId = documentRuntime.nextRequestId()
    documentRuntime.ensureSession(currentPath.value)
    documentRuntime.setActiveSession(currentPath.value)
    await documentRuntime.loadCurrentFile(currentPath.value, { forceReload: true, requestId })
  },
  focusEditor: chromeRuntime.focusEditor,
  focusFirstContentBlock,
  revealSnippet,
  revealOutlineHeading,
  revealAnchor,
  zoomIn: () => zoomEditorBy(0.1),
  zoomOut: () => zoomEditorBy(-0.1),
  resetZoom: () => resetEditorZoom(),
  getZoom,
  pulseOpen: chromeRuntime.pulseOpen,
  pulseSourceKind: chromeRuntime.pulseSourceKind,
  pulseActionId: chromeRuntime.pulseActionId,
  pulseSourceText: chromeRuntime.pulseSourceText,
  pulseSelectionRange: chromeRuntime.pulseSelectionRange,
  setPulseInstruction: chromeRuntime.setPulseInstruction
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="!path"
      class="editor-empty-state flex min-h-0 flex-1 items-center justify-center px-8 py-6 text-sm"
    >
      Open a file to start editing
    </div>

    <div v-else class="editor-shell flex min-h-0 flex-1 flex-col overflow-hidden border-x">
      <div
        class="relative min-h-0 flex-1 overflow-hidden"
        :data-drag-lock="computedDragLock ? 'true' : 'false'"
        :data-menu-open="dragHandleUiState.menuOpen ? 'true' : 'false'"
        :data-gutter-hover="dragHandleUiState.gutterHover ? 'true' : 'false'"
        :data-controls-hover="dragHandleUiState.controlsHover ? 'true' : 'false'"
        :data-target-pos="debugTargetPos"
      >
        <div
          v-if="DRAG_HANDLE_DEBUG"
          class="pointer-events-none absolute right-2 top-2 z-50 rounded bg-slate-900/80 px-2 py-1 text-[11px] text-white"
        >
          lock={{ computedDragLock }} menu={{ dragHandleUiState.menuOpen }} gutter={{ dragHandleUiState.gutterHover }} controls={{ dragHandleUiState.controlsHover }} drag={{ dragHandleUiState.dragging }} target={{ debugTargetPos }}
        </div>
        <div
          class="editor-gutter-hitbox"
          :style="gutterHitboxStyle"
        />
        <div
          ref="holder"
          class="editor-holder relative h-full min-h-0 overflow-y-auto px-8 py-6"
          :style="editorZoomStyle"
          @mousemove="onEditorMouseMove"
          @mouseleave="onEditorMouseLeave"
          @click="dismissSlashMenu(); closeWikilinkMenu(); closeBlockMenu()"
        >
          <div ref="contentShell" class="editor-content-shell">
            <div class="editor-header-shell">
              <EditorTitleField
                :model-value="currentTitle"
                :saving="Boolean(currentPath && getSession(currentPath)?.saving)"
                @update:model-value="onTitleInput"
                @commit="onTitleCommit"
                @focus="titleEditorFocused = true"
                @blur="titleEditorFocused = false"
                @focus-body-request="focusEditor()"
              />
              <EditorPropertiesPanel
                :expanded="propertiesExpanded(path)"
                :has-properties="structuredPropertyKeys.length > 0 || activeParseErrors.length > 0"
                :mode="propertyEditorMode"
                :can-use-structured-properties="canUseStructuredProperties"
                :structured-property-fields="structuredPropertyFields"
                :structured-property-keys="structuredPropertyKeys"
                :active-raw-yaml="activeRawYaml"
                :active-parse-errors="activeParseErrors"
                :core-property-options="CORE_PROPERTY_OPTIONS"
                :effective-type-for-field="effectiveTypeForField"
                :is-property-type-locked="isPropertyTypeLocked"
                @toggle-visibility="togglePropertiesVisibility"
                @set-mode="propertyEditorMode = $event"
                @property-key-input="void onPropertyKeyInput($event.index, $event.value)"
                @property-type-change="void onPropertyTypeChange($event.index, $event.value)"
                @property-value-input="onPropertyValueInput($event.index, $event.value)"
                @property-checkbox-input="onPropertyCheckboxInput($event.index, $event.checked)"
                @property-tokens-change="onPropertyTokensChange($event.index, $event.tokens)"
                @remove-property="removePropertyField($event)"
                @add-property="addPropertyField($event)"
                @raw-yaml-input="onRawYamlInput($event)"
              />
            </div>
            <div
              v-for="sessionPath in renderPaths"
              :key="`editor-pane:${sessionPath}`"
              class="editor-session-pane"
              :data-session-path="sessionPath"
              :data-active="isActiveMountedPath(sessionPath) ? 'true' : 'false'"
              :aria-hidden="isActiveMountedPath(sessionPath) ? undefined : 'true'"
              :tabindex="isActiveMountedPath(sessionPath) ? undefined : -1"
              :inert="isActiveMountedPath(sessionPath) ? undefined : true"
              v-show="isActiveMountedPath(sessionPath)"
            >
              <EditorContent
                v-if="renderedEditorsByPath[sessionPath]"
                :key="`editor-content:${sessionPath}`"
                :editor="renderedEditorsByPath[sessionPath]!"
              />
            </div>
          </div>
          <!-- Invariant: interactive overlays/drag-handle stay bound to active editor only. -->
          <DragHandleVue3
            v-if="renderedEditor"
            :key="`drag-handle:${currentPath || 'none'}`"
            :editor="renderedEditor"
            :plugin-key="DRAG_HANDLE_PLUGIN_KEY"
            :compute-position-config="dragHandleComputePositionConfig"
            class="tomosona-drag-handle"
            :nested="true"
            :on-node-change="onBlockHandleNodeChange"
            :on-element-drag-start="onHandleDragStart"
            :on-element-drag-end="onHandleDragEnd"
          >
            <div class="tomosona-block-controls" @mouseenter="onHandleControlsEnter" @mouseleave="onHandleControlsLeave">
              <button
                type="button"
                class="tomosona-block-control-btn"
                aria-label="Insert below"
                @mousedown.stop
                @click.stop.prevent="onBlockMenuPlus"
              >
                +
              </button>
              <button
                type="button"
                class="tomosona-block-control-btn tomosona-block-grip-btn"
                aria-label="Open block menu"
                @mousedown.stop
                @click.stop.prevent="toggleBlockMenu"
              >
                ⋮⋮
              </button>
            </div>
          </DragHandleVue3>

          <EditorInlineFormatToolbar
            :open="inlineFormatToolbar.formatToolbarOpen.value"
            :left="inlineFormatToolbar.formatToolbarLeft.value"
            :top="inlineFormatToolbar.formatToolbarTop.value"
            :active-marks="{
              bold: inlineFormatToolbar.isMarkActive('bold'),
              italic: inlineFormatToolbar.isMarkActive('italic'),
              strike: inlineFormatToolbar.isMarkActive('strike'),
              underline: inlineFormatToolbar.isMarkActive('underline'),
              code: inlineFormatToolbar.isMarkActive('code'),
              link: inlineFormatToolbar.isMarkActive('link')
            }"
            :link-popover-open="inlineFormatToolbar.linkPopoverOpen.value"
            :link-value="inlineFormatToolbar.linkValue.value"
            :link-error="inlineFormatToolbar.linkError.value"
            @toggle-mark="inlineFormatToolbar.toggleMark"
            @open-link="inlineFormatToolbar.openLinkPopover"
            @wrap-wikilink="inlineFormatToolbar.wrapSelectionWithWikilink"
            @open-pulse="openPulseForSelection"
            @copy-as="void onInlineToolbarCopyAs($event)"
            @apply-link="inlineFormatToolbar.applyLink"
            @unlink="inlineFormatToolbar.unlinkLink"
            @cancel-link="inlineFormatToolbar.cancelLink"
            @update:linkValue="(value) => { inlineFormatToolbar.linkValue.value = value }"
          />

          <EditorTableEdgeControls
            :trigger-visible="tableToolbarTriggerVisible"
            :trigger-left="tableMenuBtnLeft"
            :trigger-top="tableMenuBtnTop"
            :add-top-visible="tableAddTopVisible"
            :add-bottom-visible="tableAddBottomVisible"
            :add-left-visible="tableAddLeftVisible"
            :add-right-visible="tableAddRightVisible"
            :table-box-left="tableBoxLeft"
            :table-box-top="tableBoxTop"
            :table-box-width="tableBoxWidth"
            :table-box-height="tableBoxHeight"
            @toggle="toggleTableToolbar"
            @add-row-before="addRowBeforeFromTrigger"
            @add-row-after="addRowAfterFromTrigger"
            @add-column-before="addColumnBeforeFromTrigger"
            @add-column-after="addColumnAfterFromTrigger"
          />

          <EditorSlashOverlay
            :open="slashOpen"
            :index="slashIndex"
            :left="slashLeft"
            :top="slashTop"
            :query="slashQuery"
            :commands="visibleSlashCommands"
            @update:index="slashIndex = $event"
            @update:query="setSlashQuery($event)"
            @select="dismissSlashMenu(); insertBlockFromDescriptor($event.type, $event.data)"
            @close="dismissSlashMenu(); focusEditor()"
          />

          <EditorWikilinkOverlay
            :open="wikilinkOpen"
            :index="wikilinkIndex"
            :left="wikilinkLeft"
            :top="wikilinkTop"
            :results="wikilinkResults"
            @update:index="onWikilinkMenuIndexUpdate($event)"
            @select="onWikilinkMenuSelect($event)"
          />

          <EditorContextOverlays
            :block-menu-open="blockMenuOpen"
            :block-menu-index="blockMenuIndex"
            :block-menu-x="blockMenuPos.x"
            :block-menu-y="blockMenuPos.y"
            :block-menu-actions="blockMenuActions"
            :block-menu-convert-actions="blockMenuConvertActions"
            :table-toolbar-open="tableToolbarOpen"
            :table-toolbar-viewport-left="tableToolbarViewportLeft"
            :table-toolbar-viewport-top="tableToolbarViewportTop"
            :table-toolbar-actions="tableToolbarActions"
            :table-markdown-mode="TABLE_MARKDOWN_MODE"
            :table-toolbar-viewport-max-height="tableToolbarViewportMaxHeight"
            @block:menu-el="blockMenuFloatingEl = $event"
            @block:update-index="blockMenuIndex = $event"
            @block:select="onBlockMenuSelect($event)"
            @block:close="closeBlockMenu()"
            @table:menu-el="tableToolbarFloatingEl = $event"
            @table:select="onTableToolbarSelect($event)"
            @table:close="hideTableToolbar()"
          />

          <div v-if="pulseOpen" ref="pulsePanelWrap" class="editor-pulse-panel-wrap" :style="pulsePanelStyle">
            <PulsePanel
              compact
              :action-id="pulseActionId"
              :actions="PULSE_ACTIONS_BY_SOURCE[pulseSourceKind]"
              :instruction="pulseInstruction"
              :preview-markdown="pulse.previewMarkdown.value"
              :provenance-paths="pulse.provenancePaths.value"
              :running="pulse.running.value"
              :error="pulse.error.value"
              :source-text="pulseSourceText"
              :apply-modes="pulseSourceKind === 'editor_selection' ? ['replace_selection', 'insert_below', 'send_to_second_brain'] : ['insert_below', 'send_to_second_brain']"
              :primary-apply-mode="pulseSourceKind === 'editor_selection' ? 'replace_selection' : 'insert_below'"
              @update:action-id="onPulseActionChange($event as PulseActionId)"
              @update:instruction="onPulseInstructionChange($event)"
              @run="void runPulseFromEditor()"
              @cancel="void pulse.cancel()"
              @close="closePulsePanel()"
              @apply="(mode: PulseApplyMode) => {
                if (mode === 'replace_selection') replaceSelectionWithPulseOutput()
                if (mode === 'insert_below') insertPulseBelow()
                if (mode === 'send_to_second_brain') sendPulseContextToSecondBrain()
              }"
            />
          </div>

        </div>

        <EditorLargeDocOverlay
          :visible="isLoadingLargeDocument"
          :stage-label="loadStageLabel"
          :progress-percent="loadProgressPercent"
          :progress-indeterminate="loadProgressIndeterminate"
          :stats="loadDocumentStats"
        />

        <EditorFindToolbar
          :open="findToolbar.open.value"
          :query="findToolbar.query.value"
          :case-sensitive="findToolbar.caseSensitive.value"
          :whole-word="findToolbar.wholeWord.value"
          :active-match="findToolbar.activeMatch.value"
          :match-count="findToolbar.matchCount.value"
          @input-ready="findToolbar.inputEl.value = $event"
          @update:query="findToolbar.onQueryInput($event)"
          @toggle-case-sensitive="findToolbar.onCaseSensitiveToggle()"
          @toggle-whole-word="findToolbar.onWholeWordToggle()"
          @prev="findToolbar.prevMatch()"
          @next="findToolbar.nextMatch()"
          @close="findToolbar.closeToolbar({ focusEditor: true })"
        />
      </div>
    </div>

    <EditorMermaidReplaceDialog
      :visible="mermaidReplaceDialog.visible"
      :template-label="mermaidReplaceDialog.templateLabel"
      @cancel="resolveMermaidReplaceDialog(false)"
      @confirm="resolveMermaidReplaceDialog(true)"
    />
  </div>
</template>

<style scoped>
.editor-empty-state {
  background: var(--app-bg);
  color: var(--text-dim);
}

.editor-shell {
  border-color: var(--border-subtle);
  background: var(--surface-bg);
}

.editor-holder {
  background: var(--surface-bg);
}

.editor-header-shell {
  margin: 0;
}

.editor-pulse-panel-wrap {
  z-index: 36;
  pointer-events: auto;
}
</style>
