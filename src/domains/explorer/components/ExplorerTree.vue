<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ExplorerContextMenu, { type MenuAction } from './ExplorerContextMenu.vue'
import ExplorerItem from './ExplorerItem.vue'
import {
  ArrowPathIcon,
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  DocumentPlusIcon,
  FolderPlusIcon
} from '@heroicons/vue/24/outline'
import { useSelectionManager } from './composables/useSelectionManager'
import { planWorkspaceFsActions } from './workspaceFsPlanner'
import {
  copyEntry,
  duplicateEntry,
  listChildren,
  listenWorkspaceFsChanged,
  moveEntry,
  openPathExternal,
  pathExists,
  renameEntry,
  revealInFileManager,
  trashEntry
} from '../../../shared/api/workspaceApi'
import type { ConflictStrategy, EntryKind, TreeNode, WorkspaceFsChange } from '../../../shared/api/apiTypes'
import {
  normalizeWorkspacePath,
  toWorkspaceRelativePath
} from '../lib/workspacePaths'
import UiButton from '../../../shared/components/ui/UiButton.vue'

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
  'request-create': [payload: { parentPath: string; entryKind: EntryKind }]
  'toggle-context': [path: string]
}>()

type VisibleRow = { kind: 'node'; path: string; depth: number }
type RevealPathOptions = {
  focusTree?: boolean
  behavior?: ScrollBehavior
}

const treeRoot = computed(() => props.folderPath)
const childrenByDir = ref<Record<string, TreeNode[]>>({})
const nodeByPath = ref<Record<string, TreeNode>>({})
const parentByPath = ref<Record<string, string>>({})
const expandedPaths = ref<Set<string>>(new Set())
const loadingDirs = ref<Set<string>>(new Set())
const pendingReloadDirs = ref<Set<string>>(new Set())
const focusedPath = ref<string>('')
const treeRef = ref<HTMLElement | null>(null)

const contextMenu = ref<{ x: number; y: number; targetPath: string | null } | null>(null)
const editingPath = ref<string>('')
const editingValue = ref('')

const conflictPrompt = ref<{
  title: string
  detail: string
  pending: ((strategy: ConflictStrategy) => Promise<void>) | null
} | null>(null)

const confirmPrompt = ref<{
  title: string
  detail: string
  intent: 'delete' | 'move_folders'
  payload: string[]
} | null>(null)

const clipboard = ref<{ mode: 'copy' | 'cut'; paths: string[] } | null>(null)

const selectionManager = useSelectionManager()

const isMac = navigator.platform.toLowerCase().includes('mac')

const selectionPaths = computed(() => selectionManager.selectedPaths.value)
const canPaste = computed(() => Boolean(clipboard.value?.paths.length && props.folderPath))
const rowActionMode = computed(() => props.rowActionMode ?? 'menu')
const contextPathSet = computed(() => new Set(props.contextPaths ?? []))

const visibleRows = computed<VisibleRow[]>(() => {
  const rows: VisibleRow[] = []
  const root = treeRoot.value
  if (!root) return rows

  const pushDir = (dirPath: string, depth: number) => {
    const children = childrenByDir.value[dirPath] ?? []

    for (const child of children) {
      rows.push({ kind: 'node', path: child.path, depth })
      if (child.is_dir && expandedPaths.value.has(child.path)) {
        pushDir(child.path, depth + 1)
      }
    }
  }

  pushDir(root, 0)
  return rows
})

const visibleNodePaths = computed(() =>
  visibleRows.value.filter((row): row is { kind: 'node'; path: string; depth: number } => row.kind === 'node').map((row) => row.path)
)

function emitError(message: string) {
  emit('error', message)
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

function getParentPath(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return path
  return normalized.slice(0, idx)
}

function getAncestorDirs(path: string): string[] {
  const root = normalizeWorkspacePath(props.folderPath)
  const target = normalizeWorkspacePath(path)
  const relative = toWorkspaceRelativePath(root, target)
  if (!root || !target || relative === '.' || relative === target) return []
  const segments = relative.split('/').slice(0, -1)
  const dirs: string[] = []

  let current = root
  for (const segment of segments) {
    current = `${current}/${segment}`
    dirs.push(current)
  }
  return dirs
}

function errorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return null
}

