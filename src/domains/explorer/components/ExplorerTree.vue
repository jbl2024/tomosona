<script setup lang="ts">
import { DnDProvider } from '@vue-dnd-kit/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import type { EntryKind, TreeNode } from '../../../shared/api/apiTypes'
import type { PathMove } from '../../../shared/api/apiTypes'
import { listenWorkspaceFsChanged, openPathExternal } from '../../../shared/api/workspaceApi'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import ExplorerConfirmDialog from './ExplorerConfirmDialog.vue'
import ExplorerConflictDialog from './ExplorerConflictDialog.vue'
import ExplorerContextMenu, { type MenuAction } from './ExplorerContextMenu.vue'
import ExplorerItem from './ExplorerItem.vue'
import ExplorerToolbar from './ExplorerToolbar.vue'
import { useSelectionManager } from './composables/useSelectionManager'
import { useExplorerDnD } from '../composables/useExplorerDnD'
import { useExplorerFsSync } from '../composables/useExplorerFsSync'
import { useExplorerKeyboard } from '../composables/useExplorerKeyboard'
import { useExplorerOperations } from '../composables/useExplorerOperations'
import { useExplorerTreeState } from '../composables/useExplorerTreeState'
import { filterExplorerRows } from '../lib/explorerFilter'

const props = defineProps<{
  folderPath: string
  activePath?: string
  contextPaths?: string[]
  rowActionMode?: 'menu' | 'context-toggle'
}>()

const emit = defineEmits<{
  open: [path: string]
  select: [paths: string[]]
  error: [message: string]
  'path-renamed': [payload: { from: string; to: string }]
  'paths-moved': [moves: PathMove[]]
  'paths-deleted': [paths: string[]]
  'request-create': [payload: { parentPath: string; entryKind: EntryKind }]
  'toggle-context': [path: string]
}>()

const treeRef = ref<HTMLElement | null>(null)
const contextMenu = ref<{ x: number; y: number; targetPath: string | null } | null>(null)
const filterQuery = ref('')
const debouncedFilterQuery = ref('')
const filterInputRef = ref<InstanceType<typeof UiInput> | null>(null)
const isFilterVisible = ref(false)
let filterDebounceTimer: ReturnType<typeof window.setTimeout> | null = null

const selectionManager = useSelectionManager()
const isMac = navigator.platform.toLowerCase().includes('mac')

const selectionPaths = computed(() => selectionManager.selectedPaths.value)
const rowActionMode = computed(() => props.rowActionMode ?? 'menu')
const contextPathSet = computed(() => new Set(props.contextPaths ?? []))

const treeState = useExplorerTreeState({
  folderPath: computed(() => props.folderPath),
  activePath: computed(() => props.activePath),
  treeRef,
  onSelect: (paths) => emit('select', paths),
  selection: {
    selectedPaths: selectionPaths,
    clearSelection: selectionManager.clearSelection,
    selectSingle: selectionManager.selectSingle
  }
})

const filteredRows = computed(() => filterExplorerRows(
  debouncedFilterQuery.value,
  treeState.visibleRows.value,
  {
    rootPath: props.folderPath,
    childrenByDir: treeState.childrenByDir.value
  }
))
const visibleNodePaths = computed(() => filteredRows.value.map((row) => row.path))
const hasActiveFilter = computed(() => debouncedFilterQuery.value.trim().length > 0)
const hasFilterText = computed(() => filterQuery.value.trim().length > 0)

const fsSync = useExplorerFsSync({
  folderPath: computed(() => props.folderPath),
  childrenByDir: treeState.childrenByDir,
  nodeByPath: treeState.nodeByPath,
  parentByPath: treeState.parentByPath,
  expandedPaths: treeState.expandedPaths,
  focusedPath: treeState.focusedPath,
  selectionPaths,
  setSelection: selectionManager.setSelection,
  emitSelection: (paths) => emit('select', paths),
  loadChildren: treeState.loadChildren,
  clearPendingReloadDirs: () => {
    treeState.pendingReloadDirs.value = new Set()
  },
  listenWorkspaceFsChanged
})

