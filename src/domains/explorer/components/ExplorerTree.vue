<script setup lang="ts">
import { DnDProvider } from '@vue-dnd-kit/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import type { EntryKind, TreeNode } from '../../../shared/api/apiTypes'
import type { PathMove } from '../../../shared/api/apiTypes'
import { createInlineNote, listenWorkspaceFsChanged, openPathExternal } from '../../../shared/api/workspaceApi'
import { readNoteSnapshot } from '../../../shared/api/editorSyncApi'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import { renderMarkdownPreviewHtml } from '../../editor/lib/markdownPreviewHtml'
import ExplorerConfirmDialog from './ExplorerConfirmDialog.vue'
import ExplorerCreateInput from './ExplorerCreateInput.vue'
import ExplorerConflictDialog from './ExplorerConflictDialog.vue'
import ExplorerContextMenu, { type MenuAction } from './ExplorerContextMenu.vue'
import ExplorerItem from './ExplorerItem.vue'
import ExplorerMoveDialog from './ExplorerMoveDialog.vue'
import ExplorerQuickPreview from './ExplorerQuickPreview.vue'
import ExplorerToolbar from './ExplorerToolbar.vue'
import { useSelectionManager } from './composables/useSelectionManager'
import { useExplorerDnD } from '../composables/useExplorerDnD'
import { useExplorerFsSync } from '../composables/useExplorerFsSync'
import { useExplorerKeyboard } from '../composables/useExplorerKeyboard'
import { useExplorerOperations } from '../composables/useExplorerOperations'
import { useExplorerTreeState } from '../composables/useExplorerTreeState'
import { explorerNameMatches, filterExplorerRows } from '../lib/explorerFilter'
import { errorMessage, getParentPath } from '../lib/explorerTreeUtils'
import { normalizeDraggedPaths } from '../lib/explorerDndRules'
import { isTextFile } from '../../../shared/api/workspaceApi'

const props = defineProps<{
  folderPath: string
  activePath?: string
  contextPaths?: string[]
  rowActionMode?: 'menu' | 'context-toggle'
  canUndo?: boolean
  knownFilePaths?: string[]
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
  'convert-to-word': [path: string]
  undo: []
}>()

const treeRef = ref<HTMLElement | null>(null)
const contextMenu = ref<{ x: number; y: number; targetPath: string | null } | null>(null)
const filterQuery = ref('')
const debouncedFilterQuery = ref('')
const filterInputRef = ref<InstanceType<typeof UiInput> | null>(null)
const isFilterVisible = ref(false)
const showExtensions = ref(false)
const creatingNote = ref<{ parent: string; error: string; busy: boolean } | null>(null)
const moveDialogSources = ref<string[] | null>(null)

type QuickPreviewState = {
  path: string
  title: string
  html: string
  loading: boolean
  error: string
  locked: boolean
}
const preview = ref<QuickPreviewState | null>(null)
let previewToken = 0

let filterDebounceTimer: number | null = null
let unfilteredScrollTop: number | null = null

const moveRecentKey = computed(() => `tomosona.explorer.moveRecent.${props.folderPath}`)
const recentMoveDestinations = ref<string[]>([])

/** All known folder paths: workspace root, loaded tree dirs, and parents of known files. */
const knownFolderPaths = computed(() => {
  const folders = new Set<string>([props.folderPath])
  for (const dir of Object.keys(treeState.childrenByDir.value)) folders.add(dir)
  for (const path of Object.keys(treeState.nodeByPath.value)) {
    let parent = treeState.parentByPath.value[path] ?? getParentPath(path)
    while (parent && parent !== props.folderPath) {
      folders.add(parent)
      parent = getParentPath(parent)
    }
  }
  for (const filePath of props.knownFilePaths ?? []) {
    let parent = getParentPath(filePath)
    while (parent && parent !== props.folderPath && parent.startsWith(`${props.folderPath}/`)) {
      folders.add(parent)
      parent = getParentPath(parent)
    }
  }
  return Array.from(folders)
})

function loadRecentMoveDestinations() {
  try {
    const raw = window.localStorage.getItem(moveRecentKey.value)
    recentMoveDestinations.value = raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    recentMoveDestinations.value = []
  }
}