function isConflictError(err: unknown): boolean {
  const message = errorMessage(err)
  return Boolean(message && /already exists/i.test(message))
}

function persistExpandedState() {
  if (!props.folderPath) return
  const key = `tomosona.explorer.expanded.${props.folderPath}`
  window.localStorage.setItem(key, JSON.stringify(Array.from(expandedPaths.value)))
}

function loadExpandedState() {
  if (!props.folderPath) return
  const key = `tomosona.explorer.expanded.${props.folderPath}`
  const raw = window.localStorage.getItem(key)
  if (!raw) return

  try {
    const parsed = JSON.parse(raw) as string[]
    expandedPaths.value = new Set(parsed)
  } catch {
    expandedPaths.value = new Set()
  }
}

async function loadChildren(dirPath: string) {
  if (!props.folderPath) return
  if (loadingDirs.value.has(dirPath)) {
    pendingReloadDirs.value = new Set(pendingReloadDirs.value).add(dirPath)
    return
  }

  const nextLoading = new Set(loadingDirs.value)
  nextLoading.add(dirPath)
  loadingDirs.value = nextLoading

  try {
    const children = await listChildren(dirPath)
    childrenByDir.value[dirPath] = children

    for (const child of children) {
      nodeByPath.value[child.path] = child
      parentByPath.value[child.path] = dirPath
    }
  } finally {
    const done = new Set(loadingDirs.value)
    done.delete(dirPath)
    loadingDirs.value = done

    if (pendingReloadDirs.value.has(dirPath)) {
      const nextPending = new Set(pendingReloadDirs.value)
      nextPending.delete(dirPath)
      pendingReloadDirs.value = nextPending
      await loadChildren(dirPath)
    }
  }
}

async function refreshLoadedDirs() {
  if (!props.folderPath) return

  const dirs = new Set<string>([props.folderPath, ...Object.keys(childrenByDir.value)])
  for (const dir of dirs) {
    try {
      await loadChildren(dir)
    } catch {
      try {
        const exists = await pathExists(dir)
        if (!exists) {
          removePathFromCaches(dir)
        }
      } catch {
        // Skip transient refresh errors.
      }
    }
  }
}

async function refreshSpecificDirs(dirs: Iterable<string>) {
  if (!props.folderPath) return

  const loaded = new Set(Object.keys(childrenByDir.value))
  for (const dir of dirs) {
    if (dir !== props.folderPath && !loaded.has(dir)) {
      continue
    }

    try {
      await loadChildren(dir)
    } catch {
      try {
        const exists = await pathExists(dir)
        if (!exists) {
          removePathFromCaches(dir)
        }
      } catch {
        // Skip transient refresh errors.
      }
    }
  }
}

function removePathFromCaches(path: string) {
  const normalizedPath = normalizeWorkspacePath(path)
  const descendants = Object.keys(nodeByPath.value).filter(
    (candidate) => candidate === normalizedPath || candidate.startsWith(`${normalizedPath}/`)
  )

  for (const candidate of descendants) {
    delete nodeByPath.value[candidate]
    delete parentByPath.value[candidate]
    delete childrenByDir.value[candidate]
  }

  for (const dirPath of Object.keys(childrenByDir.value)) {
    const currentChildren = childrenByDir.value[dirPath] ?? []
    const filteredChildren = currentChildren.filter(
      (node) => node.path !== normalizedPath && !node.path.startsWith(`${normalizedPath}/`)
    )
    if (filteredChildren.length !== currentChildren.length) {
      childrenByDir.value[dirPath] = filteredChildren
    }
  }

  expandedPaths.value = new Set(
    Array.from(expandedPaths.value).filter(
      (candidate) => candidate !== normalizedPath && !candidate.startsWith(`${normalizedPath}/`)
    )
  )

  const nextSelection = selectionPaths.value.filter(
    (selected) => selected !== normalizedPath && !selected.startsWith(`${normalizedPath}/`)
  )
  if (nextSelection.length !== selectionPaths.value.length) {
    selectionManager.setSelection(nextSelection)
    emit('select', nextSelection)
  }

  if (focusedPath.value === normalizedPath || focusedPath.value.startsWith(`${normalizedPath}/`)) {
    focusedPath.value = ''
  }
}

