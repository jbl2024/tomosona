<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { DragHandle as DragHandleVue3 } from '@tiptap/extension-drag-handle-vue-3'
import { openExternalUrl } from '../../../shared/api/workspaceApi'
import type { PulseActionId, ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import { PULSE_ACTIONS_BY_SOURCE, type PulseApplyMode } from '../../pulse/lib/pulse'
import type { DocumentSession } from '../composables/useDocumentEditorSessions'
import { captureHeavyRenderEpoch, hasPendingHeavyRender, waitForHeavyRenderIdle } from '../lib/tiptap/renderStabilizer'
import { useEditorChromeRuntime } from '../composables/useEditorChromeRuntime'
import { useEditorDocumentRuntime } from '../composables/useEditorDocumentRuntime'
import { useEditorInteractionRuntime } from '../composables/useEditorInteractionRuntime'
import { getBlockStructureLabel } from '../lib/tiptap/blockMenu/guards'
import EditorContextOverlays from './editor/EditorContextOverlays.vue'
import EditorFindToolbar from './editor/EditorFindToolbar.vue'
import EditorInlineFormatToolbar from './editor/EditorInlineFormatToolbar.vue'
import EditorLargeDocOverlay from './editor/EditorLargeDocOverlay.vue'
import EditorMermaidPreviewDialog from './editor/EditorMermaidPreviewDialog.vue'
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
  { key: 'date', label: 'date', description: 'Primary date (YYYY-MM-DD)' },
  { key: 'deadline', label: 'deadline', description: 'Due date (YYYY-MM-DD)' },
  { key: 'status', label: 'status', description: 'Workflow state' },
  { key: 'category', label: 'category', description: 'Content category' },
  { key: 'created', label: 'created', description: 'Creation date (YYYY-MM-DD)' },
  { key: 'updated', label: 'updated', description: 'Last update date (YYYY-MM-DD)' },
  { key: 'priority', label: 'priority', description: 'Priority level' },
  { key: 'version', label: 'version', description: 'Version label' }
]

const props = defineProps<{
  path: string
  workspacePath?: string
  openPaths?: string[]
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
}>()