function rememberMoveDestination(destination: string) {
  recentMoveDestinations.value = [destination, ...recentMoveDestinations.value.filter((path) => path !== destination)].slice(0, 8)
  try {
    window.localStorage.setItem(moveRecentKey.value, JSON.stringify(recentMoveDestinations.value))
  } catch {
    // Recent destinations are a convenience only.
  }
}

function openMoveDialog(sources: string[]) {
  moveDialogSources.value = normalizeDraggedPaths(sources, treeState.parentByPath.value)
}

async function confirmMoveDialog(destination: string) {
  const sources = moveDialogSources.value ?? []
  moveDialogSources.value = null
  if (!sources.length) return
  rememberMoveDestination(destination)
  await operations.executeMove(destination, sources)
}

/**
 * Opens a temporary read-only preview. Uses readNoteSnapshot so protected pages
 * follow the existing session rules: locked pages refuse, unlocked pages render
 * from the in-memory decrypted snapshot without persisting plaintext.
 */
async function openPreview(path: string) {
  const node = treeState.nodeByPath.value[path]
  if (!node || node.is_dir || !node.is_markdown) return
  const token = ++previewToken
  preview.value = { path, title: node.name.replace(/\.(md|markdown)$/i, ''), html: '', loading: true, error: '', locked: false }

  try {
    const snapshot = await readNoteSnapshot(path)
    if (token !== previewToken) return
    const html = renderMarkdownPreviewHtml(snapshot.content)
    if (token !== previewToken) return
    preview.value = { path, title: node.name.replace(/\.(md|markdown)$/i, ''), html, loading: false, error: '', locked: false }
  } catch (err) {
    if (token !== previewToken) return
    const message = errorMessage(err) ?? 'Preview unavailable.'
    const locked = /locked/i.test(message)
    preview.value = { path, title: node.name.replace(/\.(md|markdown)$/i, ''), html: '', loading: false, error: locked ? '' : message, locked }
  }
}

function closePreview() {
  previewToken += 1
  preview.value = null
  // Return focus to the selected explorer row; editing context is untouched.
  treeState.focusTree()
  if (treeState.focusedPath.value) {
    treeRef.value?.querySelector(`[data-explorer-path="${CSS.escape(treeState.focusedPath.value)}"]`)?.scrollIntoView({ block: 'nearest' })
  }
}

function openPreviewNote(path: string) {
  closePreview()
  emit('open', path)
}

function scrollStorageKey(workspace: string) {
  return `tomosona.explorer.scroll.${workspace}`
}

function toggleExtensions() {
  showExtensions.value = !showExtensions.value
  window.localStorage.setItem(`tomosona.explorer.extensions.${props.folderPath}`, String(showExtensions.value))
}

function persistScroll() {
  if (!props.folderPath || hasActiveFilter.value || hasFilterText.value || !treeRef.value) return
  window.localStorage.setItem(scrollStorageKey(props.folderPath), String(treeRef.value.scrollTop))
}

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
const matchingRows = computed(() => filteredRows.value.filter((row) => {
  const node = treeState.nodeByPath.value[row.path]
  return node && explorerNameMatches(node, debouncedFilterQuery.value)
}))
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
  movePaths: operations.movePaths,
  expandedPaths: treeState.expandedPaths,
  toggleExpand: treeState.toggleExpand
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
  openPreview,
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

let selectingWithPointer = false

function updateSortFreeze() {
  treeState.setSortFrozen(selectingWithPointer || Boolean(operations.editingPath.value) || Boolean(creatingNote.value))
}

function beginPointerSelection(event: PointerEvent) {
  if (event.button !== 0) return
  selectingWithPointer = true
  updateSortFreeze()
}

function endPointerSelection() {
  selectingWithPointer = false
  updateSortFreeze()
}

watch([operations.editingPath, creatingNote], updateSortFreeze, { flush: 'sync' })

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
  if (filterDebounceTimer !== null) {
    window.clearTimeout(filterDebounceTimer)
    filterDebounceTimer = null
  }
  filterQuery.value = ''
  debouncedFilterQuery.value = ''
  if (unfilteredScrollTop !== null) {
    const position = unfilteredScrollTop
    unfilteredScrollTop = null
    void nextTick(() => { if (treeRef.value) treeRef.value.scrollTop = position })
  }
  isFilterVisible.value = true
  focusFilterInput()
}