function workspaceRootMatches(rootPath: string): boolean {
  const folder = normalizeWorkspacePath(props.folderPath)
  if (!folder) return false
  return normalizeWorkspacePath(rootPath) === folder
}

let pendingWorkspaceChanges: WorkspaceFsChange[] = []
let workspaceChangeFlushTimer: number | null = null
let latestWatcherSessionId = 0

function queueWorkspaceChanges(sessionId: number, changes: WorkspaceFsChange[]) {
  if (!props.folderPath || !changes.length) return
  if (sessionId < latestWatcherSessionId) return
  latestWatcherSessionId = sessionId

  pendingWorkspaceChanges.push(...changes)
  if (workspaceChangeFlushTimer !== null) return

  workspaceChangeFlushTimer = window.setTimeout(() => {
    workspaceChangeFlushTimer = null
    void flushWorkspaceChanges()
  }, 120)
}

async function flushWorkspaceChanges() {
  if (!props.folderPath || !pendingWorkspaceChanges.length) return

  const changes = pendingWorkspaceChanges
  pendingWorkspaceChanges = []

  const loaded = new Set(Object.keys(childrenByDir.value))
  const plan = planWorkspaceFsActions(props.folderPath, loaded, changes)

  for (const removedPath of plan.pathsToPrune) {
    removePathFromCaches(removedPath)
  }

  await refreshSpecificDirs(plan.dirsToRefresh)
}

async function expandAllDirs() {
  if (!props.folderPath) return

  const allDirs = new Set<string>()
  const queue: string[] = [props.folderPath]
  const visited = new Set<string>()

  while (queue.length) {
    const dir = queue.shift()
    if (!dir || visited.has(dir)) continue
    visited.add(dir)
    await loadChildren(dir)

    const children = childrenByDir.value[dir] ?? []
    for (const child of children) {
      if (!child.is_dir) continue
      allDirs.add(child.path)
      queue.push(child.path)
    }
  }

  expandedPaths.value = allDirs
  persistExpandedState()
}

function collapseAllDirs() {
  expandedPaths.value = new Set()
  persistExpandedState()
}

function currentContextTarget(): string | null {
  return contextMenu.value?.targetPath ?? null
}

function effectiveSelection(targetPath?: string | null): string[] {
  const selected = selectionPaths.value
  if (targetPath && selected.includes(targetPath)) {
    return selected
  }
  if (targetPath) {
    return [targetPath]
  }
  return selected
}

function openContextMenuAt(x: number, y: number, targetPath: string | null) {
  contextMenu.value = {
    x,
    y,
    targetPath
  }
}

function openContextMenu(event: MouseEvent, targetPath: string | null) {
  openContextMenuAt(event.clientX + 2, event.clientY + 2, targetPath)
}

function closeContextMenu() {
  contextMenu.value = null
}

function requestCreate(parentPath: string, entryKind: EntryKind) {
  emit('request-create', { parentPath, entryKind })
}

async function resolveConflictAndRetry(
  title: string,
  detail: string,
  action: (strategy: ConflictStrategy) => Promise<void>
) {
  conflictPrompt.value = {
    title,
    detail,
    pending: action
  }
}

async function runWithConflictModal(
  action: (strategy: ConflictStrategy) => Promise<void>,
  title: string,
  detail: string
) {
  try {
    await action('fail')
  } catch (err) {
    if (isConflictError(err)) {
      await resolveConflictAndRetry(title, detail, action)
      return
    }
    emitError(errorMessage(err) ?? 'Operation failed.')
  }
}

function startRename(path: string) {
  const node = nodeByPath.value[path]
  if (!node) return
  editingPath.value = path
  editingValue.value = node.name
}

function cancelRename() {
  editingPath.value = ''
  editingValue.value = ''
}