const operations = useExplorerOperations({
  folderPath: computed(() => props.folderPath),
  focusedPath: treeState.focusedPath,
  nodeByPath: treeState.nodeByPath,
  selectionPaths,
  clearSelection: selectionManager.clearSelection,
  isSelected: selectionManager.isSelected,
  setSelection: selectionManager.setSelection,
  emitSelection: (paths) => emit('select', paths),
  emitError: (message) => emit('error', message),
  emitOpen: (path) => emit('open', path),
  emitPathRenamed: (payload) => emit('path-renamed', payload),
  emitPathsMoved: (moves) => emit('paths-moved', moves),
  emitPathsDeleted: (paths) => emit('paths-deleted', paths),
  emitRequestCreate: (payload) => emit('request-create', payload),
  loadChildren: treeState.loadChildren,
  refreshLoadedDirs: fsSync.refreshLoadedDirs
})

const dnd = useExplorerDnD({
  folderPath: computed(() => props.folderPath),
  nodeByPath: treeState.nodeByPath,
  parentByPath: treeState.parentByPath,
  selectionPaths,
  focusedPath: treeState.focusedPath,
  editingPath: operations.editingPath,
  hasActiveFilter,
  setSelection: selectionManager.setSelection,
  emitSelection: (paths) => emit('select', paths),
  movePaths: operations.movePaths
})

function ensureFocusedPath(defaultToFirst = true) {
  if (treeState.focusedPath.value && visibleNodePaths.value.includes(treeState.focusedPath.value)) {
    return treeState.focusedPath.value
  }

  if (defaultToFirst && visibleNodePaths.value.length) {
    treeState.focusedPath.value = visibleNodePaths.value[0]
    return treeState.focusedPath.value
  }

  return ''
}

const keyboard = useExplorerKeyboard({
  folderPath: computed(() => props.folderPath),
  focusedPath: treeState.focusedPath,
  visibleNodePaths,
  parentByPath: treeState.parentByPath,
  childrenByDir: treeState.childrenByDir,
  nodeByPath: treeState.nodeByPath,
  expandedPaths: treeState.expandedPaths,
  selectionPaths,
  isMac,
  selectSingle: selectionManager.selectSingle,
  selectRange: selectionManager.selectRange,
  setSelection: selectionManager.setSelection,
  emitSelection: (paths) => emit('select', paths),
  ensureFocusedPath,
  toggleExpand: treeState.toggleExpand,
  openNode: operations.openNode,
  startRename: operations.startRename,
  requestDelete: operations.requestDelete,
  setClipboard: operations.setClipboard,
  runPaste: () => operations.runPaste(),
  requestCreate: operations.requestCreate
})

function currentContextTarget(): string | null {
  return contextMenu.value?.targetPath ?? null
}

function openContextMenuAt(x: number, y: number, targetPath: string | null) {
  contextMenu.value = { x, y, targetPath }
}

function openContextMenu(event: MouseEvent, targetPath: string | null) {
  openContextMenuAt(event.clientX + 2, event.clientY + 2, targetPath)
}

function closeContextMenu() {
  contextMenu.value = null
}

function focusFilterInput() {
  window.setTimeout(() => {
    filterInputRef.value?.focus()
    filterInputRef.value?.select()
  }, 0)
}

function toggleFilterVisibility() {
  if (isFilterVisible.value && hasFilterText.value) {
    focusFilterInput()
    return
  }

  isFilterVisible.value = !isFilterVisible.value
  if (isFilterVisible.value) {
    focusFilterInput()
  }
}

function clearFilter() {
  filterQuery.value = ''
  debouncedFilterQuery.value = ''
  isFilterVisible.value = true
  focusFilterInput()
}

function handleRowClick(event: MouseEvent, node: TreeNode) {
  if (dnd.shouldSuppressPointerInteraction()) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const ordered = visibleNodePaths.value
  const isToggle = isMac ? event.metaKey : event.ctrlKey

  if (event.shiftKey) {
    selectionManager.selectRange(node.path, ordered)
  } else if (isToggle) {
    selectionManager.toggleSelection(node.path)
  } else {
    selectionManager.selectSingle(node.path)
  }

  treeState.focusedPath.value = node.path
  emit('select', selectionPaths.value)

  if (node.is_dir && !event.shiftKey && !isToggle) {
    void treeState.toggleExpand(node.path)
    return
  }

  if (!node.is_dir && node.is_markdown && !event.shiftKey && !isToggle) {
    if (rowActionMode.value === 'context-toggle') {
      emit('toggle-context', node.path)
      return
    }
    emit('open', node.path)
  }
}