async function onFilterKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (filterQuery.value.trim()) clearFilter()
    else { isFilterVisible.value = false; treeState.focusTree() }
  } else if (event.key === 'Enter' && filterQuery.value.trim()) {
    event.preventDefault()
    const query = filterQuery.value
    const workspace = props.folderPath
    await treeState.preloadAllDirs()
    if (query !== filterQuery.value || workspace !== props.folderPath) return
    const rows = filterExplorerRows(query, treeState.visibleRows.value, {
      rootPath: workspace,
      childrenByDir: treeState.childrenByDir.value
    }).filter((row) => {
      const node = treeState.nodeByPath.value[row.path]
      return node && explorerNameMatches(node, query)
    })
    if (rows.length === 1) {
      const node = treeState.nodeByPath.value[rows[0].path]
      if (node && !node.is_dir) await operations.openNode(node.path)
    }
  }
}

async function beginInlineNote(parent: string) {
  if (!parent || hasFilterText.value) return
  if (parent !== props.folderPath && !treeState.expandedPaths.value.has(parent)) {
    try { await treeState.toggleExpand(parent) } catch { emit('error', 'Could not open the destination folder.'); return }
  }
  creatingNote.value = { parent, error: '', busy: false }
}

async function confirmInlineNote(name: string) {
  const current = creatingNote.value
  if (!current || current.busy) return
  const workspace = props.folderPath
  const trimmed = name.trim()
  if (!trimmed || /[\\/<>:"|?*\x00-\x1f]/.test(trimmed)) {
    current.error = 'Enter a valid note name.'
    return
  }
  current.busy = true
  current.error = ''
  try {
    const path = await createInlineNote(current.parent, trimmed)
    if (workspace !== props.folderPath || creatingNote.value !== current) return
    creatingNote.value = null
    try { await treeState.loadChildren(current.parent) } catch { emit('error', 'Note created, but the explorer could not refresh.') }
    if (workspace === props.folderPath) emit('open', path)
  } catch (error) {
    if (workspace !== props.folderPath || creatingNote.value !== current) return
    current.error = String(error).toLowerCase().includes('already exists') ? 'A note with this name already exists.' : 'Could not create the note. Check the name and folder permissions.'
    current.busy = false
  }
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

  if (!node.is_dir && !event.shiftKey && !isToggle) {
    if (node.is_markdown) {
      if (rowActionMode.value === 'context-toggle') {
        emit('toggle-context', node.path)
        return
      }
      emit('open', node.path)
      return
    }
    emit('open', node.path)
  }
}

async function handleDoubleClick(node: TreeNode) {
  if (dnd.shouldSuppressPointerInteraction()) {
    return
  }

  if (node.is_dir) return
  if (node.is_markdown || await isTextFile(node.path)) {
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
    if (action === 'new-file') void beginInlineNote(parent || props.folderPath)
    else operations.requestCreate(parent || props.folderPath, 'folder')
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

  if (action === 'convert-to-word' && targetPath) {
    const node = treeState.nodeByPath.value[targetPath]
    if (node?.is_markdown) {
      emit('convert-to-word', targetPath)
    }
  }

  if (action === 'rename' && targetPath) {
    operations.startRename(targetPath)
  }

  if (action === 'preview' && targetPath) {
    void openPreview(targetPath)
    closeContextMenu()
    return
  }

  if (action === 'delete') {
    operations.requestDelete(selection)
  }

  if (action === 'duplicate') {
    await operations.runDuplicate(selection)
  }

  if (action === 'move-to') {
    openMoveDialog(selection)
    closeContextMenu()
    return
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
  async (workspace, previous) => {
    if (previous && treeRef.value && !hasActiveFilter.value) {
      window.localStorage.setItem(scrollStorageKey(previous), String(treeRef.value.scrollTop))
    }
    unfilteredScrollTop = null
    creatingNote.value = null
    moveDialogSources.value = null
    preview.value = null
    previewToken += 1
    loadRecentMoveDestinations()
    showExtensions.value = window.localStorage.getItem(`tomosona.explorer.extensions.${workspace}`) === 'true'
    treeState.resetState()
    await treeState.initializeExplorer()
    if (workspace !== props.folderPath) return
    fsSync.resetWatcherSession()
    await nextTick()
    const saved = Number(window.localStorage.getItem(scrollStorageKey(workspace)))
    if (treeRef.value && Number.isFinite(saved) && saved >= 0) treeRef.value.scrollTop = saved
  },
  { immediate: true }
)

watch(filterQuery, (next, previous) => {
  if (!previous.trim() && next.trim()) unfilteredScrollTop = treeRef.value?.scrollTop ?? 0
  if (filterDebounceTimer) {
    window.clearTimeout(filterDebounceTimer)
  }

  filterDebounceTimer = window.setTimeout(() => {
    debouncedFilterQuery.value = next
    if (!next.trim() && unfilteredScrollTop !== null) {
      const position = unfilteredScrollTop
      unfilteredScrollTop = null
      void nextTick(() => { if (treeRef.value) treeRef.value.scrollTop = position })
    }
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
  revealPathInView: treeState.revealPathInView,
  /** First selected file path, or null when the tree has no selection. */
  getSelectedFilePath: () => selectionManager.selectedPaths.value[0] ?? null
})

onMounted(() => {
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('pointerup', endPointerSelection)
  window.addEventListener('pointercancel', endPointerSelection)
  window.addEventListener('blur', endPointerSelection)
  fsSync.start()
  treeState.focusTree()
  loadRecentMoveDestinations()
  if (hasFilterText.value) {
    isFilterVisible.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('pointerup', endPointerSelection)
  window.removeEventListener('pointercancel', endPointerSelection)
  window.removeEventListener('blur', endPointerSelection)
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
        :can-reveal="Boolean(activePath)"
        :can-undo="props.canUndo"
        :show-extensions="showExtensions"
        :sort-order="treeState.sortOrder.value"
        @create-file="beginInlineNote(folderPath)"
        @create-folder="operations.requestCreate(folderPath, 'folder')"
        @expand-all="treeState.expandAllDirs"
        @collapse-all="treeState.collapseAllDirs"
        @refresh="fsSync.refreshLoadedDirs"
        @reveal-active="activePath && treeState.revealPathInView(activePath)"
        @toggle-extensions="toggleExtensions"
        @set-sort="treeState.setSortOrder"
        @toggle-search="toggleFilterVisibility"
        @undo="emit('undo')"
      />

      <div v-if="selectionPaths.length > 1" class="explorer-group-bar flex items-center gap-1 rounded-lg border px-2 py-1" role="toolbar" aria-label="Selection actions">
        <span class="explorer-group-bar-count text-xs">{{ selectionPaths.length }} selected</span>
        <button type="button" class="explorer-group-bar-btn text-xs" @click="openMoveDialog(selectionPaths)">Move to…</button>
        <button type="button" class="explorer-group-bar-btn text-xs" @click="operations.setClipboard('copy', selectionPaths)">Copy</button>
        <button type="button" class="explorer-group-bar-btn text-xs" @click="operations.setClipboard('cut', selectionPaths)">Cut</button>
        <button type="button" class="explorer-group-bar-btn text-xs" @click="operations.requestDelete(selectionPaths)">Delete</button>
      </div>

      <div v-if="isFilterVisible || hasFilterText" class="explorer-filter-shell">
        <MagnifyingGlassIcon class="explorer-filter-icon h-3.5 w-3.5" />
        <UiInput
          ref="filterInputRef"
          v-model="filterQuery"
          size="sm"
          class-name="explorer-filter !pl-8 pr-8"
          placeholder="Filter files and folders..."
          @keydown="onFilterKeydown"
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

      <p v-if="hasActiveFilter" class="explorer-empty-state px-2 text-xs" aria-live="polite">{{ matchingRows.length }} {{ matchingRows.length === 1 ? 'result' : 'results' }}</p>

      <div
        ref="treeRef"
        tabindex="0"
        class="min-h-0 flex-1 overflow-auto bg-transparent p-0.5 outline-none focus-visible:ring-0"
        @pointerdown.capture="beginPointerSelection"
        @scroll="persistScroll"
        @keydown="keyboard.onTreeKeydown"
        @contextmenu.prevent="onTreeContextMenu"
        @click="clearSelectionIfBackground"
      >
        <p v-if="!folderPath" class="explorer-empty-state px-2 py-1 text-xs">Select a working folder to start.</p>
        <p v-else-if="!filteredRows.length" class="explorer-empty-state px-2 py-1 text-xs">
          <template v-if="hasActiveFilter">No matching files or folders.</template>
          <template v-else>No files or folders. Use New file or New folder.</template>
        </p>

        <template v-if="creatingNote?.parent === folderPath">
          <ExplorerCreateInput :parent-path="creatingNote.parent" :error="creatingNote.error" :busy="creatingNote.busy" @confirm="confirmInlineNote" @cancel="creatingNote && !creatingNote.busy && (creatingNote = null)" />
        </template>
        <template v-for="row in filteredRows" :key="row.path">
          <ExplorerItem
            :node="treeState.nodeByPath.value[row.path]"
            :depth="row.depth"
            :expanded="treeState.expandedPaths.value.has(row.path)"
            :selected="selectionManager.isSelected(row.path)"
            :active="activePath === row.path"
            :focused="treeState.focusedPath.value === row.path"
            :cut-pending="Boolean(operations.clipboard.value?.mode === 'cut' && operations.clipboard.value.paths.includes(row.path))"
            :editing="operations.editingPath.value === row.path"
            :rename-value="operations.editingValue.value"
            :rename-selection-end="operations.editingSelectionEnd.value"
            :filter-query="debouncedFilterQuery"
            :show-extensions="showExtensions"
            :context-active="contextPathSet.has(row.path)"
            :dnd="dnd"
            @create-note="beginInlineNote"
            @toggle="treeState.toggleExpand"
            @click="handleRowClick"
            @doubleclick="handleDoubleClick"
            @contextmenu="onNodeContextMenu"
            @rowaction="onRowAction"
            @rename-update="operations.editingValue.value = $event"
            @rename-confirm="operations.confirmRename"
            @rename-cancel="operations.cancelRename"
          />
          <ExplorerCreateInput v-if="creatingNote?.parent === row.path" :style="{ paddingLeft: `${(row.depth + 1) * 14 + 8}px` }" :parent-path="creatingNote.parent" :error="creatingNote.error" :busy="creatingNote.busy" @confirm="confirmInlineNote" @cancel="creatingNote && !creatingNote.busy && (creatingNote = null)" />
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
        :can-convert="Boolean(contextMenu.targetPath && treeState.nodeByPath.value[contextMenu.targetPath]?.is_markdown)"
        :can-preview="Boolean(contextMenu.targetPath && treeState.nodeByPath.value[contextMenu.targetPath]?.is_markdown)"
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

      <ExplorerMoveDialog
        v-if="moveDialogSources"
        :root="folderPath"
        :folders="knownFolderPaths"
        :sources="moveDialogSources"
        :recent-destinations="recentMoveDestinations"
        :parent-of="getParentPath"
        @cancel="moveDialogSources = null"
        @confirm="confirmMoveDialog"
      />

      <ExplorerQuickPreview
        v-if="preview"
        :path="preview.path"
        :title="preview.title"
        :html="preview.html"
        :loading="preview.loading"
        :error="preview.error"
        :locked="preview.locked"
        @close="closePreview"
        @open="openPreviewNote"
      />
    </div>
  </DnDProvider>
</template>

<style scoped>
.explorer-filter-shell {
  position: relative;
}

.explorer-group-bar {
  border-color: var(--panel-border);
  background: var(--surface-bg);
}

.explorer-group-bar-count {
  color: var(--text-dim);
  margin-right: auto;
}

.explorer-group-bar-btn {
  color: var(--text-main);
  border-radius: var(--radius-sm, 6px);
  padding: 0.125rem 0.5rem;
}

.explorer-group-bar-btn:hover {
  background: var(--menu-item-hover-bg);
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