async function confirmRename() {
  const path = editingPath.value
  if (!path || !props.folderPath) return

  const wasMarkdown = /\.(md|markdown)$/i.test(path)
  const newName = editingValue.value.trim()
  if (!newName) {
    emitError('Name cannot be empty.')
    return
  }

  await runWithConflictModal(
    async (strategy) => {
      const renamedPath = await renameEntry(path, newName, strategy)
      const parent = getParentPath(path)
      cancelRename()
      await loadChildren(parent)

      if (selectionManager.isSelected(path)) {
        selectionManager.setSelection([renamedPath])
      }
      if (focusedPath.value === path) {
        focusedPath.value = renamedPath
      }
      emit('select', selectionManager.selectedPaths.value)
      if (wasMarkdown && /\.(md|markdown)$/i.test(renamedPath) && path !== renamedPath) {
        emit('path-renamed', { from: path, to: renamedPath })
      }
    },
    'File or folder already exists',
    'Choose how to proceed.'
  )
}

function requestDelete(paths: string[]) {
  if (!paths.length) return

  const folderCount = paths.filter((path) => nodeByPath.value[path]?.is_dir).length
  const base = paths.length === 1 ? `Delete "${nodeByPath.value[paths[0]]?.name || 'item'}"?` : `Delete ${paths.length} items?`
  const detail =
    folderCount > 0
      ? 'Some selected items are folders. Deletion moves them to trash recursively.'
      : 'Selected items will be moved to trash.'

  confirmPrompt.value = {
    title: base,
    detail,
    intent: 'delete',
    payload: paths
  }
}

async function executeDelete(paths: string[]) {
  if (!props.folderPath || !paths.length) return

  for (const path of paths) {
    try {
      await trashEntry(path)
    } catch (err) {
      emitError(errorMessage(err) ?? 'Delete failed.')
    }
  }

  selectionManager.clearSelection()
  focusedPath.value = ''
  emit('select', [])
  await refreshLoadedDirs()
}

async function runDuplicate(paths: string[]) {
  if (!props.folderPath || !paths.length) return

  await runWithConflictModal(
    async (strategy) => {
      for (const path of paths) {
        await duplicateEntry(path, strategy)
      }
      await refreshLoadedDirs()
    },
    'Name conflict while duplicating',
    'Choose how to handle conflicts.'
  )
}

function setClipboard(mode: 'copy' | 'cut', paths: string[]) {
  if (!paths.length) return
  clipboard.value = { mode, paths }
}

async function runPaste(targetPath?: string | null) {
  if (!props.folderPath || !clipboard.value) return

  const target = targetPath || focusedPath.value || props.folderPath
  const targetNode = nodeByPath.value[target]
  const targetDir = targetNode?.is_dir ? target : getParentPath(target)

  const sourcePaths = clipboard.value.paths
  if (!sourcePaths.length) return

  const hasFolderMove = clipboard.value.mode === 'cut' && sourcePaths.some((path) => nodeByPath.value[path]?.is_dir)
  if (hasFolderMove) {
    confirmPrompt.value = {
      title: 'Move selected folders?',
      detail: 'Moving folders can affect many files. Confirm this operation.',
      intent: 'move_folders',
      payload: sourcePaths
    }
    return
  }

  await executePaste(targetDir, sourcePaths)
}

async function executePaste(targetDir: string, pathsOverride?: string[]) {
  if (!props.folderPath || !clipboard.value) return

  const sources = pathsOverride ?? clipboard.value.paths
  const mode = clipboard.value.mode

  await runWithConflictModal(
    async (strategy) => {
      for (const source of sources) {
        if (mode === 'copy') {
          await copyEntry(source, targetDir, strategy)
        } else {
          await moveEntry(source, targetDir, strategy)
        }
      }

      if (mode === 'cut') {
        clipboard.value = null
      }
      await refreshLoadedDirs()
    },
    'Name conflict while pasting',
    'Choose how to handle conflicts.'
  )
}

async function openSelected(paths: string[]) {
  if (!paths.length) return
  const first = nodeByPath.value[paths[0]]
  if (!first || first.is_dir) return
  if (first.is_markdown) {
    emit('open', first.path)
  } else {
    await openPathExternal(first.path)
  }
}