function handleDoubleClick(node: TreeNode) {
  if (dnd.shouldSuppressPointerInteraction()) {
    return
  }

  if (node.is_dir) return
  if (node.is_markdown) {
    emit('open', node.path)
  } else {
    void openPathExternal(node.path)
  }
}

function onRowAction(payload: { event: MouseEvent; node: TreeNode }) {
  const target = payload.event.currentTarget as HTMLElement | null
  if (target) {
    const rect = target.getBoundingClientRect()
    openContextMenuAt(rect.right + 6, rect.bottom + 6, payload.node.path)
    return
  }

  openContextMenu(payload.event, payload.node.path)
}

function onNodeContextMenu(payload: { event: MouseEvent; node: TreeNode }) {
  openContextMenu(payload.event, payload.node.path)
}

function onTreeContextMenu(event: MouseEvent) {
  openContextMenu(event, null)
}

function clearSelectionIfBackground(event: MouseEvent) {
  if (dnd.shouldSuppressPointerInteraction()) {
    return
  }

  if (event.target === event.currentTarget) {
    selectionManager.clearSelection()
    emit('select', [])
  }
}

async function onContextAction(action: MenuAction) {
  const targetPath = currentContextTarget()
  const targetNode = targetPath ? treeState.nodeByPath.value[targetPath] : null
  const selection = operations.effectiveSelection(targetPath)

  if (action === 'new-file' || action === 'new-folder') {
    const parent = targetNode?.is_dir ? targetNode.path : targetPath ? treeState.parentByPath.value[targetPath] ?? props.folderPath : props.folderPath
    operations.requestCreate(parent || props.folderPath, action === 'new-file' ? 'file' : 'folder')
    closeContextMenu()
    return
  }

  if (action === 'open') {
    await operations.openSelected(selection)
  }

  if (action === 'open-external' && targetPath) {
    await operations.openExternal(targetPath)
  }

  if (action === 'reveal' && targetPath) {
    await operations.revealInManager(targetPath)
  }

  if (action === 'rename' && targetPath) {
    operations.startRename(targetPath)
  }

  if (action === 'delete') {
    operations.requestDelete(selection)
  }

  if (action === 'duplicate') {
    await operations.runDuplicate(selection)
  }

  if (action === 'copy') {
    operations.setClipboard('copy', selection)
  }

  if (action === 'cut') {
    operations.setClipboard('cut', selection)
  }

  if (action === 'paste') {
    await operations.runPaste(targetPath)
  }

  closeContextMenu()
}

watch(
  () => props.folderPath,
  async () => {
    await treeState.initializeExplorer()
    fsSync.resetWatcherSession()
  },
  { immediate: true }
)

watch(
  () => props.activePath,
  async (next) => {
    if (!next || !props.folderPath) return
    await treeState.revealPathInView(next)
  },
  { immediate: true }
)

watch(filterQuery, (next) => {
  if (filterDebounceTimer) {
    window.clearTimeout(filterDebounceTimer)
  }

  filterDebounceTimer = window.setTimeout(() => {
    debouncedFilterQuery.value = next
    filterDebounceTimer = null
  }, 180)
})

watch(
  () => debouncedFilterQuery.value,
  async (query) => {
    if (!query.trim() || !props.folderPath) return
    await treeState.preloadAllDirs()
  }
)

defineExpose({
  revealPathInView: treeState.revealPathInView
})