const emit = defineEmits([
  'status',
  'path-renamed',
  'outline',
  'properties',
  'pulse-open-second-brain',
  'external-reload'
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

function emitExternalReload(payload: { path: string }) {
  emit('external-reload', payload)
}

const holder = ref<HTMLDivElement | null>(null)
const contentShell = ref<HTMLDivElement | null>(null)
const pulsePanelWrap = ref<HTMLDivElement | null>(null)
const activeEditor = ref<Editor | null>(null) as Ref<Editor | null>
const pathRef = computed(() => props.path ?? '')
const openPathsRef = computed(() => props.openPaths ?? [])
const currentPathSource = computed(() => props.path?.trim() || '')

let chromeRuntime!: ReturnType<typeof useEditorChromeRuntime>
let interactionRuntime!: ReturnType<typeof useEditorInteractionRuntime>
let documentRuntime!: ReturnType<typeof useEditorDocumentRuntime>

chromeRuntime = useEditorChromeRuntime({
  chromeHostPort: {
    holder,
    contentShell,
    pulsePanelWrap,
    getCurrentPath: () => currentPathSource.value,
    getEditor: () => activeEditor.value,
    getSession: (path) => getSession(path)
  },
  chromeInteractionPort: {
    menus: {
      closeSlashMenu: () => interactionRuntime?.closeSlashMenu(),
      dismissSlashMenu: () => interactionRuntime?.dismissSlashMenu(),
      closeWikilinkMenu: () => interactionRuntime?.closeWikilinkMenu(),
      openSlashAtSelection: () => interactionRuntime?.openSlashAtSelection()
    },
    editorEvents: {
      onEditorKeydown: (event) => interactionRuntime?.onEditorKeydown(event),
      onEditorKeyup: () => interactionRuntime?.onEditorKeyup(),
      onEditorContextMenu: (event) => interactionRuntime?.onEditorContextMenu(event),
      onEditorPaste: (event) => interactionRuntime?.onEditorPaste(event),
      markEditorInteraction: () => interactionRuntime?.markEditorInteraction()
    },
    caches: {
      resetWikilinkDataCache: () => interactionRuntime?.resetWikilinkDataCache()
    }
  },
  chromeOutputPort: {
    emitPulseOpenSecondBrain
  }
})

interactionRuntime = useEditorInteractionRuntime({
  interactionDocumentPort: {
    currentPath: currentPathSource,
    holder,
    activeEditor,
    getSession: (path) => getSession(path),
    saveCurrentFile: (manual) => documentRuntime?.saveCurrentFile(manual),
    onEditorDocChanged: (path) => documentRuntime?.onEditorDocChanged(path)
  },
  interactionEditorPort: {
    emitOutline,
    requestMermaidReplaceConfirm: chromeRuntime.dialogsAndLifecycle.requestMermaidReplaceConfirm,
    openMermaidPreview: chromeRuntime.dialogsAndLifecycle.openMermaidPreview
  },
  interactionChromePort: {
    menus: {
      blockMenuOpen: chromeRuntime.blockAndTable.blockMenuOpen,
      tableToolbarOpen: chromeRuntime.blockAndTable.tableToolbarOpen,
      isDragMenuOpen: () => chromeRuntime.blockAndTable.dragHandleUiState.value.menuOpen,
      closeBlockMenu: () => chromeRuntime.blockAndTable.closeBlockMenu(),
      hideTableToolbar: () => chromeRuntime.blockAndTable.hideTableToolbar()
    },
    blockHandles: {
      syncSelectionTarget: () => chromeRuntime.blockAndTable.onBlockHandleSelectionUpdate()
    },
    toolbars: {
      updateFormattingToolbar: () => chromeRuntime.toolbars.updateFormattingToolbar(),
      updateTableToolbar: () => chromeRuntime.blockAndTable.updateTableToolbar(),
      inlineFormatToolbar: {
        updateFormattingToolbar: chromeRuntime.toolbars.inlineFormatToolbar.updateFormattingToolbar,
        openLinkPopover: chromeRuntime.toolbars.inlineFormatToolbar.openLinkPopover,
        linkPopoverOpen: chromeRuntime.toolbars.inlineFormatToolbar.linkPopoverOpen,
        cancelLink: chromeRuntime.toolbars.inlineFormatToolbar.cancelLink
      }
    },
    zoom: {
      zoomEditorBy: (delta) => chromeRuntime.layout.zoomEditorBy(delta),
      resetEditorZoom: () => chromeRuntime.layout.resetEditorZoom()
    }
  },
  interactionIoPort: {
    loadLinkTargets: props.loadLinkTargets,
    loadLinkHeadings: props.loadLinkHeadings,
    openLinkTarget: props.openLinkTarget,
    openExternalUrl
  }
})

documentRuntime = useEditorDocumentRuntime({
  documentInputPort: {
    path: pathRef,
    openPaths: openPathsRef,
    readNoteSnapshot: props.readNoteSnapshot ?? (async (path: string) => ({
      path,
      content: await props.openFile!(path),
      version: null
    })),
    saveNoteBuffer: props.saveNoteBuffer ?? (async (_path: string, text: string, options) => {
      await props.saveFile!(_path, text, { explicit: options.explicit })
      return {
        ok: true,
        version: options.expectedBaseVersion ?? { mtimeMs: Date.now(), size: text.length }
      } satisfies SaveNoteResult
    }),
    renameFileFromTitle: props.renameFileFromTitle,
    loadPropertyTypeSchema: props.loadPropertyTypeSchema,
    savePropertyTypeSchema: props.savePropertyTypeSchema
  },
  documentOutputPort: {
    emitStatus,
    emitOutline,
    emitProperties,
    emitPathRenamed,
    emitExternalReload
  },
  documentSessionPort: {
    holder,
    activeEditor,
    isEditingTitle: () => chromeRuntime.loading.titleEditorFocused.value,
    createSessionEditor: interactionRuntime.createSessionEditor
  },
  documentUiPort: {
    loading: chromeRuntime.loading.loadUiState,
    largeDocThreshold: chromeRuntime.loading.largeDocThreshold,
    resetTransientUi: chromeRuntime.dialogsAndLifecycle.resetTransientUiState,
    syncLayout: chromeRuntime.layout.updateGutterHitboxStyle,
    hideTableToolbarAnchor: chromeRuntime.blockAndTable.hideTableToolbarAnchor,
    closeCompetingMenus: chromeRuntime.blockAndTable.closeBlockMenu,
    syncAfterSessionChange: chromeRuntime.toolbars.onActiveSessionChanged,
    syncAfterDocumentChange: chromeRuntime.toolbars.onDocumentContentChanged,
    initializeUi: chromeRuntime.dialogsAndLifecycle.onMountInit,
    disposeUi: chromeRuntime.dialogsAndLifecycle.onUnmountCleanup,
    interaction: {
      captureCaret: interactionRuntime.captureCaret,
      restoreCaret: interactionRuntime.restoreCaret,
      clearOutlineTimer: interactionRuntime.clearOutlineTimer,
      emitOutlineSoon: interactionRuntime.emitOutlineSoon,
      closeSlashMenu: interactionRuntime.closeSlashMenu,
      closeWikilinkMenu: interactionRuntime.closeWikilinkMenu,
      syncWikilinkUiFromPluginState: interactionRuntime.syncWikilinkUiFromPluginState
    }
  },
  waitForHeavyRenderIdle,
  hasPendingHeavyRender,
  captureHeavyRenderEpoch
})

const currentPath = documentRuntime.currentPath
const currentTitle = documentRuntime.currentTitle
const renderPaths = documentRuntime.renderPaths
const renderedEditorsByPath = documentRuntime.renderedEditorsByPath
const isActiveMountedPath = documentRuntime.isActiveMountedPath
const { loading, toolbars, blockAndTable, layout, pulse, dialogsAndLifecycle } = chromeRuntime
const getZoom = layout.getZoom
const onTitleInput = documentRuntime.onTitleInput
const onTitleCommit = documentRuntime.onTitleCommit
const focusEditor = layout.focusEditor
// Kept as local bindings so Pulse contract tests can reach them through setupState
// without reintroducing a broader public API on the component itself.
const setPulseInstruction = pulse.setPulseInstruction
const pulseSelectionRange = pulse.pulseSelectionRange
void setPulseInstruction
void pulseSelectionRange
  const {
  propertyEditorMode,
  activeParseErrors,
  activeRawYaml,
  canUseStructuredProperties,
  structuredPropertyFields,
  structuredPropertyKeys,
  propertyKeySuggestions,
  propertySuggestionsForField,
  propertyGenerationLoading,
  propertyGenerationTargetIndex,
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
  generateAutoProperties,
  generatePropertyValue,
  isLoadingLargeDocument,
  loadStageLabel,
  loadProgressPercent,
  loadProgressIndeterminate,
  loadDocumentStats
} = documentRuntime
const {
  DRAG_HANDLE_PLUGIN_KEY,
  DRAG_HANDLE_DEBUG,
} = chromeRuntime
const TABLE_MARKDOWN_MODE = chromeRuntime.TABLE_MARKDOWN_MODE
const { titleEditorFocused } = loading
const {
  inlineFormatToolbar,
  findToolbar,
  onInlineToolbarCopyAs
} = toolbars
const {
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
  dragHandleComputePositionConfig,
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
  dragHandleNestedOptions,
  onEditorMouseMove,
  onEditorMouseLeave
} = blockAndTable
const activeBlockStructureLabel = computed(() => getBlockStructureLabel(dragHandleUiState.value.activeTarget))

function syncBlockDragHandleVisibility() {
  const handleElement = contentShell.value?.querySelector('.tomosona-drag-handle') as HTMLElement | null
  if (!handleElement) return

  const shouldShow = Boolean(dragHandleUiState.value.activeTarget)
  handleElement.style.visibility = shouldShow ? 'visible' : 'hidden'
  handleElement.style.pointerEvents = shouldShow ? 'auto' : 'none'
}

function syncBlockDragHandlePosition() {
  const editor = renderedEditor.value
  const target = dragHandleUiState.value.activeTarget
  if (!editor || !target) return

  const handleElement = contentShell.value?.querySelector('.tomosona-drag-handle') as HTMLElement | null
  if (!handleElement) return

  const targetDom = editor.view.nodeDOM(target.pos)
  const blockElement = targetDom instanceof HTMLElement
    ? targetDom
    : targetDom instanceof Node
      ? targetDom.parentElement
      : null
  if (!blockElement) return

  const blockRect = blockElement.getBoundingClientRect()
  const handleRect = handleElement.getBoundingClientRect()
  const offsetParent = handleElement.offsetParent instanceof HTMLElement
    ? handleElement.offsetParent
    : (contentShell.value?.parentElement ?? contentShell.value)
  const parentRect = offsetParent?.getBoundingClientRect()
  if (!parentRect) return

  const left = blockRect.left - parentRect.left - handleRect.width - 8
  const top = blockRect.top - parentRect.top + Math.max(0, (blockRect.height - handleRect.height) / 2)

  handleElement.style.position = 'absolute'
  handleElement.style.left = `${left}px`
  handleElement.style.top = `${top}px`
}

const {
  renderedEditor,
  editorZoomStyle,
  zoomEditorBy,
  resetEditorZoom,
  gutterHitboxStyle
} = layout
watch(
  () => dragHandleUiState.value.activeTarget,
  () => {
    syncBlockDragHandleVisibility()
    syncBlockDragHandlePosition()
  },
  { immediate: true, flush: 'post' }
)
watch(
  renderedEditor,
  () => {
    syncBlockDragHandleVisibility()
    syncBlockDragHandlePosition()
  },
  { immediate: true, flush: 'post' }
)
const {
  pulseOpen,
  pulse: pulseState,
  pulseSourceKind,
  pulseActionId,
  pulseInstruction,
  pulseSourceText,
  pulsePanelStyle,
  onPulseActionChange,
  onPulseInstructionChange,
  runPulseFromEditor,
  closePulsePanel,
  openPulseForSelection,
  replaceSelectionWithPulseOutput,
  insertPulseBelow,
  sendPulseContextToSecondBrain
} = pulse
const {
  mermaidReplaceDialog,
  resolveMermaidReplaceDialog,
  mermaidPreviewDialog,
  closeMermaidPreview,
  exportMermaidSvg
} = dialogsAndLifecycle
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

function getSession(path: string): DocumentSession | null {
  return documentRuntime?.getSession(path) ?? null
}

function focusFirstContentBlock() {
  layout.focusFirstEditableBlock()
}

const activeSession = computed(() => currentPath.value ? getSession(currentPath.value) : null)
const activeConflict = computed(() => activeSession.value?.conflict ?? null)

async function onLoadDiskVersion() {
  if (!currentPath.value) return
  const requestId = documentRuntime.nextRequestId()
  documentRuntime.ensureSession(currentPath.value)
  documentRuntime.setActiveSession(currentPath.value)
  await documentRuntime.loadCurrentFile(currentPath.value, { forceReload: true, requestId })
}

async function onOverwriteWithMyVersion() {
  await documentRuntime.saveCurrentFile(true, { force: true })
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
  applyWorkspaceFsChanges: async (changes: WorkspaceFsChange[]) => {
    await documentRuntime.applyWorkspaceFsChanges(changes)
  },
  focusEditor: layout.focusEditor,
  focusFirstContentBlock,
  revealSnippet,
  revealOutlineHeading,
  revealAnchor,
  zoomIn: () => zoomEditorBy(0.1),
  zoomOut: () => zoomEditorBy(-0.1),
  resetZoom: () => resetEditorZoom(),
  getZoom,
  pulseOpen: pulse.pulseOpen,
  pulseSourceKind: pulse.pulseSourceKind,
  pulseActionId: pulse.pulseActionId,
  pulseSourceText: pulse.pulseSourceText,
  pulseSelectionRange: pulse.pulseSelectionRange,
  setPulseInstruction: pulse.setPulseInstruction
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
        v-if="activeConflict"
        class="border-b border-[var(--border-strong)] bg-[var(--surface-muted)] px-4 py-2 text-sm"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span>
            {{ activeConflict.kind === 'deleted' ? 'This file was deleted on disk.' : 'A newer disk version was detected.' }}
          </span>
          <button
            v-if="activeConflict.kind === 'modified'"
            type="button"
            class="rounded border px-2 py-1"
            @click="onLoadDiskVersion"
          >
            Load disk version
          </button>
          <button
            type="button"
            class="rounded border px-2 py-1"
            @click="onOverwriteWithMyVersion"
          >
            {{ activeConflict.kind === 'deleted' ? 'Recreate file' : 'Overwrite with my version' }}
          </button>
        </div>
      </div>
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
                :key="currentPath"
                :model-value="currentTitle"
                :saving="Boolean(currentPath && getSession(currentPath)?.saving)"
                @update:model-value="onTitleInput"
                @commit="onTitleCommit"
                @focus="titleEditorFocused = true"
                @blur="titleEditorFocused = false"
                @focus-body-request="void focusFirstContentBlock()"
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
                :property-key-suggestions="propertyKeySuggestions"
                :property-suggestions-for-field="propertySuggestionsForField"
                :effective-type-for-field="effectiveTypeForField"
                :is-property-type-locked="isPropertyTypeLocked"
                :generation-pending="propertyGenerationLoading"
                :generation-target-index="propertyGenerationTargetIndex"
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
                @auto-generate="void generateAutoProperties()"
                @sparkle-property="void generatePropertyValue($event)"
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
            :nested="dragHandleNestedOptions"
            :on-node-change="onBlockHandleNodeChange"
            :on-element-drag-start="onHandleDragStart"
            :on-element-drag-end="onHandleDragEnd"
          >
            <div class="tomosona-block-controls" @mouseenter="onHandleControlsEnter" @mouseleave="onHandleControlsLeave">
              <span
                v-if="activeBlockStructureLabel"
                class="tomosona-block-structure-label"
                aria-hidden="true"
              >
                {{ activeBlockStructureLabel }}
              </span>
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
                <span class="tomosona-block-grip-icon" aria-hidden="true">
                  <span class="tomosona-block-grip-dot"></span>
                  <span class="tomosona-block-grip-dot"></span>
                  <span class="tomosona-block-grip-dot"></span>
                  <span class="tomosona-block-grip-dot"></span>
                  <span class="tomosona-block-grip-dot"></span>
                  <span class="tomosona-block-grip-dot"></span>
                </span>
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
              :preview-markdown="pulseState.previewMarkdown.value"
              :provenance-paths="pulseState.provenancePaths.value"
              :running="pulseState.running.value"
              :error="pulseState.error.value"
              :source-text="pulseSourceText"
              :apply-modes="pulseSourceKind === 'editor_selection' ? ['replace_selection', 'insert_below', 'send_to_second_brain'] : ['insert_below', 'send_to_second_brain']"
              :primary-apply-mode="pulseSourceKind === 'editor_selection' ? 'replace_selection' : 'insert_below'"
              @update:action-id="onPulseActionChange($event as PulseActionId)"
              @update:instruction="onPulseInstructionChange($event)"
              @run="void runPulseFromEditor()"
              @cancel="void pulseState.cancel()"
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
    <EditorMermaidPreviewDialog
      :visible="mermaidPreviewDialog.visible"
      :svg="mermaidPreviewDialog.svg"
      :export-error="mermaidPreviewDialog.exportError"
      @close="closeMermaidPreview()"
      @export-svg="exportMermaidSvg($event)"
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
  overscroll-behavior: contain;
}

.editor-header-shell {
  margin: 0;
}

.editor-pulse-panel-wrap {
  z-index: 36;
  pointer-events: auto;
}
</style>