function handleRowClick(event: MouseEvent, node: TreeNode) {
  const ordered = visibleNodePaths.value
  const isToggle = isMac ? event.metaKey : event.ctrlKey

  if (event.shiftKey) {
    selectionManager.selectRange(node.path, ordered)
  } else if (isToggle) {
    selectionManager.toggleSelection(node.path)
  } else {
    selectionManager.selectSingle(node.path)
  }

  focusedPath.value = node.path
  emit('select', selectionManager.selectedPaths.value)

  if (node.is_dir && !event.shiftKey && !isToggle) {
    void toggleExpand(node.path)
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
  if (node.is_dir) return
  if (node.is_markdown) {
    emit('open', node.path)
  } else {
    void openPathExternal(node.path)
  }
}

async function toggleExpand(path: string) {
  const expanded = new Set(expandedPaths.value)
  if (expanded.has(path)) {
    expanded.delete(path)
  } else {
    expanded.add(path)
    await loadChildren(path)
  }
  expandedPaths.value = expanded
  persistExpandedState()
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
  if (event.target === event.currentTarget) {
    selectionManager.clearSelection()
    emit('select', [])
  }
}

function focusTree() {
  treeRef.value?.focus()
}

async function onContextAction(action: MenuAction) {
  const targetPath = currentContextTarget()
  const targetNode = targetPath ? nodeByPath.value[targetPath] : null
  const selection = effectiveSelection(targetPath)

  if (action === 'new-file' || action === 'new-folder') {
    const parent = targetNode?.is_dir ? targetNode.path : targetPath ? getParentPath(targetPath) : props.folderPath
    requestCreate(parent || props.folderPath, action === 'new-file' ? 'file' : 'folder')
    closeContextMenu()
    return
  }

  if (action === 'open') {
    await openSelected(selection)
  }

  if (action === 'open-external' && targetPath) {
    await openPathExternal(targetPath)
  }

  if (action === 'reveal' && targetPath) {
    await revealInFileManager(targetPath)
  }

  if (action === 'rename' && targetPath) {
    startRename(targetPath)
  }

  if (action === 'delete') {
    requestDelete(selection)
  }

  if (action === 'duplicate') {
    await runDuplicate(selection)
  }

  if (action === 'copy') {
    setClipboard('copy', selection)
  }

  if (action === 'cut') {
    setClipboard('cut', selection)
  }

  if (action === 'paste') {
    await runPaste(targetPath)
  }

  closeContextMenu()
}

function ensureFocusedPath(defaultToFirst = true) {
  if (focusedPath.value && visibleNodePaths.value.includes(focusedPath.value)) {
    return focusedPath.value
  }

  if (defaultToFirst && visibleNodePaths.value.length) {
    focusedPath.value = visibleNodePaths.value[0]
    return focusedPath.value
  }

  return ''
}

async function onTreeKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target) {
    const tag = target.tagName.toLowerCase()
    const isTextInput = tag === 'input' || tag === 'textarea'
    const isEditable = target.isContentEditable
    if (isTextInput || isEditable) {
      return
    }
  }

  const ordered = visibleNodePaths.value
  if (!ordered.length) return

  const focused = ensureFocusedPath()
  if (!focused) return

  const currentIndex = ordered.indexOf(focused)
  const key = event.key
  const ctrlOrMeta = isMac ? event.metaKey : event.ctrlKey

  if (key === 'ArrowDown') {
    event.preventDefault()
    const next = ordered[Math.min(currentIndex + 1, ordered.length - 1)]
    if (!next) return
    if (event.shiftKey) {
      selectionManager.selectRange(next, ordered)
    } else {
      selectionManager.selectSingle(next)
    }
    focusedPath.value = next
    emit('select', selectionManager.selectedPaths.value)
    return
  }

  if (key === 'ArrowUp') {
    event.preventDefault()
    const prev = ordered[Math.max(currentIndex - 1, 0)]
    if (!prev) return
    if (event.shiftKey) {
      selectionManager.selectRange(prev, ordered)
    } else {
      selectionManager.selectSingle(prev)
    }
    focusedPath.value = prev
    emit('select', selectionManager.selectedPaths.value)
    return
  }

  const focusedNode = nodeByPath.value[focused]
  if (!focusedNode) return

  if (key === 'ArrowRight') {
    event.preventDefault()
    if (focusedNode.is_dir) {
      if (!expandedPaths.value.has(focusedNode.path)) {
        await toggleExpand(focusedNode.path)
      } else {
        const children = childrenByDir.value[focusedNode.path] ?? []
        const firstChild = children[0]
        if (firstChild) {
          selectionManager.selectSingle(firstChild.path)
          focusedPath.value = firstChild.path
          emit('select', selectionManager.selectedPaths.value)
        }
      }
    }
    return
  }

  if (key === 'ArrowLeft') {
    event.preventDefault()
    if (focusedNode.is_dir && expandedPaths.value.has(focusedNode.path)) {
      await toggleExpand(focusedNode.path)
      return
    }

    const parent = parentByPath.value[focusedNode.path]
    if (parent && parent !== props.folderPath) {
      selectionManager.selectSingle(parent)
      focusedPath.value = parent
      emit('select', selectionManager.selectedPaths.value)
    }
    return
  }

  if (key === 'Enter') {
    event.preventDefault()
    if (focusedNode.is_dir) {
      await toggleExpand(focusedNode.path)
    } else {
      if (focusedNode.is_markdown) {
        emit('open', focusedNode.path)
      } else {
        await openPathExternal(focusedNode.path)
      }
    }
    return
  }

  if (key === 'F2') {
    event.preventDefault()
    if (selectionPaths.value.length === 1) {
      startRename(selectionPaths.value[0])
    }
    return
  }

  if (key === 'Delete') {
    event.preventDefault()
    if (selectionPaths.value.length) {
      requestDelete(selectionPaths.value)
    }
    return
  }

  if (ctrlOrMeta && key.toLowerCase() === 'c') {
    event.preventDefault()
    setClipboard('copy', selectionPaths.value)
    return
  }

  if (ctrlOrMeta && key.toLowerCase() === 'x') {
    event.preventDefault()
    setClipboard('cut', selectionPaths.value)
    return
  }

  if (ctrlOrMeta && key.toLowerCase() === 'v') {
    event.preventDefault()
    await runPaste()
    return
  }

  if (ctrlOrMeta && key.toLowerCase() === 'n') {
    event.preventDefault()
    requestCreate(props.folderPath, event.shiftKey ? 'folder' : 'file')
    return
  }

  if (ctrlOrMeta && key.toLowerCase() === 'a') {
    event.preventDefault()
    const parent = parentByPath.value[focused] || props.folderPath
    const siblings = childrenByDir.value[parent] ?? []
    selectionManager.setSelection(siblings.map((node) => node.path))
    emit('select', selectionManager.selectedPaths.value)
  }
}