onMounted(() => {
  window.addEventListener('click', closeContextMenu)
  fsSync.start()
  treeState.focusTree()
  if (hasFilterText.value) {
    isFilterVisible.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  if (filterDebounceTimer) {
    window.clearTimeout(filterDebounceTimer)
  }
  fsSync.stop()
})
</script>

<template>
  <DnDProvider :auto-scroll-viewport="true" preview-to="body">
    <div class="flex h-full min-h-0 flex-col gap-2">
      <ExplorerToolbar
        :disabled="!folderPath"
        :search-open="isFilterVisible"
        @create-file="operations.requestCreate(folderPath, 'file')"
        @create-folder="operations.requestCreate(folderPath, 'folder')"
        @expand-all="treeState.expandAllDirs"
        @collapse-all="treeState.collapseAllDirs"
        @refresh="fsSync.refreshLoadedDirs"
        @toggle-search="toggleFilterVisibility"
      />

      <div v-if="isFilterVisible || hasFilterText" class="explorer-filter-shell">
        <MagnifyingGlassIcon class="explorer-filter-icon h-3.5 w-3.5" />
        <UiInput
          ref="filterInputRef"
          v-model="filterQuery"
          size="sm"
          class-name="explorer-filter !pl-8 pr-8"
          placeholder="Filter files and folders..."
        />
        <button
          v-if="hasFilterText"
          type="button"
          class="explorer-filter-clear"
          aria-label="Clear filter"
          title="Clear filter"
          @click="clearFilter"
        >
          <XMarkIcon class="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        ref="treeRef"
        tabindex="0"
        class="min-h-0 flex-1 overflow-auto bg-transparent p-0.5 outline-none focus-visible:ring-0"
        @keydown="keyboard.onTreeKeydown"
        @contextmenu.prevent="onTreeContextMenu"
        @click="clearSelectionIfBackground"
      >
        <p v-if="!folderPath" class="explorer-empty-state px-2 py-1 text-xs">Select a working folder to start.</p>
        <p v-else-if="!filteredRows.length" class="explorer-empty-state px-2 py-1 text-xs">
          <template v-if="hasActiveFilter">No matching files or folders.</template>
          <template v-else>No files or folders. Use New file or New folder.</template>
        </p>

        <template v-else>
          <ExplorerItem
            v-for="row in filteredRows"
            :key="row.path"
            :node="treeState.nodeByPath.value[row.path]"
            :depth="row.depth"
            :expanded="treeState.expandedPaths.value.has(row.path)"
            :selected="selectionManager.isSelected(row.path)"
            :active="activePath === row.path"
            :focused="treeState.focusedPath.value === row.path"
            :cut-pending="Boolean(operations.clipboard.value?.mode === 'cut' && operations.clipboard.value.paths.includes(row.path))"
            :editing="operations.editingPath.value === row.path"
            :rename-value="operations.editingValue.value"
            :context-active="contextPathSet.has(row.path)"
            :dnd="dnd"
            @toggle="treeState.toggleExpand"
            @click="handleRowClick"
            @doubleclick="handleDoubleClick"
            @contextmenu="onNodeContextMenu"
            @rowaction="onRowAction"
            @rename-update="operations.editingValue.value = $event"
            @rename-confirm="operations.confirmRename"
            @rename-cancel="operations.cancelRename"
          />
        </template>
      </div>

      <ExplorerContextMenu
        v-if="contextMenu"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :can-open="Boolean(contextMenu.targetPath)"
        :can-paste="operations.canPaste.value"
        :can-rename="Boolean(contextMenu.targetPath)"
        :can-delete="Boolean(contextMenu.targetPath)"
        @action="onContextAction"
      />

      <ExplorerConflictDialog
        v-if="operations.conflictPrompt.value"
        :title="operations.conflictPrompt.value.title"
        :detail="operations.conflictPrompt.value.detail"
        @cancel="operations.closeConflictPrompt"
        @resolve="operations.resolveConflict"
      />

      <ExplorerConfirmDialog
        v-if="operations.confirmPrompt.value"
        :title="operations.confirmPrompt.value.title"
        :detail="operations.confirmPrompt.value.detail"
        @cancel="operations.cancelConfirmPrompt"
        @confirm="operations.confirmPromptAction(currentContextTarget())"
      />
    </div>
  </DnDProvider>
</template>

<style scoped>
.explorer-filter-shell {
  position: relative;
}

.explorer-filter-icon {
  position: absolute;
  left: 0.7rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  pointer-events: none;
}

.explorer-filter {
  min-width: 0;
}

.explorer-filter-clear {
  position: absolute;
  right: 0.35rem;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-dim);
  transition: background 120ms ease, color 120ms ease;
}

.explorer-filter-clear:hover {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-filter-clear:focus-visible {
  outline: none;
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-empty-state {
  color: var(--text-dim);
}
</style>