async function initializeExplorer() {
  if (!props.folderPath) {
    childrenByDir.value = {}
    nodeByPath.value = {}
    parentByPath.value = {}
    expandedPaths.value = new Set()
    pendingReloadDirs.value = new Set()
    selectionManager.clearSelection()
    focusedPath.value = ''
    return
  }

  loadExpandedState()
  await loadChildren(props.folderPath)

  const expanded = Array.from(expandedPaths.value)
  for (const dirPath of expanded) {
    if (dirPath !== props.folderPath) {
      try {
        await loadChildren(dirPath)
      } catch {
        // Ignore stale expanded folders.
      }
    }
  }

  const activePath = props.activePath?.trim() ?? ''
  if (activePath) {
    await revealPathInView(activePath, { behavior: 'auto' })
    return
  }

  if (!selectionPaths.value.length && visibleNodePaths.value.length) {
    selectionManager.selectSingle(visibleNodePaths.value[0])
    focusedPath.value = visibleNodePaths.value[0]
    emit('select', selectionManager.selectedPaths.value)
  }
}

async function revealPath(path: string) {
  if (!path || !props.folderPath) return
  await loadChildren(props.folderPath)
  const ancestors = getAncestorDirs(path)
  for (const dir of ancestors) {
    if (!expandedPaths.value.has(dir)) {
      expandedPaths.value = new Set(expandedPaths.value).add(dir)
      await loadChildren(dir)
    }
  }
  persistExpandedState()
  selectionManager.selectSingle(path)
  focusedPath.value = path
  emit('select', selectionManager.selectedPaths.value)
}

async function revealPathInView(path: string, options: RevealPathOptions = {}) {
  await revealPath(path)
  await nextTick()
  const container = treeRef.value
  if (!container) return
  const selector = `[data-explorer-path="${escapeSelectorValue(path)}"]`
  const row = container.querySelector<HTMLElement>(selector)
  if (row) {
    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const nextTop =
      container.scrollTop +
      (rowRect.top - containerRect.top) -
      (container.clientHeight - rowRect.height) / 2
    container.scrollTo({
      top: Math.max(0, nextTop),
      behavior: options.behavior ?? 'auto'
    })
  }
  if (options.focusTree) {
    focusTree()
  }
}

let unlistenWorkspaceFsChanged: (() => void) | null = null

function closeConflictPrompt() {
  conflictPrompt.value = null
}

async function resolveConflict(strategy: ConflictStrategy) {
  if (!conflictPrompt.value?.pending) {
    closeConflictPrompt()
    return
  }

  const pending = conflictPrompt.value.pending
  closeConflictPrompt()

  try {
    await pending(strategy)
  } catch (err) {
    emitError(errorMessage(err) ?? 'Operation failed.')
  }
}

function cancelConfirmPrompt() {
  confirmPrompt.value = null
}

async function confirmPromptAction() {
  if (!confirmPrompt.value) return
  const prompt = confirmPrompt.value
  confirmPrompt.value = null

  if (prompt.intent === 'delete') {
    await executeDelete(prompt.payload)
    return
  }

  if (prompt.intent === 'move_folders') {
    const target = currentContextTarget() || focusedPath.value || props.folderPath
    const targetNode = nodeByPath.value[target]
    const targetDir = targetNode?.is_dir ? target : getParentPath(target)
    await executePaste(targetDir, prompt.payload)
  }
}

watch(
  () => props.folderPath,
  async () => {
    await initializeExplorer()
    pendingWorkspaceChanges = []
    latestWatcherSessionId = 0
  },
  { immediate: true }
)

watch(
  () => props.activePath,
  async (next) => {
    if (!next || !props.folderPath) return
    await revealPathInView(next)
  },
  { immediate: true }
)

defineExpose({
  revealPathInView
})

onMounted(() => {
  window.addEventListener('click', closeContextMenu)
  void listenWorkspaceFsChanged((payload) => {
    if (!workspaceRootMatches(payload.root)) return
    queueWorkspaceChanges(payload.session_id, payload.changes)
  }).then((unlisten) => {
    unlistenWorkspaceFsChanged = unlisten
  })
  focusTree()
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  if (workspaceChangeFlushTimer !== null) {
    window.clearTimeout(workspaceChangeFlushTimer)
    workspaceChangeFlushTimer = null
  }
  pendingWorkspaceChanges = []
  pendingReloadDirs.value = new Set()
  if (unlistenWorkspaceFsChanged) {
    unlistenWorkspaceFsChanged()
    unlistenWorkspaceFsChanged = null
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="explorer-toolbar flex flex-wrap items-center gap-1 border-b pb-1">
      <button
        type="button"
        class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
        title="New note"
        aria-label="New note"
        :disabled="!folderPath"
        @click="requestCreate(folderPath, 'file')"
      >
        <DocumentPlusIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
        title="New folder"
        aria-label="New folder"
        :disabled="!folderPath"
        @click="requestCreate(folderPath, 'folder')"
      >
        <FolderPlusIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
        title="Expand all folders"
        aria-label="Expand all folders"
        :disabled="!folderPath"
        @click="expandAllDirs"
      >
        <ChevronDoubleDownIcon class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
        title="Collapse all folders"
        aria-label="Collapse all folders"
        :disabled="!folderPath"
        @click="collapseAllDirs"
      >
        <ChevronDoubleUpIcon class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition disabled:opacity-40 disabled:hover:bg-transparent"
        title="Refresh explorer"
        aria-label="Refresh explorer"
        :disabled="!folderPath"
        @click="refreshLoadedDirs"
      >
        <ArrowPathIcon class="h-3.5 w-3.5" />
      </button>
    </div>

    <div
      ref="treeRef"
      tabindex="0"
      class="min-h-0 flex-1 overflow-auto bg-transparent p-0.5 outline-none focus-visible:ring-0"
      @keydown="onTreeKeydown"
      @contextmenu.prevent="onTreeContextMenu"
      @click="clearSelectionIfBackground"
    >
      <p v-if="!folderPath" class="explorer-empty-state px-2 py-1 text-xs">Select a working folder to start.</p>
      <p v-else-if="!visibleRows.length" class="explorer-empty-state px-2 py-1 text-xs">No files or folders. Use New file or New folder.</p>

      <template v-else>
        <ExplorerItem
          v-for="row in visibleRows"
          :key="row.path"
          :node="nodeByPath[row.path]"
          :depth="row.depth"
          :expanded="expandedPaths.has(row.path)"
          :selected="selectionManager.isSelected(row.path)"
          :active="activePath === row.path"
          :focused="focusedPath === row.path"
          :cut-pending="Boolean(clipboard?.mode === 'cut' && clipboard.paths.includes(row.path))"
          :editing="editingPath === row.path"
          :rename-value="editingValue"
          :context-active="contextPathSet.has(row.path)"
          @toggle="toggleExpand"
          @click="handleRowClick"
          @doubleclick="handleDoubleClick"
          @contextmenu="onNodeContextMenu"
          @rowaction="onRowAction"
          @rename-update="editingValue = $event"
          @rename-confirm="confirmRename"
          @rename-cancel="cancelRename"
        />
      </template>
    </div>

    <ExplorerContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :can-open="Boolean(contextMenu.targetPath)"
      :can-paste="canPaste"
      :can-rename="Boolean(contextMenu.targetPath)"
      :can-delete="Boolean(contextMenu.targetPath)"
      @action="onContextAction"
    />

    <div v-if="conflictPrompt" class="explorer-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
      <div class="explorer-modal w-full max-w-sm rounded-2xl border p-4">
        <h3 class="explorer-modal-title text-sm font-semibold">{{ conflictPrompt.title }}</h3>
        <p class="explorer-modal-copy mt-1 text-xs">{{ conflictPrompt.detail }}</p>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <UiButton size="sm" variant="ghost" @click="closeConflictPrompt">Cancel</UiButton>
          <UiButton size="sm" @click="resolveConflict('rename')">Keep both</UiButton>
          <UiButton size="sm" variant="primary" @click="resolveConflict('overwrite')">Replace</UiButton>
        </div>
      </div>
    </div>

    <div v-if="confirmPrompt" class="explorer-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
      <div class="explorer-modal w-full max-w-sm rounded-2xl border p-4">
        <h3 class="explorer-modal-title text-sm font-semibold">{{ confirmPrompt.title }}</h3>
        <p class="explorer-modal-copy mt-1 text-xs">{{ confirmPrompt.detail }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <UiButton size="sm" variant="ghost" @click="cancelConfirmPrompt">Cancel</UiButton>
          <UiButton size="sm" variant="primary" @click="confirmPromptAction">Confirm</UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  border-color: color-mix(in srgb, var(--border-strong) 72%, transparent);
}

.explorer-toolbar-btn {
  color: var(--text-soft);
}

.explorer-toolbar-btn:hover:not(:disabled) {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-empty-state {
  color: var(--text-dim);
}

.explorer-modal-backdrop {
  background: var(--menu-backdrop);
}

.explorer-modal {
  border-color: var(--panel-border);
  background: var(--surface-bg);
  box-shadow: var(--menu-shadow);
}

.explorer-modal-title {
  color: var(--text-main);
}

.explorer-modal-copy {
  color: var(--text-dim);
}
</style>
