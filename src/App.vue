<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorPaneGrid, { type EditorPaneGridExposed } from './components/panes/EditorPaneGrid.vue'
import EditorRightPane from './components/EditorRightPane.vue'
import SidebarSurface from './components/app/SidebarSurface.vue'
import IndexStatusModal from './components/app/IndexStatusModal.vue'
import QuickOpenModal from './components/app/QuickOpenModal.vue'
import ShortcutsModal from './components/app/ShortcutsModal.vue'
import TopbarNavigationControls from './components/app/TopbarNavigationControls.vue'
import WikilinkRewriteModal from './components/app/WikilinkRewriteModal.vue'
import WorkspaceEntryModals from './components/app/WorkspaceEntryModals.vue'
import WorkspaceStatusBar from './components/app/WorkspaceStatusBar.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import { useDocumentHistory } from './composables/useDocumentHistory'
import {
  backlinksForPath,
  clearWorkingFolder,
  createEntry,
  ftsSearch,
  getWikilinkGraph,
  initDb,
  listMarkdownFiles,
  listChildren,
  pathExists,
  readFileMetadata,
  readIndexLogs,
  readIndexRuntimeStatus,
  readTextFile,
  rebuildWorkspaceIndex,
  removeMarkdownFileFromIndex,
  renameEntry,
  refreshSemanticEdgesCacheNow,
  requestIndexCancel,
  reindexMarkdownFileLexical,
  reindexMarkdownFileSemantic,
  readPropertyTypeSchema,
  revealInFileManager,
  setWorkingFolder,
  selectWorkingFolder,
  type WikilinkGraph,
  listenWorkspaceFsChanged,
  updateWikilinksForRename,
  writePropertyTypeSchema,
  writeTextFile
} from './lib/api'
import { parseSearchSnippet } from './lib/searchSnippets'
import { applySearchMode, detectSearchMode, type SearchMode } from './lib/searchMode'
import { hasActiveTextSelectionInEditor, shouldBlockGlobalShortcutsFromTarget } from './lib/shortcutTargets'
import { parseWikilinkTarget } from './lib/wikilinks'
import { buildCosmosGraph } from './lib/graphIndex'
import {
  createDeliberationSession,
  loadDeliberationSession,
  replaceSessionContext
} from './lib/secondBrainApi'
import {
  normalizeContextPathsForUpdate,
  toAbsoluteWorkspacePath,
  workspaceScopedSecondBrainSessionKey
} from './lib/secondBrainContextPaths'
import {
  dailyNotePath,
  fileName,
  formatIsoDate,
  formatTimestamp,
  isIsoDate,
  isMarkdownPath,
  normalizePath,
  normalizePathKey,
  normalizeRelativeNotePath,
  parseIsoDateInput,
  sanitizeRelativePath
} from './lib/appShellPaths'
import { formatDurationMs } from './lib/indexActivity'
import { useAppIndexingController } from './composables/useAppIndexingController'
import {
  useAppNavigationController,
  type CosmosHistorySnapshot,
  type SecondBrainHistorySnapshot
} from './composables/useAppNavigationController'
import { useAppModalController } from './composables/useAppModalController'
import { useAppSecondBrainBridge } from './composables/useAppSecondBrainBridge'
import { useAppQuickOpen, type PaletteAction, type QuickOpenResult } from './composables/useAppQuickOpen'
import { useAppTheme, type ThemePreference } from './composables/useAppTheme'
import { useAppWorkspaceController } from './composables/useAppWorkspaceController'
import { useEditorState } from './composables/useEditorState'
import { useEchoesDiscoverability } from './composables/useEchoesDiscoverability'
import { useEchoesPack } from './composables/useEchoesPack'
import { useCosmosController } from './composables/useCosmosController'
import { useFilesystemState } from './composables/useFilesystemState'
import { useWorkspaceState, type SidebarMode } from './composables/useWorkspaceState'
import {
  createInitialLayout,
  hydrateLayout,
  serializeLayout,
  useMultiPaneWorkspaceState
} from './composables/useMultiPaneWorkspaceState'

type SearchHit = { path: string; snippet: string; score: number }
type PropertyPreviewRow = { key: string; value: string }
type SemanticLinkRow = { path: string; score: number | null; direction: 'incoming' | 'outgoing' }

type EditorViewExposed = EditorPaneGridExposed

type ExplorerTreeExposed = {
  revealPathInView: (path: string, options?: { focusTree?: boolean; behavior?: ScrollBehavior }) => Promise<void>
}

type SaveFileOptions = {
  explicit: boolean
}

type SaveFileResult = {
  persisted: boolean
}

type RenameFromTitleResult = {
  path: string
  title: string
}

type VirtualDoc = {
  content: string
  titleLine: string
}

const THEME_STORAGE_KEY = 'tomosona.theme.preference'
const WORKING_FOLDER_STORAGE_KEY = 'tomosona.working-folder.path'
const EDITOR_ZOOM_STORAGE_KEY = 'tomosona:editor:zoom'
const MULTI_PANE_STORAGE_KEY = 'tomosona:editor:multi-pane'
const VIEW_MODE_STORAGE_KEY = 'tomosona:view:active'
const PREVIOUS_NON_COSMOS_VIEW_MODE_STORAGE_KEY = 'tomosona:view:last-non-cosmos'

const workspace = useWorkspaceState()
const editorState = useEditorState()
const filesystem = useFilesystemState()
const documentHistory = useDocumentHistory()
const {
  themePreference,
  resolvedTheme,
  applyTheme,
  loadThemePreference,
  persistThemePreference,
  onSystemThemeChanged
} = useAppTheme({ storageKey: THEME_STORAGE_KEY })
const isMacOs = typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent)

const searchQuery = ref('')
const searchHits = ref<SearchHit[]>([])
const searchLoading = ref(false)
const hasSearched = ref(false)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let searchRequestToken = 0
const quickOpenVisible = ref(false)
const quickOpenQuery = ref('')
const quickOpenActiveIndex = ref(0)
const leftPaneWidth = ref(290)
const rightPaneWidth = ref(300)
const editorRef = ref<EditorViewExposed | null>(null)
const explorerRef = ref<ExplorerTreeExposed | null>(null)
const topbarRef = ref<InstanceType<typeof TopbarNavigationControls> | null>(null)
const backlinks = ref<string[]>([])
const backlinksLoading = ref(false)
const semanticLinks = ref<SemanticLinkRow[]>([])
const semanticLinksLoading = ref(false)
const propertiesPreview = ref<PropertyPreviewRow[]>([])
const propertyParseErrorCount = ref(0)
const virtualDocs = ref<Record<string, VirtualDoc>>({})
const overflowMenuOpen = ref(false)
const editorZoom = ref(1)
const wikilinkRewritePrompt = ref<{ fromPath: string; toPath: string } | null>(null)
const newFileModalVisible = ref(false)
const newFilePathInput = ref('')
const newFileModalError = ref('')
const newFolderModalVisible = ref(false)
const newFolderPathInput = ref('')
const newFolderModalError = ref('')
const openDateModalVisible = ref(false)
const openDateInput = ref('')
const openDateModalError = ref('')
const settingsModalVisible = ref(false)
const shortcutsModalVisible = ref(false)
const cosmosCommandLoadingVisible = ref(false)
const cosmosCommandLoadingLabel = ref('Loading graph...')
const shortcutsFilterQuery = ref('')
const previousNonCosmosMode = ref<SidebarMode>('explorer')
const hydratedMultiPane = hydrateLayout(
  (() => {
    const raw = window.sessionStorage.getItem(MULTI_PANE_STORAGE_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  })()
)
const multiPane = useMultiPaneWorkspaceState(hydratedMultiPane ?? createInitialLayout())
const wikilinkRewriteQueue: Array<{
  fromPath: string
  toPath: string
  resolve: (approved: boolean) => void
}> = []
let wikilinkRewriteResolver: ((approved: boolean) => void) | null = null
const historyMenuOpen = ref<'back' | 'forward' | null>(null)
const historyMenuStyle = ref<Record<string, string>>({})
let historyMenuTimer: ReturnType<typeof setTimeout> | null = null
let historyLongPressTarget: 'back' | 'forward' | null = null
let unlistenWorkspaceFsChanged: (() => void) | null = null

const resizeState = ref<{
  side: 'left' | 'right'
  startX: number
  startWidth: number
} | null>(null)

const paneCount = computed(() => Object.keys(multiPane.layout.value.panesById).length)
const activeFilePath = computed(() => multiPane.getActiveDocumentPath())
const activeStatus = computed(() => editorState.getStatus(activeFilePath.value))
const noteEchoes = useEchoesPack(activeFilePath, { limit: 5 })
const noteEchoesDiscoverability = useEchoesDiscoverability()
const cosmos = useCosmosController({
  workingFolderPath: filesystem.workingFolderPath,
  activeTabPath: activeFilePath,
  getWikilinkGraph,
  reindexMarkdownFile: reindexMarkdownFileLexical,
  readTextFile: async (path: string) => await readTextFile(path),
  ftsSearch,
  buildCosmosGraph
})
const workspaceController = useAppWorkspaceController({
  workingFolderPath: filesystem.workingFolderPath,
  hasWorkspace: filesystem.hasWorkspace,
  activeFilePath,
  indexingState: filesystem.indexingState,
  errorMessage: filesystem.errorMessage,
  selectedCount: filesystem.selectedCount,
  storageKey: WORKING_FOLDER_STORAGE_KEY,
  setWorkspacePath: (path) => filesystem.setWorkspacePath(path),
  clearWorkspacePath: () => filesystem.clearWorkspacePath(),
  resetIndexingState: () => indexing.resetIndexingState(),
  setWorkingFolder,
  clearWorkingFolder,
  initDb,
  readFileMetadata,
  pathExists,
  listChildren,
  listMarkdownFiles,
  readPropertyTypeSchema,
  writePropertyTypeSchema,
  createEntry,
  writeTextFile,
  normalizePath,
  normalizePathKey,
  isMarkdownPath,
  isIsoDate,
  dailyNotePath,
  enqueueMarkdownReindex: (path) => indexing.enqueueMarkdownReindex(path),
  removeMarkdownFromIndexInBackground: (path) => indexing.removeMarkdownFromIndexInBackground(path),
  refreshBacklinks,
  refreshCosmosGraph: () => cosmos.refreshGraph(),
  hasCosmosSurface: () => multiPane.findPaneContainingSurface('cosmos') !== null
})
const {
  allWorkspaceFiles,
  activeFileMetadata,
  toRelativePath,
  resetWorkspaceState,
  upsertWorkspaceFilePath,
  replaceWorkspaceFilePath,
  refreshActiveFileMetadata,
  ensureParentFolders,
  loadAllFiles,
  openDailyNote,
  loadWikilinkTargets,
  loadPropertyTypeSchema,
  savePropertyTypeSchema,
  applyWorkspaceFsChanges,
  closeWorkspace: closeWorkspaceInternal,
  loadWorkingFolder: loadWorkingFolderInternal
} = workspaceController
const indexing = useAppIndexingController({
  workingFolderPath: filesystem.workingFolderPath,
  hasWorkspace: filesystem.hasWorkspace,
  indexingState: filesystem.indexingState,
  readIndexLogs,
  readIndexRuntimeStatus,
  requestIndexCancel,
  rebuildWorkspaceIndex,
  reindexMarkdownFileLexical,
  reindexMarkdownFileSemantic,
  refreshSemanticEdgesCacheNow,
  removeMarkdownFileFromIndex,
  isMarkdownPath,
  toRelativePath,
  refreshBacklinks,
  refreshCosmosGraph: () => cosmos.refreshGraph(),
  hasCosmosSurface: () => multiPane.findPaneContainingSurface('cosmos') !== null,
  confirmStopCurrentOperation: () => typeof window === 'undefined' || window.confirm('Cancel current indexing run?'),
  notifyInfo: (message) => filesystem.notifyInfo(message),
  notifySuccess: (message) => filesystem.notifySuccess(message),
  notifyError: (message) => filesystem.notifyError(message)
})
const {
  semanticIndexState,
  indexRunKind,
  indexRunPhase,
  indexRunCurrentPath,
  indexRunCompleted,
  indexRunTotal,
  indexFinalizeCompleted,
  indexFinalizeTotal,
  indexRunMessage,
  indexRunLastFinishedAt,
  indexStatusBusy,
  indexRuntimeStatus,
  indexLogFilter,
  indexStatusModalVisible,
  indexStateLabel,
  indexStateClass,
  indexRunning,
  indexProgressLabel,
  indexActionLabel,
  indexModelStatusLabel,
  indexStatusBadgeLabel,
  indexStatusBadgeClass,
  indexProgressPercent,
  indexProgressSummary,
  indexShowProgressBar,
  indexModelStateClass,
  indexShowWarmupNote,
  indexAlert,
  filteredIndexActivityRows,
  indexErrorCount,
  indexSlowCount,
  markIndexOutOfSync,
  refreshIndexModalData,
  openIndexStatusModal: openIndexStatusModalInternal,
  closeIndexStatusModal: closeIndexStatusModalInternal,
  onIndexPrimaryAction: onIndexPrimaryActionInternal,
  enqueueMarkdownReindex,
  rebuildIndex: rebuildIndexInternal,
  dispose: disposeIndexingController
} = indexing
const modalController = useAppModalController({
  quickOpenVisible,
  cosmosCommandLoadingVisible,
  indexStatusModalVisible,
  newFileModalVisible,
  newFolderModalVisible,
  openDateModalVisible,
  settingsModalVisible,
  shortcutsModalVisible,
  wikilinkRewriteVisible: computed(() => Boolean(wikilinkRewritePrompt.value)),
  focusEditor: () => {
    editorRef.value?.focusEditor()
  }
})
const {
  rememberFocusBeforeModalOpen,
  hasBlockingModalOpen,
  restoreFocusAfterModalClose,
  trapTabWithinActiveModal
} = modalController
const secondBrainBridge = useAppSecondBrainBridge({
  workingFolderPath: filesystem.workingFolderPath,
  activeFilePath,
  errorMessage: filesystem.errorMessage,
  notifySuccess: (message) => filesystem.notifySuccess(message),
  storageKeyForWorkspace: workspaceScopedSecondBrainSessionKey,
  toAbsoluteWorkspacePath,
  normalizeContextPathsForUpdate,
  createDeliberationSession,
  loadDeliberationSession,
  replaceSessionContext
})
const {
  secondBrainRequestedSessionId,
  secondBrainRequestedSessionNonce,
  addActiveNoteToSecondBrain,
  onSecondBrainContextChanged,
  onSecondBrainSessionChanged
} = secondBrainBridge

const groupedSearchResults = computed(() => {
  const groups: Array<{ path: string; items: SearchHit[] }> = []
  const byPath = new Map<string, SearchHit[]>()
  for (const hit of searchHits.value) {
    if (!byPath.has(hit.path)) {
      byPath.set(hit.path, [])
    }
    byPath.get(hit.path)!.push(hit)
  }
  for (const [path, items] of byPath.entries()) {
    groups.push({ path, items })
  }
  return groups
})
const globalSearchMode = computed<SearchMode>(() => detectSearchMode(searchQuery.value))
const showSearchScore = computed(() => globalSearchMode.value === 'semantic')
const searchModeOptions: Array<{ mode: SearchMode; label: string }> = [
  { mode: 'hybrid', label: 'Hybrid' },
  { mode: 'semantic', label: 'Semantic' },
  { mode: 'lexical', label: 'Lexical' }
]

const paletteActionPriority: Record<string, number> = {
  'open-file': 0,
  'open-workspace': 1,
  'open-today': 2,
  'open-yesterday': 3,
  'open-specific-date': 4,
  'open-cosmos-view': 5,
  'open-second-brain-view': 6,
  'add-active-note-to-second-brain': 7,
  'open-settings': 8,
  'open-note-in-cosmos': 9,
  'reveal-in-explorer': 10,
  'show-shortcuts': 11,
  'create-new-file': 12,
  'close-other-tabs': 13,
  'close-all-tabs': 14,
  'close-all-tabs-current-pane': 15,
  'split-pane-right': 16,
  'split-pane-down': 17,
  'focus-pane-1': 18,
  'focus-pane-2': 19,
  'focus-pane-3': 20,
  'focus-pane-4': 21,
  'focus-next-pane': 22,
  'move-tab-next-pane': 23,
  'close-active-pane': 24,
  'join-panes': 25,
  'reset-pane-layout': 26,
  'zoom-in': 27,
  'zoom-out': 28,
  'zoom-reset': 29,
  'theme-light': 30,
  'theme-dark': 31,
  'theme-system': 32,
  'close-workspace': 33
}

const paletteActions = computed<PaletteAction[]>(() => [
  {
    id: 'open-cosmos-view',
    label: 'Open Cosmos View',
    run: () => openCosmosViewFromPalette(),
    closeBeforeRun: true,
    loadingLabel: 'Loading graph...'
  },
  {
    id: 'open-second-brain-view',
    label: 'Open Second Brain View',
    run: () => openSecondBrainViewFromPalette(),
    closeBeforeRun: true
  },
  {
    id: 'add-active-note-to-second-brain',
    label: 'Add Active Note to Second Brain',
    run: () => addActiveNoteToSecondBrainFromPalette()
  },
  {
    id: 'open-settings',
    label: 'Open Settings',
    run: () => openSettingsFromPalette(),
    closeBeforeRun: true
  },
  {
    id: 'open-note-in-cosmos',
    label: 'Open Note in Cosmos',
    run: () => openNoteInCosmosFromPalette(),
    closeBeforeRun: true,
    loadingLabel: 'Loading graph and locating active note...'
  },
  { id: 'open-workspace', label: 'Open Workspace', run: () => openWorkspaceFromPalette() },
  { id: 'close-workspace', label: 'Close Workspace', run: () => closeWorkspaceFromPalette() },
  { id: 'show-shortcuts', label: 'Show Keyboard Shortcuts', run: () => openShortcutsFromPalette() },
  { id: 'zoom-in', label: 'Zoom In (Editor)', run: () => zoomInFromPalette() },
  { id: 'zoom-out', label: 'Zoom Out (Editor)', run: () => zoomOutFromPalette() },
  { id: 'zoom-reset', label: 'Reset Zoom (Editor)', run: () => resetZoomFromPalette() },
  { id: 'theme-light', label: 'Theme: Light', run: () => setThemeFromPalette('light') },
  { id: 'theme-dark', label: 'Theme: Dark', run: () => setThemeFromPalette('dark') },
  { id: 'theme-system', label: 'Theme: System', run: () => setThemeFromPalette('system') },
  { id: 'open-today', label: 'Open Today', run: () => openTodayNote() },
  { id: 'open-yesterday', label: 'Open Yesterday', run: () => openYesterdayNote() },
  { id: 'open-specific-date', label: 'Open Specific Date', run: () => openSpecificDateNote() },
  { id: 'create-new-file', label: 'New Note', run: () => createNewFileFromPalette() },
  { id: 'close-all-tabs', label: 'Close All Tabs (All Panes)', run: () => closeAllTabsFromPalette() },
  { id: 'close-all-tabs-current-pane', label: 'Close All Tabs on Current Pane', run: () => closeAllTabsOnCurrentPaneFromPalette() },
  { id: 'close-other-tabs', label: 'Close Other Tabs', run: () => closeOtherTabsFromPalette() },
  { id: 'split-pane-right', label: 'Split Pane Right', run: () => splitPaneFromPalette('row') },
  { id: 'split-pane-down', label: 'Split Pane Down', run: () => splitPaneFromPalette('column') },
  { id: 'focus-pane-1', label: 'Focus Pane 1', run: () => focusPaneFromPalette(1) },
  { id: 'focus-pane-2', label: 'Focus Pane 2', run: () => focusPaneFromPalette(2) },
  { id: 'focus-pane-3', label: 'Focus Pane 3', run: () => focusPaneFromPalette(3) },
  { id: 'focus-pane-4', label: 'Focus Pane 4', run: () => focusPaneFromPalette(4) },
  { id: 'focus-next-pane', label: 'Focus Next Pane', run: () => focusNextPaneFromPalette() },
  { id: 'move-tab-next-pane', label: 'Move Active Tab to Next Pane', run: () => moveTabToNextPaneFromPalette() },
  { id: 'close-active-pane', label: 'Close Active Pane', run: () => closeActivePaneFromPalette() },
  { id: 'join-panes', label: 'Join Panes', run: () => joinPanesFromPalette() },
  { id: 'reset-pane-layout', label: 'Reset Pane Layout', run: () => resetPaneLayoutFromPalette() },
  { id: 'open-file', label: 'Open File', run: () => (quickOpenQuery.value = '', false) },
  { id: 'reveal-in-explorer', label: 'Reveal in Explorer', run: () => revealActiveInExplorer() }
])

const {
  quickOpenIsActionMode,
  quickOpenActionResults,
  quickOpenResults,
  quickOpenItemCount,
  moveQuickOpenSelection,
  setQuickOpenActiveIndex,
  resetQuickOpenState
} = useAppQuickOpen({
  allWorkspaceFiles,
  quickOpenQuery,
  quickOpenActiveIndex,
  isIsoDate,
  toRelativePath,
  dailyNotePath,
  workingFolderPath: filesystem.workingFolderPath,
  paletteActions,
  paletteActionPriority
})

const shortcutSections = computed(() => {
  const mod = primaryModLabel.value
  return [
    {
      title: 'General',
      items: [
        { keys: `${mod}+P`, action: 'Quick open' },
        { keys: `${mod}+Shift+P`, action: 'Command palette' },
        { keys: `${mod}+S`, action: 'Save note' },
        { keys: `${mod}+W`, action: 'Close current tab' },
        { keys: `${mod}+Tab`, action: 'Next tab' },
        { keys: `${mod}+Shift+F`, action: 'Search panel' }
      ]
    },
    {
      title: 'Navigation',
      items: [
        { keys: `${mod}+[`, action: 'Back in history' },
        { keys: `${mod}+]`, action: 'Forward in history' },
        { keys: `${mod}+D`, action: 'Open today note' },
        { keys: `${mod}+Shift+H`, action: 'Open today note (home)' },
        { keys: `${mod}+Click`, action: 'Open date token (YYYY-MM-DD) in editor' },
        { keys: `${mod}+E`, action: 'Show explorer' },
        { keys: `${mod}+B`, action: 'Toggle sidebar' },
        { keys: `${mod}+J`, action: 'Toggle right pane' }
      ]
    },
    {
      title: 'Multi-pane',
      items: [
        { keys: `${mod}+\\\\`, action: 'Split pane right' },
        { keys: `${mod}+Shift+\\\\`, action: 'Split pane down' },
        { keys: `${mod}+1..4`, action: 'Focus pane 1..4' },
        { keys: `Alt+Shift+ArrowLeft/Right`, action: 'Move active tab between panes' },
        { keys: `Palette`, action: 'Join panes' }
      ]
    },
    {
      title: 'Editor Zoom',
      items: [
        { keys: `${mod}++`, action: 'Zoom in' },
        { keys: `${mod}+-`, action: 'Zoom out' },
        { keys: `${mod}+0`, action: 'Reset zoom' }
      ]
    }
  ]
})

const filteredShortcutSections = computed(() => {
  const query = shortcutsFilterQuery.value.trim().toLowerCase()
  if (!query) return shortcutSections.value

  return shortcutSections.value
    .map((section) => {
      const titleMatches = section.title.toLowerCase().includes(query)
      if (titleMatches) return section
      const items = section.items.filter((item) =>
        item.keys.toLowerCase().includes(query) || item.action.toLowerCase().includes(query)
      )
      return { ...section, items }
    })
    .filter((section) => section.items.length > 0)
})

const metadataRows = computed(() => {
  if (!activeFilePath.value) {
    const activeTab = multiPane.getActiveTab()
    if (!activeTab || activeTab.type === 'document') return []
    const label = activeTab.type === 'cosmos'
      ? 'Cosmos'
      : activeTab.type === 'second-brain-chat'
        ? 'Second Brain'
        : 'Surface'
    return [
      { label: 'Surface', value: label },
      { label: 'Metadata', value: 'No document metadata for this surface' }
    ]
  }
  const status = activeStatus.value
  const state = status.saving
    ? 'saving'
    : virtualDocs.value[activeFilePath.value]
      ? 'unsaved'
      : status.dirty
        ? 'editing'
        : 'saved'
  return [
    { label: 'Path', value: toRelativePath(activeFilePath.value) },
    { label: 'State', value: state },
    { label: 'Workspace', value: toRelativePath(filesystem.workingFolderPath.value) || filesystem.workingFolderPath.value },
    { label: 'Created', value: formatTimestamp(activeFileMetadata.value?.created_at_ms ?? null) },
    { label: 'Updated', value: formatTimestamp(activeFileMetadata.value?.updated_at_ms ?? null) }
  ]
})
const cosmosSelectedNodeForPanel = computed(() => {
  if (!cosmos.selectedNode.value) return null
  return {
    ...cosmos.selectedNode.value,
    path: toRelativePath(cosmos.selectedNode.value.path)
  }
})

const mediaQuery = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

const backShortcutLabel = computed(() => (isMacOs ? 'Cmd+[' : 'Ctrl+['))
const forwardShortcutLabel = computed(() => (isMacOs ? 'Cmd+]' : 'Ctrl+]'))
const homeShortcutLabel = computed(() => (isMacOs ? 'Cmd+Shift+H' : 'Ctrl+Shift+H'))
const zoomPercentLabel = computed(() => `${Math.round(editorZoom.value * 100)}%`)
const primaryModLabel = computed(() => (isMacOs ? 'Cmd' : 'Ctrl'))
const backHistoryItems = computed(() =>
  documentHistory.backTargets.value.slice(0, 14).map((target) => ({
    index: target.index,
    key: `back-${target.index}-${target.entry.stateKey}`,
    label: historyTargetLabel(target.entry)
  }))
)
const forwardHistoryItems = computed(() =>
  documentHistory.forwardTargets.value.slice(0, 14).map((target) => ({
    index: target.index,
    key: `forward-${target.index}-${target.entry.stateKey}`,
    label: historyTargetLabel(target.entry)
  }))
)

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN_FILE_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g
const FORBIDDEN_FILE_NAME_CHARS_RE = /[<>:"\\|?*\u0000-\u001f]/
const MAX_FILE_STEM_LENGTH = 120

function loadSavedSidebarMode() {
  const saved = window.sessionStorage.getItem(VIEW_MODE_STORAGE_KEY)
  if (saved === 'explorer' || saved === 'search') {
    workspace.sidebarMode.value = saved
  }
  const savedPrevious = window.sessionStorage.getItem(PREVIOUS_NON_COSMOS_VIEW_MODE_STORAGE_KEY)
  if (savedPrevious === 'explorer' || savedPrevious === 'search') {
    previousNonCosmosMode.value = savedPrevious
  }
}

function persistSidebarMode() {
  window.sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, workspace.sidebarMode.value)
}

function persistPreviousNonCosmosMode() {
  window.sessionStorage.setItem(PREVIOUS_NON_COSMOS_VIEW_MODE_STORAGE_KEY, previousNonCosmosMode.value)
}

function resolvedNoteNavigationFallback(): SidebarMode {
  const current = previousNonCosmosMode.value
  if (current === 'search' || current === 'explorer') return current
  return 'explorer'
}

function formatSearchScore(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(3)
}

function openIndexStatusModal() {
  rememberFocusBeforeModalOpen()
  openIndexStatusModalInternal()
}

function closeIndexStatusModal() {
  closeIndexStatusModalInternal()
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function onIndexPrimaryAction() {
  const shouldReloadFiles = !indexRunning.value
  await onIndexPrimaryActionInternal()
  if (shouldReloadFiles) {
    await loadAllFiles()
  }
}

async function rebuildIndexFromOverflow() {
  closeOverflowMenu()
  await rebuildIndexInternal()
  await loadAllFiles()
}

function isTitleOnlyContent(content: string, titleLine: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return normalized === titleLine
}

function toggleOverflowMenu() {
  closeHistoryMenu()
  if (!overflowMenuOpen.value) {
    syncEditorZoom()
  }
  overflowMenuOpen.value = !overflowMenuOpen.value
}

function closeOverflowMenu() {
  overflowMenuOpen.value = false
}

function openShortcutsModal() {
  rememberFocusBeforeModalOpen()
  shortcutsFilterQuery.value = ''
  shortcutsModalVisible.value = true
  void nextTick(() => {
    document.querySelector<HTMLInputElement>('[data-shortcuts-filter=\"true\"]')?.focus()
  })
}

function closeShortcutsModal() {
  shortcutsModalVisible.value = false
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

function openShortcutsFromOverflow() {
  closeOverflowMenu()
  openShortcutsModal()
}

function openSettingsFromOverflow() {
  closeOverflowMenu()
  void openSettingsModal()
}

function openShortcutsFromPalette() {
  openShortcutsModal()
  return true
}

function clampEditorZoom(value: number): number {
  return Math.max(0.8, Math.min(1.6, Number(value.toFixed(2))))
}

function readStoredEditorZoom(): number {
  const raw = Number.parseFloat(window.localStorage.getItem(EDITOR_ZOOM_STORAGE_KEY) ?? '1')
  return Number.isFinite(raw) ? clampEditorZoom(raw) : 1
}

function syncEditorZoom() {
  const viaEditor = editorRef.value?.getZoom()
  if (typeof viaEditor === 'number' && Number.isFinite(viaEditor)) {
    editorZoom.value = clampEditorZoom(viaEditor)
    return
  }
  editorZoom.value = readStoredEditorZoom()
}

function zoomInFromOverflow() {
  const next = editorRef.value?.zoomIn()
  editorZoom.value = clampEditorZoom(typeof next === 'number' ? next : readStoredEditorZoom())
}

function zoomOutFromOverflow() {
  const next = editorRef.value?.zoomOut()
  editorZoom.value = clampEditorZoom(typeof next === 'number' ? next : readStoredEditorZoom())
}

function resetZoomFromOverflow() {
  const next = editorRef.value?.resetZoom()
  editorZoom.value = clampEditorZoom(typeof next === 'number' ? next : 1)
}

function zoomInFromPalette() {
  zoomInFromOverflow()
  return false
}

function zoomOutFromPalette() {
  zoomOutFromOverflow()
  return false
}

function resetZoomFromPalette() {
  resetZoomFromOverflow()
  return false
}

function closeHistoryMenu() {
  historyMenuOpen.value = null
  historyMenuStyle.value = {}
}

function readCosmosHistorySnapshot(payload: unknown): CosmosHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Partial<CosmosHistorySnapshot>
  if (
    typeof value.query !== 'string' ||
    typeof value.selectedNodeId !== 'string' ||
    typeof value.focusMode !== 'boolean' ||
    typeof value.focusDepth !== 'number'
  ) {
    return null
  }
  return {
    query: value.query,
    selectedNodeId: value.selectedNodeId,
    focusMode: value.focusMode,
    focusDepth: Math.max(1, Math.min(8, Math.round(value.focusDepth)))
  }
}

function currentCosmosHistorySnapshot(): CosmosHistorySnapshot {
  return {
    query: cosmos.query.value.trim(),
    selectedNodeId: cosmos.selectedNodeId.value,
    focusMode: cosmos.focusMode.value,
    focusDepth: cosmos.focusDepth.value
  }
}

function cosmosSnapshotStateKey(snapshot: CosmosHistorySnapshot): string {
  return JSON.stringify(snapshot)
}

function cosmosHistoryLabel(snapshot: CosmosHistorySnapshot): string {
  if (snapshot.query) return `Cosmos: ${snapshot.query}`
  if (snapshot.selectedNodeId) {
    const node = cosmos.graph.value.nodes.find((item) => item.id === snapshot.selectedNodeId)
    if (node) return `Cosmos: ${node.displayLabel || node.label}`
  }
  return 'Cosmos'
}

function readSecondBrainHistorySnapshot(payload: unknown): SecondBrainHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as { surface?: string }
  if (value.surface !== 'chat' && value.surface !== 'sessions') return null
  return { surface: 'chat' }
}

function currentSecondBrainHistorySnapshot(): SecondBrainHistorySnapshot {
  return { surface: 'chat' }
}

function secondBrainSnapshotStateKey(snapshot: SecondBrainHistorySnapshot): string {
  return snapshot.surface
}

function secondBrainHistoryLabel(_snapshot: SecondBrainHistorySnapshot): string {
  return 'Second Brain'
}

async function applyCosmosHistorySnapshot(snapshot: CosmosHistorySnapshot): Promise<boolean> {
  if (!filesystem.hasWorkspace.value) return false

  multiPane.openSurfaceInPane('cosmos')

  if (!cosmos.graph.value.nodes.length) {
    await cosmos.refreshGraph()
  }

  cosmos.query.value = snapshot.query
  cosmos.focusMode.value = snapshot.focusMode
  cosmos.focusDepth.value = snapshot.focusDepth
  cosmos.selectedNodeId.value = snapshot.selectedNodeId

  if (snapshot.selectedNodeId) {
    scheduleCosmosNodeFocus(snapshot.selectedNodeId)
  }
  return true
}

async function openSecondBrainHistorySnapshot(_snapshot: SecondBrainHistorySnapshot): Promise<boolean> {
  multiPane.openSurfaceInPane('second-brain-chat')
  return true
}

const navigation = useAppNavigationController({
  hasWorkspace: filesystem.hasWorkspace,
  activeFilePath,
  allWorkspaceFiles,
  setErrorMessage: (message) => {
    filesystem.errorMessage.value = message
  },
  toRelativePath,
  ensureAllFilesLoaded: loadAllFiles,
  saveActiveDocument: async () => {
    await editorRef.value?.saveNow()
  },
  focusEditor: () => {
    editorRef.value?.focusEditor()
  },
  getDocumentStatus: (path) => editorState.getStatus(path),
  getActiveTab: () => multiPane.getActiveTab(),
  getActiveDocumentPath: (paneId) => multiPane.getActiveDocumentPath(paneId),
  getActivePaneId: () => multiPane.layout.value.activePaneId,
  getPaneOrder: () => multiPane.paneOrder.value,
  getDocumentPathsForPane: (paneId) => documentPathsForPane(paneId),
  openPathInPane: (path, paneId) => multiPane.openPathInPane(path, paneId),
  revealDocumentInPane: (path, paneId) => multiPane.revealDocumentInPane(path, paneId),
  setActivePathInPane: (paneId, path) => multiPane.setActivePathInPane(paneId, path),
  openSurfaceInPane: (type, paneId) => multiPane.openSurfaceInPane(type, paneId),
  findPaneContainingSurface: (type) => multiPane.findPaneContainingSurface(type),
  documentHistory,
  readCosmosHistorySnapshot,
  currentCosmosHistorySnapshot,
  cosmosSnapshotStateKey,
  cosmosHistoryLabel,
  applyCosmosHistorySnapshot,
  readSecondBrainHistorySnapshot,
  currentSecondBrainHistorySnapshot,
  secondBrainSnapshotStateKey,
  secondBrainHistoryLabel,
  openSecondBrainHistorySnapshot
})
const {
  isApplyingHistoryNavigation,
  historyTargetLabel,
  recordSecondBrainHistorySnapshot,
  recordCosmosHistorySnapshot,
  scheduleCosmosHistorySnapshot,
  openTabWithAutosave,
  setActiveTabWithAutosave,
  openNoteFromSecondBrain,
  openHistoryEntry,
  goBackInHistory,
  goForwardInHistory,
  openNextTabWithAutosave,
  dispose: disposeNavigationController
} = navigation

function scheduleCosmosNodeFocus(nodeId: string, remainingAttempts = 12) {
  if (!nodeId || remainingAttempts <= 0) return
}

function historyMenuItemCount(side: 'back' | 'forward'): number {
  const count = side === 'back'
    ? documentHistory.backTargets.value.length
    : documentHistory.forwardTargets.value.length
  return Math.max(1, Math.min(14, count))
}

function updateHistoryMenuPosition(side: 'back' | 'forward') {
  const anchor = topbarRef.value?.getHistoryButtonEl(side) ?? null
  if (!anchor) return

  const rect = anchor.getBoundingClientRect()
  const viewportPadding = 8
  const menuWidth = 320
  const menuHeight = historyMenuItemCount(side) * 32 + 12

  const left = Math.max(
    viewportPadding,
    Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)
  )
  const prefersDown = rect.bottom + 6 + menuHeight <= window.innerHeight - viewportPadding
  const top = prefersDown
    ? rect.bottom + 6
    : Math.max(viewportPadding, rect.top - menuHeight - 6)

  historyMenuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    maxHeight: `${Math.max(120, window.innerHeight - viewportPadding * 2)}px`
  }
}

function openHistoryMenu(side: 'back' | 'forward') {
  closeOverflowMenu()
  historyMenuOpen.value = side
  updateHistoryMenuPosition(side)
}

function onHistoryButtonPointerDown(side: 'back' | 'forward', event: PointerEvent) {
  if (event.button !== 0) return
  const canOpen = side === 'back' ? documentHistory.canGoBack.value : documentHistory.canGoForward.value
  if (!canOpen) return
  historyLongPressTarget = null
  if (historyMenuTimer) {
    clearTimeout(historyMenuTimer)
    historyMenuTimer = null
  }
  historyMenuTimer = setTimeout(() => {
    historyLongPressTarget = side
    openHistoryMenu(side)
  }, 420)
}

function cancelHistoryLongPress() {
  if (historyMenuTimer) {
    clearTimeout(historyMenuTimer)
    historyMenuTimer = null
  }
}

function onHistoryButtonContextMenu(side: 'back' | 'forward', event: MouseEvent) {
  event.preventDefault()
  openHistoryMenu(side)
}

function onHistoryButtonClick(side: 'back' | 'forward') {
  if (historyLongPressTarget === side) {
    historyLongPressTarget = null
    return
  }
  historyLongPressTarget = null
  closeHistoryMenu()
  if (side === 'back') {
    void goBackInHistory()
    return
  }
  void goForwardInHistory()
}

function onHistoryTargetClick(targetIndex: number) {
  closeHistoryMenu()
  const previousIndex = documentHistory.currentIndex.value
  const targetEntry = documentHistory.jumpToEntry(targetIndex)
  if (!targetEntry) return
  void (async () => {
    isApplyingHistoryNavigation.value = true
    let opened = false
    try {
      opened = await openHistoryEntry(targetEntry)
    } finally {
      isApplyingHistoryNavigation.value = false
    }
    if (opened) {
      return
    }
    documentHistory.jumpToEntry(previousIndex)
  })()
}

function onWindowResize() {
  if (!historyMenuOpen.value) return
  updateHistoryMenuPosition(historyMenuOpen.value)
}

function onGlobalPointerDown(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return

  if (overflowMenuOpen.value && !topbarRef.value?.containsOverflowTarget(target)) {
    closeOverflowMenu()
  }

  if (historyMenuOpen.value === 'back' && !topbarRef.value?.containsHistoryMenuTarget('back', target)) {
    closeHistoryMenu()
  }

  if (historyMenuOpen.value === 'forward' && !topbarRef.value?.containsHistoryMenuTarget('forward', target)) {
    closeHistoryMenu()
  }
}

function setThemeFromOverflow(next: ThemePreference) {
  themePreference.value = next
  closeOverflowMenu()
}

function setThemeFromPalette(next: ThemePreference) {
  themePreference.value = next
  return true
}

/**
 * Enters Cosmos mode without toggle semantics.
 *
 * Unlike toolbar toggle behavior, command-palette actions should be idempotent
 * and keep Cosmos open when already active.
 */
async function openCosmosViewFromPalette() {
  if (!filesystem.hasWorkspace.value) {
    filesystem.errorMessage.value = 'Open a workspace first.'
    return false
  }

  multiPane.openSurfaceInPane('cosmos')
  if (!cosmos.graph.value.nodes.length) {
    await cosmos.refreshGraph()
  }
  recordCosmosHistorySnapshot()
  return true
}

async function openSecondBrainViewFromPalette() {
  if (!filesystem.hasWorkspace.value) {
    filesystem.errorMessage.value = 'Open a workspace first.'
    return false
  }

  multiPane.openSurfaceInPane('second-brain-chat')
  recordSecondBrainHistorySnapshot()
  if (!allWorkspaceFiles.value.length) {
    await loadAllFiles()
  }
  return true
}

async function addActiveNoteToSecondBrainFromPalette() {
  return await addActiveNoteToSecondBrain()
}

function closeSettingsModal() {
  settingsModalVisible.value = false
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function openSettingsModal() {
  rememberFocusBeforeModalOpen()
  settingsModalVisible.value = true
  await nextTick()
}

function onSettingsSaved(result: { path: string; embeddings_changed: boolean }) {
  filesystem.notifySuccess(`Settings saved at ${result.path}.`)
  if (result.embeddings_changed) {
    markIndexOutOfSync()
    filesystem.notifyInfo('Embedding settings changed. Rebuild index to resync semantic search.')
  }
  closeSettingsModal()
}

async function openSettingsFromPalette() {
  await openSettingsModal()
  return true
}

/**
 * Opens Cosmos and selects the active note node when available.
 */
async function openNoteInCosmosFromPalette() {
  const activePath = activeFilePath.value
  if (!activePath) {
    filesystem.errorMessage.value = 'No active note to open in Cosmos.'
    return false
  }

  const opened = await openCosmosViewFromPalette()
  if (!opened) return false

  const target = activePath.trim()
  const targetKey = normalizePathKey(target)
  let match = cosmos.graph.value.nodes.find((node) => normalizePathKey(node.path) === targetKey || normalizePathKey(node.id) === targetKey)
  if (!match) {
    await cosmos.refreshGraph()
    match = cosmos.graph.value.nodes.find((node) => normalizePathKey(node.path) === targetKey || normalizePathKey(node.id) === targetKey)
  }
  if (!match) {
    if (cosmos.error.value) {
      filesystem.errorMessage.value = cosmos.error.value
      return false
    }
    filesystem.errorMessage.value = 'Active note is not available in the current graph index.'
    return true
  }

  cosmos.selectNode(match.id)
  scheduleCosmosNodeFocus(match.id)
  recordCosmosHistorySnapshot()
  return true
}

async function closeWorkspace() {
  if (!filesystem.hasWorkspace.value) return
  multiPane.resetToSinglePane()
  multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
  documentHistory.reset()
  editorState.setActiveOutline([])
  searchHits.value = []
  backlinks.value = []
  backlinksLoading.value = false
  semanticLinks.value = []
  semanticLinksLoading.value = false
  cosmos.clearState()
  await closeWorkspaceInternal()
  closeOverflowMenu()
}

function beginResize(side: 'left' | 'right', event: MouseEvent) {
  event.preventDefault()
  resizeState.value = {
    side,
    startX: event.clientX,
    startWidth: side === 'left' ? leftPaneWidth.value : rightPaneWidth.value
  }
}

function onPointerMove(event: MouseEvent) {
  if (!resizeState.value) return
  const { side, startWidth, startX } = resizeState.value
  const delta = event.clientX - startX

  if (side === 'left') {
    leftPaneWidth.value = Math.min(420, Math.max(180, startWidth + delta))
    return
  }
  rightPaneWidth.value = Math.min(560, Math.max(220, startWidth - delta))
}

function stopResize() {
  resizeState.value = null
}

async function onSelectWorkingFolder() {
  filesystem.errorMessage.value = ''
  try {
    const path = await selectWorkingFolder()
    if (!path) return false
    await loadWorkingFolder(path)
    return true
  } catch (err) {
    filesystem.errorMessage.value =
      err instanceof Error ? err.message : 'Could not open workspace. Protected folders are not allowed.'
    return false
  }
}

async function loadWorkingFolder(path: string) {
  const canonical = await loadWorkingFolderInternal(path)
  if (!canonical) {
    multiPane.resetToSinglePane()
    multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
    searchHits.value = []
    return
  }

  searchHits.value = []
  if (multiPane.findPaneContainingSurface('cosmos') !== null) {
    await cosmos.refreshGraph()
  }

  if (activeFilePath.value && !activeFilePath.value.startsWith(canonical)) {
    multiPane.resetToSinglePane()
    multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
    editorState.setActiveOutline([])
  }
}

function onExplorerError(message: string) {
  filesystem.errorMessage.value = message
}

function onExplorerSelection(paths: string[]) {
  filesystem.selectedCount.value = paths.length
}

async function onExplorerOpen(path: string) {
  const opened = await openTabWithAutosave(path)
  if (!opened) return
}

async function openFile(path: string) {
  if (!filesystem.workingFolderPath.value) {
    throw new Error('Working folder is not set.')
  }
  const virtual = virtualDocs.value[path]
  if (virtual) return virtual.content
  return await readTextFile(path)
}

function noteTitleFromPath(path: string): string {
  const filename = fileName(path).replace(/\.(md|markdown)$/i, '')
  return filename || 'Untitled'
}

function markdownExtensionFromPath(path: string): string {
  const name = fileName(path)
  const match = name.match(/\.(md|markdown)$/i)
  return match ? match[0] : '.md'
}

function sanitizeTitleForFileName(raw: string): string {
  const cleaned = raw
    .replace(FORBIDDEN_FILE_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  const base = cleaned.slice(0, MAX_FILE_STEM_LENGTH).trim()
  if (!base) return 'Untitled'
  if (base === '.' || base === '..') return 'Untitled'
  if (WINDOWS_RESERVED_NAME_RE.test(base)) return `${base}-note`
  return base
}

function applyPathRenameLocally(payload: { from: string; to: string }) {
  const fromPath = payload.from
  const toPath = payload.to
  if (!fromPath || !toPath || fromPath === toPath) return

  multiPane.replacePath(fromPath, toPath)
  documentHistory.replacePath(fromPath, toPath)
  editorState.movePath(fromPath, toPath)

  if (virtualDocs.value[fromPath]) {
    const nextVirtual = { ...virtualDocs.value }
    nextVirtual[toPath] = nextVirtual[fromPath]
    delete nextVirtual[fromPath]
    virtualDocs.value = nextVirtual
  }

  replaceWorkspaceFilePath(fromPath, toPath)

  backlinks.value = backlinks.value.map((path) => (path === fromPath ? toPath : path))
}

function openNextWikilinkRewritePrompt() {
  if (wikilinkRewritePrompt.value || wikilinkRewriteQueue.length === 0) return
  const next = wikilinkRewriteQueue.shift()
  if (!next) return
  rememberFocusBeforeModalOpen()
  wikilinkRewritePrompt.value = {
    fromPath: next.fromPath,
    toPath: next.toPath
  }
  wikilinkRewriteResolver = next.resolve
}

function promptWikilinkRewritePermission(fromPath: string, toPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    wikilinkRewriteQueue.push({
      fromPath,
      toPath,
      resolve
    })
    openNextWikilinkRewritePrompt()
  })
}

function resolveWikilinkRewritePrompt(approved: boolean) {
  const resolve = wikilinkRewriteResolver
  wikilinkRewriteResolver = null
  wikilinkRewritePrompt.value = null
  resolve?.(approved)
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
  openNextWikilinkRewritePrompt()
}

function clearWikilinkRewritePromptQueue() {
  if (wikilinkRewriteResolver) {
    wikilinkRewriteResolver(false)
    wikilinkRewriteResolver = null
  }
  wikilinkRewritePrompt.value = null
  while (wikilinkRewriteQueue.length) {
    const pending = wikilinkRewriteQueue.shift()
    pending?.resolve(false)
  }
}

async function maybeRewriteWikilinksForRename(fromPath: string, toPath: string) {
  const root = filesystem.workingFolderPath.value
  if (!root || fromPath === toPath) return
  const shouldRewrite = await promptWikilinkRewritePermission(fromPath, toPath)
  if (!shouldRewrite) return
  filesystem.indexingState.value = 'indexing'
  semanticIndexState.value = 'running'
  indexRunKind.value = 'rename'
  indexRunPhase.value = 'indexing_files'
  indexRunCurrentPath.value = ''
  indexRunCompleted.value = 0
  indexRunTotal.value = 0
  indexFinalizeCompleted.value = 0
  indexFinalizeTotal.value = 0
  indexRunMessage.value = ''
  try {
    const result = await updateWikilinksForRename(fromPath, toPath)
    indexRunTotal.value = result.updated_files
    indexRunCompleted.value = result.updated_files
    indexRunPhase.value = 'refreshing_views'
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 1
    await refreshBacklinks()
    indexFinalizeCompleted.value = 1
    filesystem.indexingState.value = 'indexed'
    semanticIndexState.value = 'idle'
    indexRunPhase.value = 'done'
    indexRunLastFinishedAt.value = Date.now()
  } catch (err) {
    filesystem.indexingState.value = 'out_of_sync'
    semanticIndexState.value = 'error'
    indexRunPhase.value = 'error'
    indexRunMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
  }
}

function onEditorPathRenamed(payload: { from: string; to: string; manual: boolean }) {
  applyPathRenameLocally(payload)
  void maybeRewriteWikilinksForRename(payload.from, payload.to)
}

function onExplorerPathRenamed(payload: { from: string; to: string }) {
  applyPathRenameLocally(payload)
  void maybeRewriteWikilinksForRename(payload.from, payload.to)
}

async function renameFileFromTitle(path: string, rawTitle: string): Promise<RenameFromTitleResult> {
  const root = filesystem.workingFolderPath.value
  if (!root) {
    throw new Error('Working folder is not set.')
  }

  const normalizedTitle = sanitizeTitleForFileName(rawTitle)
  const ext = markdownExtensionFromPath(path)
  const nextName = `${normalizedTitle}${ext}`

  if (fileName(path) === nextName) {
    return { path, title: normalizedTitle }
  }

  const exists = await pathExists(path)
  if (!exists) {
    const parent = path.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
    let candidate = `${parent}/${nextName}`
    let idx = 1
    while (await pathExists(candidate)) {
      const alt = `${normalizedTitle} (${idx})${ext}`
      candidate = `${parent}/${alt}`
      idx += 1
      if (idx > 9_999) {
        throw new Error('Could not choose a unique filename.')
      }
    }
    return {
      path: candidate,
      title: noteTitleFromPath(candidate)
    }
  }

  const renamedPath = await renameEntry(path, nextName, 'rename')
  return {
    path: renamedPath,
    title: noteTitleFromPath(renamedPath)
  }
}

async function ensureVirtualMarkdown(path: string, titleLine: string) {
  if (virtualDocs.value[path]) return
  virtualDocs.value = {
    ...virtualDocs.value,
    [path]: {
      content: titleLine ? `${titleLine}\n` : '',
      titleLine
    }
  }
}

async function openOrPrepareMarkdown(path: string, titleLine: string) {
  const root = filesystem.workingFolderPath.value
  if (!root) {
    filesystem.errorMessage.value = 'Working folder is not set.'
    return false
  }

  let exists = false
  try {
    exists = await pathExists(path)
  } catch {
    // If parent folders do not exist yet (for example journal/), treat as non-existent
    // and open a virtual buffer. Folder creation is deferred until first write.
    exists = false
  }
  if (exists) {
    const nextVirtual = { ...virtualDocs.value }
    delete nextVirtual[path]
    virtualDocs.value = nextVirtual
    const opened = await openTabWithAutosave(path)
    if (!opened) return false
    await nextTick()
    editorRef.value?.focusEditor()
    return true
  }

  await ensureVirtualMarkdown(path, titleLine)
  const opened = await openTabWithAutosave(path)
  if (!opened) return false
  await nextTick()
  editorRef.value?.focusEditor()
  return true
}

async function saveFile(path: string, txt: string, options: SaveFileOptions): Promise<SaveFileResult> {
  if (!filesystem.workingFolderPath.value) {
    throw new Error('Working folder is not set.')
  }
  const virtual = virtualDocs.value[path]
  if (virtual && !options.explicit && isTitleOnlyContent(txt, virtual.titleLine)) {
    return { persisted: false }
  }

  await ensureParentFolders(path)
  await writeTextFile(path, txt)
  await refreshActiveFileMetadata(path)

  if (virtual) {
    const nextVirtual = { ...virtualDocs.value }
    delete nextVirtual[path]
    virtualDocs.value = nextVirtual
  }

  upsertWorkspaceFilePath(path)
  enqueueMarkdownReindex(path)
  return { persisted: true }
}

async function runGlobalSearch() {
  const q = searchQuery.value.trim()
  if (!q || !filesystem.workingFolderPath.value) {
    hasSearched.value = false
    searchHits.value = []
    return
  }

  const requestToken = ++searchRequestToken
  hasSearched.value = true
  filesystem.errorMessage.value = ''
  searchLoading.value = true
  try {
    if (!allWorkspaceFiles.value.length) {
      await loadAllFiles()
    }
    const ftsHits = await ftsSearch(q)
    const qLower = q.toLowerCase()
    const filenameHits = allWorkspaceFiles.value
      .filter((path) => toRelativePath(path).toLowerCase().includes(qLower))
      .map((path) => ({
        path,
        snippet: `filename: ${toRelativePath(path)}`,
        score: 0
      }))

    const merged = [...filenameHits, ...ftsHits]
    const dedupe = new Set<string>()
    const deduped = merged.filter((hit) => {
      const key = `${hit.path}::${hit.snippet}`
      if (dedupe.has(key)) return false
      dedupe.add(key)
      return true
    })
    if (requestToken === searchRequestToken) {
      searchHits.value = deduped
    }
  } catch (err) {
    if (requestToken === searchRequestToken) {
      filesystem.errorMessage.value = err instanceof Error ? err.message : 'Search failed.'
    }
  } finally {
    if (requestToken === searchRequestToken) {
      searchLoading.value = false
    }
  }
}

function onGlobalSearchModeSelect(mode: SearchMode) {
  const next = applySearchMode(searchQuery.value, mode)
  searchQuery.value = next.value
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('[data-search-input="true"]')
    if (!input) return
    input.focus()
    input.setSelectionRange(next.caret, next.caret)
  })
}

async function onSearchResultOpen(hit: SearchHit) {
  const opened = await openTabWithAutosave(hit.path)
  if (!opened) return
  editorState.setRevealSnippet(hit.path, hit.snippet)

  await nextTick()
  await editorRef.value?.revealSnippet(hit.snippet)
}

async function onBacklinkOpen(path: string) {
  const opened = await openTabWithAutosave(path)
  if (!opened) return
  await nextTick()
  editorRef.value?.focusEditor()
}

async function onPaneTabClick(payload: { paneId: string; tabId: string }) {
  multiPane.setActivePane(payload.paneId)
  const pane = multiPane.layout.value.panesById[payload.paneId]
  const tab = pane?.openTabs.find((item) => item.id === payload.tabId)
  if (!tab) return
  if (tab.type === 'document') {
    const opened = await setActiveTabWithAutosave(tab.path)
    if (!opened) return
    return
  }
  multiPane.setActiveTabInPane(payload.paneId, payload.tabId)
}

function onPaneTabClose(payload: { paneId: string; tabId: string }) {
  const pane = multiPane.layout.value.panesById[payload.paneId]
  const tab = pane?.openTabs.find((item) => item.id === payload.tabId)
  multiPane.closeTabInPane(payload.paneId, payload.tabId)
  if (tab?.type === 'document') {
    editorState.clearStatus(tab.path)
  }
}

function onPaneTabCloseOthers(payload: { paneId: string; tabId: string }) {
  multiPane.closeOtherTabsInPane(payload.paneId, payload.tabId)
}

function onPaneTabCloseAll(payload: { paneId: string }) {
  const paths = documentPathsForPane(payload.paneId)
  multiPane.closeAllTabsInPane(payload.paneId)
  clearEditorStatusForPaths(paths)
}

function onEditorStatus(payload: { path: string; dirty: boolean; saving: boolean; saveError: string }) {
  editorState.updateStatus(payload.path, {
    dirty: payload.dirty,
    saving: payload.saving,
    saveError: payload.saveError
  })
}

function onEditorOutline(payload: Array<{ level: 1 | 2 | 3; text: string }>) {
  editorState.setActiveOutline(payload)
}

function onEditorProperties(payload: { path: string; items: PropertyPreviewRow[]; parseErrorCount: number }) {
  if (!activeFilePath.value || payload.path !== activeFilePath.value) {
    if (!payload.path) {
      propertiesPreview.value = []
      propertyParseErrorCount.value = 0
    }
    return
  }
  propertiesPreview.value = payload.items
  propertyParseErrorCount.value = payload.parseErrorCount
}

async function onOutlineHeadingClick(payload: { index: number; heading: { level: 1 | 2 | 3; text: string } }) {
  const heading = payload.heading.text.trim()
  if (heading) {
    const revealed = await editorRef.value?.revealAnchor({ heading })
    if (revealed) return
  }
  await editorRef.value?.revealOutlineHeading(payload.index)
}

function setSidebarMode(mode: SidebarMode) {
  const target = mode === 'search' ? 'search' : 'explorer'
  const current = workspace.sidebarMode.value

  if (current === target) {
    workspace.toggleSidebar()
    persistSidebarMode()
    return
  }

  previousNonCosmosMode.value = target
  persistPreviousNonCosmosMode()
  workspace.setSidebarMode(target)
  persistSidebarMode()
}

function openSearchPanel() {
  closeOverflowMenu()
  workspace.setSidebarMode('search')
  previousNonCosmosMode.value = 'search'
  persistPreviousNonCosmosMode()
  persistSidebarMode()
  nextTick(() => {
    document.querySelector<HTMLInputElement>('[data-search-input=\"true\"]')?.focus()
  })
}

function collectSemanticLinksForPath(path: string, rawGraph: WikilinkGraph | null): SemanticLinkRow[] {
  if (!rawGraph) return []
  const nodeById = new Map(rawGraph.nodes.map((node) => [node.id, node]))
  const activeNode = rawGraph.nodes.find((node) => normalizePathKey(node.path) === normalizePathKey(path))
  if (!activeNode) return []

  const merged = new Map<string, SemanticLinkRow>()
  for (const edge of rawGraph.edges) {
    if (edge.type !== 'semantic') continue
    const isOutgoing = edge.source === activeNode.id
    const isIncoming = edge.target === activeNode.id
    if (!isOutgoing && !isIncoming) continue
    const otherId = isOutgoing ? edge.target : edge.source
    if (otherId === activeNode.id) continue
    const otherNode = nodeById.get(otherId)
    if (!otherNode) continue
    const key = normalizePathKey(otherNode.path)
    const nextScore = typeof edge.score === 'number' ? edge.score : null
    const current = merged.get(key)
    if (!current) {
      merged.set(key, {
        path: otherNode.path,
        score: nextScore,
        direction: isOutgoing ? 'outgoing' : 'incoming'
      })
      continue
    }
    const currentScore = current.score ?? -1
    const candidateScore = nextScore ?? -1
    if (candidateScore > currentScore) {
      current.score = nextScore
      current.direction = isOutgoing ? 'outgoing' : 'incoming'
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    const scoreA = a.score ?? -1
    const scoreB = b.score ?? -1
    if (scoreB !== scoreA) return scoreB - scoreA
    return a.path.localeCompare(b.path)
  })
}

async function refreshBacklinks() {
  const root = filesystem.workingFolderPath.value
  const path = activeFilePath.value
  if (!root || !path) {
    backlinks.value = []
    semanticLinks.value = []
    return
  }

  backlinksLoading.value = true
  semanticLinksLoading.value = true
  try {
    const [results, rawGraph] = await Promise.all([
      backlinksForPath(path),
      getWikilinkGraph().catch(() => null)
    ])
    backlinks.value = results.map((item) => item.path)
    semanticLinks.value = collectSemanticLinksForPath(path, rawGraph)
  } catch {
    backlinks.value = []
    semanticLinks.value = []
  } finally {
    backlinksLoading.value = false
    semanticLinksLoading.value = false
  }
}

async function openTodayNote() {
  return await openDailyNote(formatIsoDate(new Date()), openTabWithAutosave)
}

async function showExplorerForActiveFile(options: { focusTree?: boolean } = {}) {
  setSidebarMode('explorer')
  if (!workspace.sidebarVisible.value) return
  await nextTick()
  const activePath = activeFilePath.value
  if (!activePath) return
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const revealPathInView = explorerRef.value?.revealPathInView
    if (typeof revealPathInView === 'function') {
      await revealPathInView(activePath, {
        focusTree: options.focusTree ?? false,
        behavior: 'auto'
      })
      return
    }
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

async function openYesterdayNote() {
  const value = new Date()
  value.setDate(value.getDate() - 1)
  return await openDailyNote(formatIsoDate(value), openTabWithAutosave)
}

async function openSpecificDateNote() {
  rememberFocusBeforeModalOpen()
  openDateInput.value = formatIsoDate(new Date())
  openDateModalError.value = ''
  openDateModalVisible.value = true
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-open-date-input=\"true\"]')?.focus()
  return true
}

function closeOpenDateModal() {
  openDateModalVisible.value = false
  openDateInput.value = ''
  openDateModalError.value = ''
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function submitOpenDateFromModal() {
  const isoDate = parseIsoDateInput(openDateInput.value.trim())
  if (!isoDate) {
    openDateModalError.value = 'Invalid date. Use YYYY-MM-DD (example: 2026-02-22).'
    return false
  }
  const opened = await openDailyNote(isoDate, openTabWithAutosave)
  if (!opened) return false
  closeOpenDateModal()
  return true
}

async function revealActiveInExplorer() {
  if (!activeFilePath.value) return false
  try {
    await revealInFileManager(activeFilePath.value)
    return true
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not reveal file.'
    return false
  }
}

async function openWikilinkTarget(target: string) {
  const root = filesystem.workingFolderPath.value
  if (!root) return false
  const parsed = parseWikilinkTarget(target)
  const anchor = parsed.anchor
  const normalized = sanitizeRelativePath(parsed.notePath)
  const revealAnchor = async () => {
    if (!anchor) return true
    await nextTick()
    return await editorRef.value?.revealAnchor(anchor) ?? false
  }

  if (!normalized) {
    if (!anchor || !activeFilePath.value) return false
    return await revealAnchor()
  }

  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    filesystem.errorMessage.value = 'Invalid link target.'
    return false
  }

  if (isIsoDate(normalized)) {
    const opened = await openDailyNote(normalized, openTabWithAutosave)
    if (!opened) return false
    return await revealAnchor()
  }

  const markdownFiles = await loadWikilinkTargets()

  const existing = resolveExistingWikilinkPath(normalized, markdownFiles)

  if (existing) {
    const opened = await openTabWithAutosave(`${root}/${existing}`)
    if (!opened) return false
    const revealed = await revealAnchor()
    if (!anchor || !revealed) {
      editorRef.value?.focusEditor()
    }
    return true
  }

  const withExtension = /\.(md|markdown)$/i.test(normalized) ? normalized : `${normalized}.md`
  const fullPath = `${root}/${withExtension}`
  const opened = await openOrPrepareMarkdown(fullPath, '')
  if (!opened) return false
  if (!anchor) return true
  return await revealAnchor()
}

async function onCosmosOpenNode(path: string) {
  recordCosmosHistorySnapshot()
  const root = filesystem.workingFolderPath.value
  const targetPath = root && !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)
    ? `${root}/${path}`
    : path
  const opened = await openTabWithAutosave(targetPath)
  if (!opened) return
  const fallback = resolvedNoteNavigationFallback()
  workspace.setSidebarMode(fallback)
  persistSidebarMode()
  await nextTick()
  if (fallback === 'explorer') {
    const revealPathInView = explorerRef.value?.revealPathInView
    if (typeof revealPathInView === 'function') {
      await revealPathInView(targetPath, { behavior: 'auto' })
    }
  }
  editorRef.value?.focusEditor()
}

function onCosmosResetView() {
  cosmos.selectedNodeId.value = ''
  cosmos.focusMode.value = false
  editorRef.value?.resetCosmosView()
  recordCosmosHistorySnapshot()
}

function onCosmosQueryUpdate(value: string) {
  cosmos.query.value = value
  scheduleCosmosHistorySnapshot()
}

function onCosmosToggleFocusMode(value: boolean) {
  cosmos.focusMode.value = value
  recordCosmosHistorySnapshot()
}

function onCosmosToggleSemanticEdges(value: boolean) {
  cosmos.showSemanticEdges.value = value
  recordCosmosHistorySnapshot()
}

function onCosmosSelectNode(nodeId: string) {
  cosmos.selectNode(nodeId)
  recordCosmosHistorySnapshot()
}

function onCosmosSearchEnter() {
  const nodeId = cosmos.searchEnter()
  if (!nodeId) return
  editorRef.value?.focusCosmosNodeById(nodeId)
  recordCosmosHistorySnapshot()
}

function onCosmosMatchClick(nodeId: string) {
  cosmos.focusMatch(nodeId)
  editorRef.value?.focusCosmosNodeById(nodeId)
  recordCosmosHistorySnapshot()
}

function onCosmosExpandNeighborhood() {
  cosmos.expandNeighborhood()
  recordCosmosHistorySnapshot()
}

function onCosmosJumpToRelatedNode(nodeId: string) {
  cosmos.jumpToRelated(nodeId)
  editorRef.value?.focusCosmosNodeById(nodeId)
  recordCosmosHistorySnapshot()
}

function onCosmosLocateSelectedNode() {
  const selected = cosmos.selectedNode.value
  if (!selected) return
  editorRef.value?.focusCosmosNodeById(selected.id)
  recordCosmosHistorySnapshot()
}

async function onCosmosOpenSelectedNode() {
  const selected = cosmos.openSelected()
  if (!selected) return
  await onCosmosOpenNode(selected.path)
}

function extractHeadingsFromMarkdown(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)$/)
    if (!match) continue
    const raw = match[1].trim()
    if (!raw) continue
    const text = raw
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => (alias ?? target))
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_~]/g, '')
      .trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }

  return out
}

function resolveExistingWikilinkPath(normalizedTarget: string, markdownFiles: string[]): string | null {
  const withoutExtension = normalizedTarget.replace(/\.(md|markdown)$/i, '').toLowerCase()
  const exact = markdownFiles.find((path) => path.replace(/\.(md|markdown)$/i, '').toLowerCase() === withoutExtension)
  if (exact) return exact

  const basenameMatches = markdownFiles.filter((path) => {
    const normalized = path.replace(/\.(md|markdown)$/i, '').toLowerCase()
    const stem = normalized.split('/').pop() ?? normalized
    return stem === withoutExtension
  })
  if (basenameMatches.length === 1) return basenameMatches[0]

  const suffixMatches = markdownFiles.filter((path) => {
    const normalized = path.replace(/\.(md|markdown)$/i, '').toLowerCase()
    return normalized.endsWith(`/${withoutExtension}`)
  })
  if (suffixMatches.length === 1) return suffixMatches[0]

  return null
}

async function loadWikilinkHeadings(target: string): Promise<string[]> {
  const root = filesystem.workingFolderPath.value
  if (!root) return []
  const normalized = sanitizeRelativePath(target)
  if (!normalized) return []
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return []

  try {
    if (isIsoDate(normalized)) {
      const path = dailyNotePath(root, normalized)
      if (!(await pathExists(path))) return []
      return extractHeadingsFromMarkdown(await readTextFile(path))
    }

    const markdownFiles = await loadWikilinkTargets()
    const existing = resolveExistingWikilinkPath(normalized, markdownFiles)
    if (!existing) return []
    return extractHeadingsFromMarkdown(await readTextFile(`${root}/${existing}`))
  } catch {
    return []
  }
}

async function openQuickOpen(initialQuery = '') {
  rememberFocusBeforeModalOpen()
  quickOpenVisible.value = true
  resetQuickOpenState(initialQuery)
  if (!allWorkspaceFiles.value.length) {
    await loadAllFiles()
  }
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-quick-open-input=\"true\"]')?.focus()
}

function closeQuickOpen(restoreFocusOrEvent: boolean | PointerEvent = true) {
  const restoreFocus = typeof restoreFocusOrEvent === 'boolean' ? restoreFocusOrEvent : true
  quickOpenVisible.value = false
  resetQuickOpenState('')
  if (!restoreFocus) return
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function openQuickResult(item: QuickOpenResult) {
  if (item.kind === 'file') {
    const opened = await openTabWithAutosave(item.path)
    if (!opened) return
    closeQuickOpen()
    nextTick(() => editorRef.value?.focusEditor())
    return
  }
  void openDailyNote(item.date, openTabWithAutosave).then((opened) => {
    if (opened) closeQuickOpen()
  })
}

function openCommandPalette() {
  closeOverflowMenu()
  void openQuickOpen('>')
}

async function runQuickOpenAction(id: string) {
  const action = quickOpenActionResults.value.find((item) => item.id === id)
  if (!action) return
  const closesBeforeRun = Boolean(action.closeBeforeRun)
  const hasLoadingModal = Boolean(action.loadingLabel)
  if (closesBeforeRun && quickOpenVisible.value) {
    closeQuickOpen(false)
  }
  if (hasLoadingModal) {
    cosmosCommandLoadingLabel.value = action.loadingLabel ?? 'Loading graph...'
    cosmosCommandLoadingVisible.value = true
  }
  try {
    const shouldClose = await action.run()
    if (!closesBeforeRun && shouldClose) {
      closeQuickOpen()
    }
    if (!shouldClose) return
    nextTick(() => {
      if (
        !newFileModalVisible.value &&
        !newFolderModalVisible.value &&
        !openDateModalVisible.value &&
        !settingsModalVisible.value &&
        !shortcutsModalVisible.value &&
        !cosmosCommandLoadingVisible.value
      ) {
        editorRef.value?.focusEditor()
      }
    })
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Command failed.'
    if (!closesBeforeRun) {
      closeQuickOpen()
    }
  } finally {
    if (hasLoadingModal) {
      cosmosCommandLoadingVisible.value = false
    }
  }
}

async function createNewFileFromPalette() {
  const prefill = await suggestedNotePathPrefix()
  await openNewFileModal(prefill)
  return true
}

function closeNewFileModal() {
  newFileModalVisible.value = false
  newFilePathInput.value = ''
  newFileModalError.value = ''
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function openNewFileModal(prefill = '') {
  rememberFocusBeforeModalOpen()
  newFilePathInput.value = prefill
  newFileModalError.value = ''
  newFileModalVisible.value = true
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-new-file-input=\"true\"]')?.focus()
}

function closeNewFolderModal() {
  newFolderModalVisible.value = false
  newFolderPathInput.value = ''
  newFolderModalError.value = ''
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function openNewFolderModal(prefill = '') {
  rememberFocusBeforeModalOpen()
  newFolderPathInput.value = prefill
  newFolderModalError.value = ''
  newFolderModalVisible.value = true
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-new-folder-input=\"true\"]')?.focus()
}

function parentPrefixForModal(parentPath: string): string {
  const root = filesystem.workingFolderPath.value
  if (!root) return ''
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedParent || normalizedParent === normalizedRoot) return ''
  if (!normalizedParent.startsWith(`${normalizedRoot}/`)) return ''
  const relative = normalizedParent.slice(normalizedRoot.length + 1)
  return relative ? `${relative}/` : ''
}

async function suggestedNotePathPrefix(): Promise<string> {
  const root = filesystem.workingFolderPath.value
  if (!root) return ''

  try {
    const rootChildren = await listChildren(root)
    if (rootChildren.some((entry) => entry.is_dir && entry.name.toLowerCase() === 'notes')) {
      return 'notes/'
    }
  } catch {
    // Fall back to active path below.
  }

  const activePath = activeFilePath.value
  if (!activePath) return ''
  return parentPrefixForModal(activePath.replace(/\/[^/]+$/, ''))
}

async function ensureParentDirectoriesForRelativePath(relativePath: string): Promise<string> {
  const root = filesystem.workingFolderPath.value
  if (!root) {
    throw new Error('Working folder is not set.')
  }

  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length <= 1) return root

  let current = root
  for (const segment of parts.slice(0, -1)) {
    const next = `${current}/${segment}`
    const exists = await pathExists(next)
    if (!exists) {
      await createEntry(current, segment, 'folder', 'fail')
    }
    current = next
  }

  return current
}

function onExplorerRequestCreate(payload: { parentPath: string; entryKind: 'file' | 'folder' }) {
  const prefill = parentPrefixForModal(payload.parentPath)
  if (payload.entryKind === 'folder') {
    void openNewFolderModal(prefill)
    return
  }
  void openNewFileModal(prefill)
}

async function submitNewFileFromModal() {
  const root = filesystem.workingFolderPath.value
  if (!root) {
    newFileModalError.value = 'Working folder is not set.'
    return false
  }

  const normalized = normalizeRelativeNotePath(newFilePathInput.value)
  if (!normalized || normalized.endsWith('/')) {
    newFileModalError.value = 'Invalid file path.'
    return false
  }
  if (normalized.startsWith('../') || normalized === '..') {
    newFileModalError.value = 'Path must stay inside the workspace.'
    return false
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts.some((part) => FORBIDDEN_FILE_NAME_CHARS_RE.test(part))) {
    newFileModalError.value = 'File names cannot include < > : " \\ | ? *'
    return false
  }

  const rawName = parts[parts.length - 1]
  const stem = rawName.replace(/\.(md|markdown)$/i, '')
  if (!stem) {
    newFileModalError.value = 'File name is required.'
    return false
  }
  if (WINDOWS_RESERVED_NAME_RE.test(stem)) {
    newFileModalError.value = 'That file name is reserved by the OS.'
    return false
  }
  const name = /\.(md|markdown)$/i.test(rawName) ? rawName : `${rawName}.md`
  const relativeWithExt = parts.length > 1
    ? `${parts.slice(0, -1).join('/')}/${name}`
    : name
  const fullPath = `${root}/${relativeWithExt}`
  const parentPath = parts.length > 1 ? `${root}/${parts.slice(0, -1).join('/')}` : root

  try {
    await ensureParentFolders(fullPath)
    const created = await createEntry(parentPath, name, 'file', 'fail')
    const opened = await openTabWithAutosave(created)
    if (!opened) return false
    upsertWorkspaceFilePath(created)
    closeNewFileModal()
    return true
  } catch (err) {
    newFileModalError.value = err instanceof Error ? err.message : 'Could not create file.'
    return false
  }
}

async function submitNewFolderFromModal() {
  const root = filesystem.workingFolderPath.value
  if (!root) {
    newFolderModalError.value = 'Working folder is not set.'
    return false
  }

  const normalized = normalizeRelativeNotePath(newFolderPathInput.value)
  if (!normalized || normalized.endsWith('/')) {
    newFolderModalError.value = 'Invalid folder path.'
    return false
  }
  if (normalized.startsWith('../') || normalized === '..') {
    newFolderModalError.value = 'Path must stay inside the workspace.'
    return false
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts.some((part) => FORBIDDEN_FILE_NAME_CHARS_RE.test(part))) {
    newFolderModalError.value = 'Folder names cannot include < > : " \\ | ? *'
    return false
  }

  const name = parts[parts.length - 1]
  if (!name) {
    newFolderModalError.value = 'Folder name is required.'
    return false
  }
  if (WINDOWS_RESERVED_NAME_RE.test(name)) {
    newFolderModalError.value = 'That folder name is reserved by the OS.'
    return false
  }

  try {
    const parentPath = await ensureParentDirectoriesForRelativePath(normalized)
    await createEntry(parentPath, name, 'folder', 'fail')
    closeNewFolderModal()
    return true
  } catch (err) {
    newFolderModalError.value = err instanceof Error ? err.message : 'Could not create folder.'
    return false
  }
}

function documentPathsForPane(paneId: string): string[] {
  const pane = multiPane.layout.value.panesById[paneId]
  if (!pane) return []
  return pane.openTabs
    .filter((tab) => tab.type === 'document')
    .map((tab) => (tab.type === 'document' ? tab.path : ''))
    .filter(Boolean)
}

function clearEditorStatusForPaths(paths: string[]) {
  for (const path of paths) {
    editorState.clearStatus(path)
  }
}

function closeAllTabsFromPalette() {
  const allDocumentPaths = Object.values(multiPane.layout.value.panesById)
    .flatMap((pane) =>
      pane.openTabs
        .filter((tab) => tab.type === 'document')
        .map((tab) => (tab.type === 'document' ? tab.path : ''))
        .filter(Boolean)
    )
  multiPane.closeAllTabsAndResetLayout()
  clearEditorStatusForPaths(allDocumentPaths)
  editorState.setActiveOutline([])
  return true
}

function closeAllTabsOnCurrentPaneFromPalette() {
  const paneId = multiPane.layout.value.activePaneId
  const panePaths = documentPathsForPane(paneId)
  multiPane.closeAllTabsInPane(paneId)
  clearEditorStatusForPaths(panePaths)
  editorState.setActiveOutline([])
  return true
}

async function openWorkspaceFromPalette() {
  return await onSelectWorkingFolder()
}

function closeWorkspaceFromPalette() {
  if (!filesystem.hasWorkspace.value) return false
  void closeWorkspace()
  return true
}
function closeOtherTabsFromPalette() {
  const paneId = multiPane.layout.value.activePaneId
  const active = multiPane.layout.value.panesById[paneId]?.activeTabId ?? ''
  if (!active) return false
  multiPane.closeOtherTabsInPane(paneId, active)
  return true
}

async function splitPaneFromPalette(axis: 'row' | 'column') {
  const createdPaneId = multiPane.splitPane(multiPane.layout.value.activePaneId, axis)
  if (!createdPaneId) return false
  // Some focus events from the previous editor can fire right after split.
  // Re-apply the new pane focus after DOM update to keep UX deterministic.
  await nextTick()
  multiPane.setActivePane(createdPaneId)
  return true
}

function focusPaneFromPalette(index: number) {
  return multiPane.focusPaneByIndex(index)
}

function focusNextPaneFromPalette() {
  return multiPane.focusAdjacentPane('next')
}

function moveTabToNextPaneFromPalette() {
  return multiPane.moveActiveTabToAdjacentPane('next')
}

function closeActivePaneFromPalette() {
  return multiPane.closePane(multiPane.layout.value.activePaneId)
}

function joinPanesFromPalette() {
  multiPane.joinAllPanes()
  return true
}

function resetPaneLayoutFromPalette() {
  multiPane.resetToSinglePane()
  return true
}

function onQuickOpenEnter() {
  if (quickOpenIsActionMode.value) {
    const action = quickOpenActionResults.value[quickOpenActiveIndex.value]
    if (action) {
      void runQuickOpenAction(action.id)
    }
    return
  }

  const item = quickOpenResults.value[quickOpenActiveIndex.value]
  if (item) {
    void openQuickResult(item)
  }
}

function onQuickOpenInputKeydown(event: KeyboardEvent) {
  if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    // Keep native caret/selection behavior in the input, but prevent app-level handlers.
    event.stopPropagation()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    moveQuickOpenSelection(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    moveQuickOpenSelection(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    onQuickOpenEnter()
  }
}

function onOpenDateInputKeydown(event: KeyboardEvent) {
  if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.stopPropagation()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeOpenDateModal()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    void submitOpenDateFromModal()
  }
}

function onNewFileInputKeydown(event: KeyboardEvent) {
  if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.stopPropagation()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeNewFileModal()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    void submitNewFileFromModal()
  }
}

function onNewFolderInputKeydown(event: KeyboardEvent) {
  if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.stopPropagation()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeNewFolderModal()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    void submitNewFolderFromModal()
  }
}

function scrollQuickOpenActiveItemIntoView() {
  if (!quickOpenVisible.value) return
  void nextTick(() => {
    const modalList = document.querySelector<HTMLElement>('[data-modal="quick-open"] .modal-list')
    if (!modalList) return
    const activeItem = modalList.querySelector<HTMLElement>('.modal-item.active')
    activeItem?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  })
}

async function saveActiveTab() {
  await editorRef.value?.saveNow()
}

function onWindowKeydown(event: KeyboardEvent) {
  const isEscape = event.key === 'Escape' || event.key === 'Esc' || event.code === 'Escape'
  if (isEscape && wikilinkRewritePrompt.value) {
    event.preventDefault()
    event.stopPropagation()
    resolveWikilinkRewritePrompt(false)
    return
  }
  if (isEscape && newFileModalVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeNewFileModal()
    return
  }
  if (isEscape && newFolderModalVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeNewFolderModal()
    return
  }
  if (isEscape && openDateModalVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeOpenDateModal()
    return
  }
  if (isEscape && settingsModalVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeSettingsModal()
    return
  }
  if (isEscape && shortcutsModalVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeShortcutsModal()
    return
  }
  if (isEscape && indexStatusModalVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeIndexStatusModal()
    return
  }
  if (isEscape && cosmosCommandLoadingVisible.value) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (quickOpenVisible.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      moveQuickOpenSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      moveQuickOpenSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onQuickOpenEnter()
      return
    }
  }

  if (isEscape) {
    if (historyMenuOpen.value) {
      event.preventDefault()
      event.stopPropagation()
      closeHistoryMenu()
      return
    }
    if (overflowMenuOpen.value) {
      event.preventDefault()
      event.stopPropagation()
      closeOverflowMenu()
      return
    }
    if (quickOpenVisible.value) {
      event.preventDefault()
      event.stopPropagation()
      closeQuickOpen()
      return
    }
  }

  if (trapTabWithinActiveModal(event)) {
    event.stopPropagation()
    return
  }

  const isMod = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()

  if (isMod && key === 'w') {
    event.preventDefault()
    const paneId = multiPane.layout.value.activePaneId
    const pane = multiPane.layout.value.panesById[paneId]
    const tab = pane?.openTabs.find((item) => item.id === pane.activeTabId)
    if (tab) {
      multiPane.closeTabInPane(paneId, tab.id)
      if (tab.type === 'document') {
        editorState.clearStatus(tab.path)
      }
    }
    return
  }

  if (hasBlockingModalOpen()) return

  if (shouldBlockGlobalShortcutsFromTarget(event.target)) return

  if (!isMod) return

  if (key === 'p' && !event.shiftKey) {
    event.preventDefault()
    void openQuickOpen()
    return
  }

  if (key === 'p' && event.shiftKey) {
    event.preventDefault()
    openCommandPalette()
    return
  }

  if (key === 'd') {
    event.preventDefault()
    void openTodayNote()
    return
  }

  if (key === '[' && !event.shiftKey) {
    event.preventDefault()
    void goBackInHistory()
    return
  }

  if (key === ']' && !event.shiftKey) {
    event.preventDefault()
    void goForwardInHistory()
    return
  }

  if (key === 'h' && event.shiftKey) {
    event.preventDefault()
    void openTodayNote()
    return
  }

  if (key === '\\' && !event.shiftKey) {
    event.preventDefault()
    void splitPaneFromPalette('row')
    return
  }

  if (key === '\\' && event.shiftKey) {
    event.preventDefault()
    void splitPaneFromPalette('column')
    return
  }

  if (key >= '1' && key <= '4') {
    event.preventDefault()
    const index = Number.parseInt(key, 10)
    void focusPaneFromPalette(index)
    return
  }

  if (event.altKey && event.shiftKey && key === 'arrowright') {
    event.preventDefault()
    void multiPane.moveActiveTabToAdjacentPane('next')
    return
  }

  if (event.altKey && event.shiftKey && key === 'arrowleft') {
    event.preventDefault()
    void multiPane.moveActiveTabToAdjacentPane('previous')
    return
  }

  if (key === 'tab') {
    event.preventDefault()
    void openNextTabWithAutosave()
    return
  }

  if (key === 'f' && event.shiftKey) {
    event.preventDefault()
    openSearchPanel()
    return
  }

  if (key === 'e') {
    event.preventDefault()
    void showExplorerForActiveFile({ focusTree: true })
    return
  }

  if (key === 'b') {
    if (hasActiveTextSelectionInEditor(event.target)) {
      return
    }
    event.preventDefault()
    workspace.toggleSidebar()
    return
  }

  if (key === 'j') {
    event.preventDefault()
    workspace.toggleRightPane()
    return
  }

  if (key === 's') {
    event.preventDefault()
    void saveActiveTab()
    return
  }

  if (key === 'k') {
    event.preventDefault()
    openCommandPalette()
  }
}

watch(themePreference, () => {
  persistThemePreference()
  applyTheme()
})

watch(
  () => noteEchoes.items.value.length,
  (count, previousCount = 0) => {
    if (count > 0 && previousCount === 0) {
      noteEchoesDiscoverability.markPackShown()
    }
  }
)

watch(
  () => workspace.sidebarMode.value,
  (mode) => {
    persistSidebarMode()
    previousNonCosmosMode.value = mode
    persistPreviousNonCosmosMode()
  }
)

watch(quickOpenQuery, () => {
  quickOpenActiveIndex.value = 0
})

watch(quickOpenActiveIndex, () => {
  scrollQuickOpenActiveItemIntoView()
})

watch(quickOpenVisible, (visible) => {
  if (!visible) return
  scrollQuickOpenActiveItemIntoView()
})

watch(cosmosCommandLoadingVisible, (visible) => {
  if (!visible) return
  void nextTick(() => {
    document.querySelector<HTMLElement>('[data-modal="cosmos-command-loading"]')?.focus()
  })
})

watch(searchQuery, (next) => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  if (!next.trim() || !filesystem.workingFolderPath.value) {
    searchRequestToken += 1
    hasSearched.value = false
    searchLoading.value = false
    searchHits.value = []
    return
  }
  searchDebounceTimer = setTimeout(() => {
    void runGlobalSearch()
  }, 180)
})

watch(newFilePathInput, () => {
  if (newFileModalError.value) {
    newFileModalError.value = ''
  }
})

watch(newFolderPathInput, () => {
  if (newFolderModalError.value) {
    newFolderModalError.value = ''
  }
})

watch(openDateInput, () => {
  if (openDateModalError.value) {
    openDateModalError.value = ''
  }
})

watch(quickOpenItemCount, (count) => {
  if (count <= 0) {
    quickOpenActiveIndex.value = 0
    return
  }
  if (quickOpenActiveIndex.value >= count) {
    quickOpenActiveIndex.value = count - 1
  }
})

watch(
  () => filesystem.workingFolderPath.value,
  () => {
    documentHistory.reset()
    resetWorkspaceState()
    backlinks.value = []
    semanticLinks.value = []
    virtualDocs.value = {}
  }
)

watch(
  () => filesystem.indexingState.value,
  () => {
    if (indexStatusModalVisible.value) {
      void refreshIndexModalData()
    }
  }
)

watch(
  () => activeFilePath.value,
  (path) => {
    void refreshActiveFileMetadata(path)
  },
  { immediate: true }
)

watch(
  () => multiPane.layout.value,
  (layout) => {
    window.sessionStorage.setItem(MULTI_PANE_STORAGE_KEY, JSON.stringify(serializeLayout(layout)))
  },
  { deep: true }
)

watch(
  () => activeFilePath.value,
  async (path) => {
    if (!path) {
      editorState.setActiveOutline([])
      return
    }

    const snippet = editorState.consumeRevealSnippet(path)
    if (!snippet) return

    await nextTick()
    await editorRef.value?.revealSnippet(snippet)
    await refreshBacklinks()
  }
)

watch(
  () => activeFilePath.value,
  () => {
    void refreshBacklinks()
  }
)

onMounted(() => {
  loadThemePreference()
  loadSavedSidebarMode()
  applyTheme()
  editorZoom.value = readStoredEditorZoom()
  mediaQuery?.addEventListener('change', onSystemThemeChanged)
  window.addEventListener('keydown', onWindowKeydown, true)
  window.addEventListener('mousedown', onGlobalPointerDown, true)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', stopResize)
  void listenWorkspaceFsChanged((payload) => {
    const root = filesystem.workingFolderPath.value
    if (!root) return
    if (normalizePath(payload.root).toLowerCase() !== normalizePath(root).toLowerCase()) return
    applyWorkspaceFsChanges(payload.changes)
  }).then((unlisten) => {
    unlistenWorkspaceFsChanged = unlisten
  }).catch(() => {
    unlistenWorkspaceFsChanged = null
  })

  const savedFolder = window.localStorage.getItem(WORKING_FOLDER_STORAGE_KEY)
  if (savedFolder) {
    void loadWorkingFolder(savedFolder)
  }

})

onBeforeUnmount(() => {
  clearWikilinkRewritePromptQueue()
  disposeIndexingController()
  disposeNavigationController()
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  if (historyMenuTimer) {
    clearTimeout(historyMenuTimer)
    historyMenuTimer = null
  }
  mediaQuery?.removeEventListener('change', onSystemThemeChanged)
  window.removeEventListener('keydown', onWindowKeydown, true)
  window.removeEventListener('mousedown', onGlobalPointerDown, true)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', stopResize)
  if (unlistenWorkspaceFsChanged) {
    unlistenWorkspaceFsChanged()
    unlistenWorkspaceFsChanged = null
  }
})
</script>

<template>
  <div class="ide-root" :class="{ dark: resolvedTheme === 'dark', 'macos-overlay': isMacOs }">
    <div class="body-row">
      <SidebarSurface
        ref="explorerRef"
        :sidebar-visible="workspace.sidebarVisible.value"
        :sidebar-mode="workspace.sidebarMode.value"
        :working-folder-path="filesystem.workingFolderPath.value"
        :has-workspace="filesystem.hasWorkspace.value"
        :left-pane-width="leftPaneWidth"
        :active-file-path="activeFilePath"
        :search-query="searchQuery"
        :global-search-mode="globalSearchMode"
        :search-mode-options="searchModeOptions"
        :show-search-score="showSearchScore"
        :has-searched="hasSearched"
        :search-loading="searchLoading"
        :grouped-search-results="groupedSearchResults"
        :to-relative-path="toRelativePath"
        :format-search-score="formatSearchScore"
        :parse-search-snippet="parseSearchSnippet"
        @set-sidebar-mode="setSidebarMode"
        @explorer-open="onExplorerOpen"
        @explorer-path-renamed="onExplorerPathRenamed"
        @explorer-request-create="onExplorerRequestCreate"
        @explorer-selection="onExplorerSelection"
        @explorer-error="onExplorerError"
        @select-working-folder="void onSelectWorkingFolder()"
        @update-search-query="searchQuery = $event"
        @run-global-search="runGlobalSearch"
        @select-global-search-mode="onGlobalSearchModeSelect"
        @open-search-result="onSearchResultOpen"
      />

      <section class="workspace-column">
        <TopbarNavigationControls
          ref="topbarRef"
          :can-go-back="documentHistory.canGoBack.value"
          :can-go-forward="documentHistory.canGoForward.value"
          :back-shortcut-label="backShortcutLabel"
          :forward-shortcut-label="forwardShortcutLabel"
          :home-shortcut-label="homeShortcutLabel"
          :has-workspace="filesystem.hasWorkspace.value"
          :right-pane-visible="workspace.rightPaneVisible.value"
          :history-menu-open="historyMenuOpen"
          :history-menu-style="historyMenuStyle"
          :back-items="backHistoryItems"
          :forward-items="forwardHistoryItems"
          :pane-count="paneCount"
          :overflow-menu-open="overflowMenuOpen"
          :indexing-state="filesystem.indexingState.value"
          :zoom-percent-label="zoomPercentLabel"
          :theme-preference="themePreference"
          @history-button-click="onHistoryButtonClick"
          @history-button-context-menu="onHistoryButtonContextMenu"
          @history-button-pointer-down="onHistoryButtonPointerDown"
          @history-long-press-cancel="cancelHistoryLongPress"
          @history-target-click="onHistoryTargetClick"
          @open-today="void openTodayNote()"
          @open-cosmos="void openCosmosViewFromPalette()"
          @open-second-brain="void openSecondBrainViewFromPalette()"
          @split-right="splitPaneFromPalette('row')"
          @split-down="splitPaneFromPalette('column')"
          @focus-pane="focusPaneFromPalette($event)"
          @focus-next="focusNextPaneFromPalette()"
          @move-tab-next="moveTabToNextPaneFromPalette()"
          @close-pane="closeActivePaneFromPalette()"
          @join-panes="joinPanesFromPalette()"
          @reset-layout="resetPaneLayoutFromPalette()"
          @toggle-right-pane="workspace.toggleRightPane()"
          @toggle-overflow="toggleOverflowMenu"
          @open-command-palette="openCommandPalette"
          @open-shortcuts="openShortcutsFromOverflow"
          @open-settings="openSettingsFromOverflow"
          @rebuild-index="void rebuildIndexFromOverflow()"
          @close-workspace="closeWorkspace"
          @zoom-in="zoomInFromOverflow"
          @zoom-out="zoomOutFromOverflow"
          @reset-zoom="resetZoomFromOverflow"
          @set-theme="setThemeFromOverflow"
        />

        <div class="workspace-row">
          <div
            v-if="workspace.sidebarVisible.value"
            class="splitter"
            @mousedown="beginResize('left', $event)"
          ></div>

          <main class="center-area">
            <EditorPaneGrid
              ref="editorRef"
              :layout="multiPane.layout.value"
              :active-document-path="activeFilePath"
              :get-status="editorState.getStatus"
              :openFile="openFile"
              :saveFile="saveFile"
              :renameFileFromTitle="renameFileFromTitle"
              :loadLinkTargets="loadWikilinkTargets"
              :loadLinkHeadings="loadWikilinkHeadings"
              :loadPropertyTypeSchema="loadPropertyTypeSchema"
              :savePropertyTypeSchema="savePropertyTypeSchema"
              :openLinkTarget="openWikilinkTarget"
              :cosmos="{
                graph: cosmos.visibleGraph.value,
                loading: cosmos.loading.value,
                error: cosmos.error.value,
                selectedNodeId: cosmos.selectedNodeId.value,
                focusMode: cosmos.focusMode.value,
                focusDepth: cosmos.focusDepth.value,
                summary: cosmos.summary.value,
                query: cosmos.query.value,
                matches: cosmos.queryMatches.value,
                showSemanticEdges: cosmos.showSemanticEdges.value,
                selectedNode: cosmosSelectedNodeForPanel,
                selectedLinkCount: cosmos.selectedLinkCount.value,
                preview: cosmos.preview.value,
                previewLoading: cosmos.previewLoading.value,
                previewError: cosmos.previewError.value,
                outgoingNodes: cosmos.outgoingNodes.value,
                incomingNodes: cosmos.incomingNodes.value
              }"
              :second-brain="{
                workspacePath: filesystem.workingFolderPath.value,
                allWorkspaceFiles,
                requestedSessionId: secondBrainRequestedSessionId,
                requestedSessionNonce: secondBrainRequestedSessionNonce,
                activeNotePath: activeFilePath
              }"
              @pane-focus="multiPane.setActivePane($event.paneId)"
              @pane-tab-click="void onPaneTabClick($event)"
              @pane-tab-close="onPaneTabClose($event)"
              @pane-tab-close-others="onPaneTabCloseOthers($event)"
              @pane-tab-close-all="onPaneTabCloseAll($event)"
              @pane-request-move-tab="multiPane.moveActiveTabToAdjacentPane($event.direction)"
              @open-note="void openNoteFromSecondBrain($event)"
              @second-brain-context-changed="onSecondBrainContextChanged"
              @second-brain-session-changed="onSecondBrainSessionChanged"
              @cosmos-query-update="onCosmosQueryUpdate"
              @cosmos-search-enter="onCosmosSearchEnter"
              @cosmos-select-match="onCosmosMatchClick"
              @cosmos-toggle-focus-mode="onCosmosToggleFocusMode"
              @cosmos-toggle-semantic-edges="onCosmosToggleSemanticEdges"
              @cosmos-expand-neighborhood="onCosmosExpandNeighborhood"
              @cosmos-jump-related="onCosmosJumpToRelatedNode"
              @cosmos-open-selected="void onCosmosOpenSelectedNode()"
              @cosmos-locate-selected="onCosmosLocateSelectedNode"
              @cosmos-reset-view="onCosmosResetView"
              @cosmos-select-node="onCosmosSelectNode"
              @status="onEditorStatus"
              @path-renamed="onEditorPathRenamed"
              @outline="onEditorOutline"
              @properties="onEditorProperties"
            />
          </main>

          <div
            v-if="workspace.rightPaneVisible.value"
            class="splitter"
            @mousedown="beginResize('right', $event)"
          ></div>

          <EditorRightPane
            v-if="workspace.rightPaneVisible.value"
            :width="rightPaneWidth"
            :echoes-items="noteEchoes.items.value"
            :echoes-loading="noteEchoes.loading.value"
            :echoes-error="noteEchoes.error.value"
            :echoes-hint-visible="noteEchoesDiscoverability.hintVisible.value"
            :outline="editorState.activeOutline.value"
            :semantic-links="semanticLinks"
            :semantic-links-loading="semanticLinksLoading"
            :backlinks="backlinks"
            :backlinks-loading="backlinksLoading"
            :metadata-rows="metadataRows"
            :properties-preview="propertiesPreview"
            :property-parse-error-count="propertyParseErrorCount"
            :to-relative-path="toRelativePath"
            @echoes-open="void onBacklinkOpen($event)"
            @outline-click="void onOutlineHeadingClick($event)"
            @backlink-open="void onBacklinkOpen($event)"
          />
        </div>
      </section>
    </div>

    <WorkspaceStatusBar
      :active-file-label="activeFilePath ? toRelativePath(activeFilePath) : 'No file'"
      :active-state-label="activeStatus.saving ? 'saving...' : virtualDocs[activeFilePath] ? 'unsaved' : activeStatus.dirty ? 'edit' : 'saved'"
      :index-state-label="indexStateLabel"
      :index-state-class="indexStateClass"
      :workspace-label="filesystem.workingFolderPath.value || 'none'"
      @open-index-status="openIndexStatusModal"
    />

    <div
      v-if="filesystem.notificationMessage.value"
      class="toast"
      :class="`toast-${filesystem.notificationTone.value}`"
      role="status"
      aria-live="polite"
    >
      <span>{{ filesystem.notificationMessage.value }}</span>
      <button type="button" class="toast-close" aria-label="Dismiss notification" @click="filesystem.clearNotification()">
        ×
      </button>
    </div>

    <IndexStatusModal
      :visible="indexStatusModalVisible"
      :running="indexRunning"
      :busy="indexStatusBusy"
      :runtime-status="indexRuntimeStatus"
      :badge-label="indexStatusBadgeLabel"
      :badge-class="indexStatusBadgeClass"
      :show-progress-bar="indexShowProgressBar"
      :progress-percent="indexProgressPercent"
      :progress-label="indexProgressLabel"
      :progress-summary="indexProgressSummary"
      :current-path-label="indexRunCurrentPath ? toRelativePath(indexRunCurrentPath) : ''"
      :model-state-class="indexModelStateClass"
      :model-status-label="indexModelStatusLabel"
      :show-warmup-note="indexShowWarmupNote"
      :alert="indexAlert"
      :log-filter="indexLogFilter"
      :filtered-rows="filteredIndexActivityRows"
      :error-count="indexErrorCount"
      :slow-count="indexSlowCount"
      :action-label="indexActionLabel"
      :format-duration-ms="formatDurationMs"
      :format-timestamp="formatTimestamp"
      @close="closeIndexStatusModal"
      @action="onIndexPrimaryAction"
      @update:log-filter="indexLogFilter = $event"
    />

    <QuickOpenModal
      :visible="quickOpenVisible"
      :query="quickOpenQuery"
      :is-action-mode="quickOpenIsActionMode"
      :action-results="quickOpenActionResults"
      :file-results="quickOpenResults"
      :active-index="quickOpenActiveIndex"
      @close="closeQuickOpen()"
      @update:query="quickOpenQuery = $event"
      @keydown="onQuickOpenInputKeydown"
      @select-action="runQuickOpenAction"
      @select-result="openQuickResult"
      @set-active-index="setQuickOpenActiveIndex"
    />

    <div v-if="cosmosCommandLoadingVisible" class="modal-overlay">
      <div
        class="modal confirm-modal cosmos-command-loading-modal"
        data-modal="cosmos-command-loading"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="cosmos-command-loading-title"
        tabindex="-1"
      >
        <h3 id="cosmos-command-loading-title" class="confirm-title">Opening Cosmos</h3>
        <p class="confirm-text">{{ cosmosCommandLoadingLabel }}</p>
        <div class="cosmos-command-loading-track">
          <div class="cosmos-command-loading-bar"></div>
        </div>
      </div>
    </div>

    <WorkspaceEntryModals
      :new-file-visible="newFileModalVisible"
      :new-file-path-input="newFilePathInput"
      :new-file-error="newFileModalError"
      :new-folder-visible="newFolderModalVisible"
      :new-folder-path-input="newFolderPathInput"
      :new-folder-error="newFolderModalError"
      :open-date-visible="openDateModalVisible"
      :open-date-input="openDateInput"
      :open-date-error="openDateModalError"
      @close-new-file="closeNewFileModal"
      @update-new-file-path="newFilePathInput = $event"
      @keydown-new-file="onNewFileInputKeydown"
      @submit-new-file="submitNewFileFromModal"
      @close-new-folder="closeNewFolderModal"
      @update-new-folder-path="newFolderPathInput = $event"
      @keydown-new-folder="onNewFolderInputKeydown"
      @submit-new-folder="submitNewFolderFromModal"
      @close-open-date="closeOpenDateModal"
      @update-open-date="openDateInput = $event"
      @keydown-open-date="onOpenDateInputKeydown"
      @submit-open-date="submitOpenDateFromModal"
    />

    <SettingsModal
      :visible="settingsModalVisible"
      @cancel="closeSettingsModal"
      @saved="onSettingsSaved"
    />

    <ShortcutsModal
      :visible="shortcutsModalVisible"
      :filter-query="shortcutsFilterQuery"
      :sections="filteredShortcutSections"
      @close="closeShortcutsModal"
      @update:filter-query="shortcutsFilterQuery = $event"
    />

    <WikilinkRewriteModal
      :prompt="wikilinkRewritePrompt"
      :from-label="wikilinkRewritePrompt ? toRelativePath(wikilinkRewritePrompt.fromPath) : ''"
      :to-label="wikilinkRewritePrompt ? toRelativePath(wikilinkRewritePrompt.toPath) : ''"
      @resolve="resolveWikilinkRewritePrompt"
    />
  </div>
</template>

<style>
.ide-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f9f9fb;
  color: #2d313a;
}

.ide-root.dark {
  background: #282c34;
  color: #abb2bf;
}

.topbar {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #e5e7eb;
  background: #f2f4f8;
}

.ide-root.dark .topbar {
  border-bottom-color: #3e4451;
  background: #21252b;
}

.tabs-row {
  min-width: 0;
  flex: 1;
  height: 100%;
}

.tab-scroll {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  height: 100%;
  background: #f2f4f8;
}

.ide-root.dark .tab-scroll {
  background: #21252b;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-right: 1px solid #e5e7eb;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #5b6472;
  min-width: 140px;
  max-width: 220px;
  padding: 0 12px;
  font-size: 12px;
}

.ide-root.dark .tab-item {
  border-right-color: #3e4451;
  background: #252a33;
  color: #8b93a3;
}

.tab-item.active {
  border: 1px solid #e5e7eb;
  border-bottom-color: #ffffff;
  background: #ffffff;
  color: #2d313a;
  font-weight: 600;
  margin-bottom: -1px;
}

.ide-root.dark .tab-item.active {
  border-color: #3e4451;
  border-bottom-color: #282c34;
  background: #282c34;
  color: #d7dce5;
}

.ide-root.dark .tab-item:not(.active):hover {
  background: #2c313a;
  color: #d7dce5;
}

.tab-item:not(.active):hover {
  color: #1f2937;
  background: #e8ecf3;
}

.ide-root.dark .tab-item:not(.active):hover {
  color: #d7dce5;
}

.tab-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-cosmos-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
}

.tab-state {
  width: 10px;
  text-align: center;
}

.tab-close {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  width: 16px;
  height: 16px;
  font-size: 12px;
}

.tab-close svg {
  width: 12px;
  height: 12px;
}

.tab-empty {
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  color: #5b6472;
  font-size: 12px;
}

.global-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  position: relative;
  margin: 0 auto;
}

.nav-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 2px;
  padding-right: 6px;
  border-right: 1px solid #e5e7eb;
}

.history-nav-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 28px;
}

.history-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 90;
  min-width: 220px;
  max-width: 320px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.history-menu-item {
  border: 0;
  background: transparent;
  color: #5b6472;
  border-radius: 8px;
  text-align: left;
  padding: 7px 8px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-menu-item:hover {
  background: #f1f2f6;
  color: #2d313a;
}

.history-menu-empty {
  padding: 7px 8px;
  font-size: 12px;
  color: #5b6472;
}

.toolbar-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #5b6472;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.toolbar-icon-btn:hover {
  background: #f1f2f6;
  color: #1f2937;
}

.toolbar-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}

.toolbar-icon-btn.active {
  border-color: #e5e7eb;
  background: #ffffff;
  color: #2d313a;
}

.toolbar-icon-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
}

.ide-root.dark .toolbar-icon-btn {
  color: #8b93a3;
}

.ide-root.dark .toolbar-icon-btn:hover {
  background: #2c313a;
  color: #d7dce5;
}

.ide-root.dark .toolbar-icon-btn.active {
  border-color: #3e4451;
  background: #282c34;
  color: #d7dce5;
}

.ide-root.dark .nav-actions {
  border-right-color: #3e4451;
}

.ide-root.dark .history-menu {
  border-color: #3e4451;
  background: #21252b;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
}

.ide-root.dark .history-menu-item {
  color: #c8d0dc;
}

.ide-root.dark .history-menu-item:hover {
  background: #2c313a;
}

.ide-root.dark .history-menu-empty {
  color: #8b93a3;
}

.overflow-wrap {
  position: relative;
}

.overflow-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 220px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ide-root.dark .overflow-menu {
  border-color: #3e4451;
  background: #21252b;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
}

.overflow-item {
  border: 0;
  background: transparent;
  color: #5b6472;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  padding: 7px 10px;
}

.overflow-item:hover {
  background: #f1f2f6;
  color: #1f2937;
}

.overflow-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.overflow-item.active {
  background: rgb(94 106 210 / 0.12);
  color: #5e6ad2;
  font-weight: 500;
}

.ide-root.dark .overflow-item {
  color: #c8d0dc;
}

.ide-root.dark .overflow-item:hover {
  background: #2c313a;
  color: #d7dce5;
}

.ide-root.dark .overflow-item:disabled {
  opacity: 0.45;
}

.ide-root.dark .overflow-item.active {
  background: #3e4451;
  color: #e5e7eb;
}

.overflow-item-icon {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  flex: 0 0 auto;
}

.overflow-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  border: 1px solid currentColor;
  border-radius: 3px;
}

.overflow-zoom-state {
  padding: 2px 10px 4px;
  font-size: 11px;
  color: #5b6472;
}

.ide-root.dark .overflow-zoom-state {
  color: #5c6370;
}

.overflow-divider {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 0;
}

.ide-root.dark .overflow-divider {
  background: #3e4451;
}

.overflow-label {
  padding: 2px 10px 4px;
  font-size: 11px;
  color: #5b6472;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.ide-root.dark .overflow-label {
  color: #5c6370;
}

.body-row {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.workspace-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.workspace-row {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.activity-bar {
  width: 44px;
  border-right: 1px solid #e5e7eb;
  background: #f2f4f8;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  gap: 6px;
}

.ide-root.macos-overlay .activity-bar {
  padding-top: 38px;
}

.ide-root.dark .activity-bar {
  border-right-color: #3e4451;
  background: #21252b;
}

.activity-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #5b6472;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.activity-btn:hover {
  background: #f1f2f6;
  color: #1f2937;
}

.activity-btn.active {
  color: #5e6ad2;
  border-color: #e5e7eb;
  box-shadow: inset 2px 0 0 #5e6ad2;
  background: #ffffff;
}

.activity-btn-icon {
  width: 14px;
  height: 14px;
  stroke-width: 1.6;
}

.ide-root.dark .activity-btn {
  color: #8b93a3;
}

.ide-root.dark .activity-btn.active {
  color: #d7dce5;
  border-color: #3e4451;
  background: #282c34;
}

.ide-root.dark .activity-btn:hover {
  background: #2c313a;
  color: #d7dce5;
}

.left-sidebar {
  min-width: 0;
  min-height: 0;
  background: #f2f4f8;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.ide-root.macos-overlay .left-sidebar {
  box-sizing: border-box;
  padding-top: 28px;
}

.ide-root.dark .left-sidebar {
  background: #21252b;
  border-color: #3e4451;
}

.panel-header {
  height: 34px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 8px;
}

.ide-root.dark .panel-header {
  border-bottom-color: #3e4451;
}

.panel-title {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4b5563;
}

.ide-root.dark .panel-title {
  color: #8b93a3;
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 8px;
}

.panel-body.panel-body-explorer {
  padding: 6px 6px 8px;
}

.panel-fill {
  height: 100%;
  min-height: 0;
}

.empty-explorer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.inline-link-btn {
  border: 0;
  background: transparent;
  color: #5e6ad2;
  font-size: 12px;
  font-weight: 500;
  padding: 0;
  text-decoration: underline;
  cursor: pointer;
}

.inline-link-btn:hover {
  color: #2d313a;
}

.ide-root.dark .inline-link-btn {
  color: #61afef;
}

.ide-root.dark .inline-link-btn:hover {
  color: #7ec5ff;
}

.search-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-controls {
  display: flex;
  gap: 6px;
}

.search-mode-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.search-mode-chip {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #ffffff;
  color: #475569;
  padding: 2px 9px;
  font-size: 10px;
  line-height: 1.4;
}

.search-mode-chip.active {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #dbeafe;
}

.search-mode-chip:disabled {
  opacity: 0.5;
}

.search-mode-hint {
  margin: -2px 0 0;
  font-size: 10px;
  color: #64748b;
}

.search-mode-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: inherit;
}

.tool-input {
  width: 100%;
  height: 30px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #ffffff;
  color: #2d313a;
  padding: 0 8px;
  font-size: 12px;
}

.tool-input:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  cursor: not-allowed;
}

.ide-root.dark .tool-input {
  border-color: #3e4451;
  background: #282c34;
  color: #abb2bf;
}

.ide-root.dark .tool-input:disabled {
  background: #21252b;
  color: #7d8595;
}

.ide-root.dark .search-mode-chip {
  border-color: #475569;
  color: #cbd5e1;
  background: #1e293b;
}

.ide-root.dark .search-mode-chip.active {
  border-color: #60a5fa;
  color: #bfdbfe;
  background: #1e3a8a;
}

.ide-root.dark .search-mode-hint {
  color: #94a3b8;
}

.results-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.result-group {
  margin-bottom: 12px;
}

.result-file {
  margin: 0 0 4px;
  font-size: 11px;
  color: #5b6472;
}

.result-item {
  width: 100%;
  text-align: left;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  border-radius: 4px;
  padding: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}

.result-score {
  margin: 0 0 4px;
  font-size: 10px;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.ide-root.dark .result-item {
  border-color: #3e4451;
  background: #21252b;
  color: #abb2bf;
}

.ide-root.dark .result-score {
  color: #94a3b8;
}

.result-snippet :deep(strong) {
  font-weight: 700;
}

.splitter {
  width: 8px;
  flex: 0 0 8px;
  position: relative;
  cursor: col-resize;
  background: transparent;
}

.splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: #e5e7eb;
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 120ms ease;
}

.splitter:hover::before {
  opacity: 0.45;
}

.splitter:active::before {
  opacity: 0.7;
}

.ide-root.dark .splitter::before {
  background: #5c6370;
}

.center-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
}

.ide-root.dark .center-area {
  background: #282c34;
}

.status-bar {
  height: 22px;
  border-top: 1px solid #e5e7eb;
  background: #f2f4f8;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  color: #4b5563;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0;
  overflow-x: auto;
}

.ide-root.dark .status-bar {
  border-top-color: #3e4451;
  background: #21252b;
  color: #8b93a3;
}

.status-item {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 8px;
  white-space: nowrap;
}

.status-trigger {
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.status-trigger:hover {
  filter: brightness(0.94);
}

.status-item-state {
  width: 10ch;
  justify-content: center;
}

.status-item-index {
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
  background: #94a3b8;
}

.status-dot.status-item-indexing {
  background: #2563eb;
  animation: statusPulse 1.2s ease-in-out infinite;
}

.status-dot.status-item-indexed {
  background: #22c55e;
}

.status-dot.status-item-out-of-sync {
  background: #f97316;
}

.ide-root.dark .status-dot.status-item-indexing {
  background: #60a5fa;
}

.ide-root.dark .status-dot.status-item-indexed {
  background: #4ade80;
}

.ide-root.dark .status-dot.status-item-out-of-sync {
  background: #fb923c;
}

.status-item + .status-item {
  border-left: 1px solid #cbd5e1;
}

.ide-root.dark .status-item + .status-item {
  border-left-color: #3e4451;
}

@keyframes statusPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.index-status-modal {
  width: min(980px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 0% 0%, rgba(191, 219, 254, 0.22), transparent 42%),
    radial-gradient(circle at 100% 100%, rgba(254, 215, 170, 0.18), transparent 36%),
    #f9fbff;
}

.ide-root.dark .index-status-modal {
  background:
    radial-gradient(circle at 0% 0%, rgba(30, 64, 175, 0.2), transparent 38%),
    radial-gradient(circle at 100% 100%, rgba(120, 53, 15, 0.16), transparent 42%),
    #1f2430;
}

.index-status-body {
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}

.index-overview {
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  padding: 12px;
  margin-bottom: 10px;
}

.ide-root.dark .index-overview {
  border-color: #334155;
  background: rgba(30, 41, 59, 0.72);
}

.index-overview-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.index-overview-progress-inline {
  flex: 1 1 260px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.index-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
}

.index-status-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.index-badge-ready {
  background: #dcfce7;
  color: #166534;
}

.index-badge-ready .index-status-badge-dot {
  background: #22c55e;
}

.index-badge-running {
  background: #dbeafe;
  color: #1d4ed8;
}

.index-badge-running .index-status-badge-dot {
  background: #2563eb;
  animation: statusPulse 1.2s ease-in-out infinite;
}

.index-badge-error {
  background: #ffedd5;
  color: #9a3412;
}

.index-badge-error .index-status-badge-dot {
  background: #f97316;
}

.index-overview-summary {
  margin: 0;
  font-size: 12px;
  color: #1f2937;
  font-weight: 600;
}

.index-overview-current {
  margin: 0;
  width: 100%;
  font-size: 11px;
  color: #64748b;
}

.ide-root.dark .index-overview-summary {
  color: #e2e8f0;
}

.ide-root.dark .index-overview-current {
  color: #94a3b8;
}

.index-progress-track {
  margin-top: 10px;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: #e2e8f0;
}

.ide-root.dark .index-progress-track {
  background: #334155;
}

.index-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #2563eb 0%, #0ea5e9 100%);
  transition: width 180ms ease;
}

.index-progress-meta {
  margin-top: 6px;
  font-size: 11px;
  color: #475569;
  display: flex;
  justify-content: space-between;
}

.index-overview-progress-inline .index-progress-track,
.index-overview-progress-inline .index-progress-meta {
  margin-top: 0;
}

.ide-root.dark .index-progress-meta {
  color: #94a3b8;
}

.index-model-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.84);
  margin-bottom: 10px;
}

.ide-root.dark .index-model-card {
  border-color: #3e4451;
  background: rgba(30, 41, 59, 0.68);
}

.index-model-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.index-model-label {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  font-weight: 700;
}

.index-model-state {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
}

.index-model-ready {
  color: #166534;
  background: #dcfce7;
}

.index-model-busy {
  color: #1d4ed8;
  background: #dbeafe;
}

.index-model-failed {
  color: #9a3412;
  background: #ffedd5;
}

.index-model-idle {
  color: #334155;
  background: #e2e8f0;
}

.index-model-name {
  margin: 7px 0 0;
  font-size: 12px;
  color: #111827;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.index-model-meta {
  margin: 6px 0 0;
  font-size: 11px;
  color: #64748b;
}

.index-model-hint {
  margin: 5px 0 0;
  font-size: 11px;
  color: #64748b;
}

.ide-root.dark .index-model-label,
.ide-root.dark .index-model-meta,
.ide-root.dark .index-model-hint {
  color: #94a3b8;
}

.ide-root.dark .index-model-name {
  color: #f1f5f9;
}

.index-alert {
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.index-alert-error {
  border: 1px solid #fdba74;
  background: #fff7ed;
}

.index-alert-warning {
  border: 1px solid #fcd34d;
  background: #fffbeb;
}

.ide-root.dark .index-alert-error {
  border-color: #ea580c;
  background: rgba(124, 45, 18, 0.28);
}

.ide-root.dark .index-alert-warning {
  border-color: #ca8a04;
  background: rgba(113, 63, 18, 0.28);
}

.index-alert-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: #9a3412;
}

.index-alert-message {
  margin: 3px 0 0;
  font-size: 11px;
  color: #7c2d12;
}

.index-alert-action {
  white-space: nowrap;
}

.ide-root.dark .index-alert-title {
  color: #fed7aa;
}

.ide-root.dark .index-alert-message {
  color: #fdba74;
}

.index-status-sections {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.index-log-panel {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.86);
}

.ide-root.dark .index-log-panel {
  border-color: #3e4451;
  background: rgba(30, 41, 59, 0.72);
}

.index-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.index-log-filters {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.index-log-filter-btn {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #ffffff;
  color: #475569;
  padding: 3px 9px;
  font-size: 10px;
  line-height: 1.3;
}

.index-log-filter-btn.active {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #dbeafe;
}

.ide-root.dark .index-log-filter-btn {
  border-color: #475569;
  color: #cbd5e1;
  background: #1e293b;
}

.ide-root.dark .index-log-filter-btn.active {
  border-color: #60a5fa;
  color: #bfdbfe;
  background: #1e3a8a;
}

.index-log-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}

.ide-root.dark .index-log-title {
  color: #e2e8f0;
}

.index-log-empty {
  margin: 0;
  font-size: 11px;
  color: #64748b;
}

.index-log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 260px;
  margin-top: 8px;
  padding-right: 4px;
  overflow: auto;
}

.index-log-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px;
  align-items: start;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.72);
}

.index-log-row-running {
  border-color: #bfdbfe;
}

.index-log-row-error {
  border-color: #fdba74;
}

.ide-root.dark .index-log-row {
  border-color: #3e4451;
  background: rgba(30, 41, 59, 0.52);
}

.ide-root.dark .index-log-row-running {
  border-color: #2563eb;
}

.ide-root.dark .index-log-row-error {
  border-color: #ea580c;
}

.index-log-time {
  font-size: 10px;
  line-height: 1.2;
  color: #64748b;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.index-log-copy {
  min-width: 0;
}

.index-log-main {
  margin: 0;
  font-size: 11px;
  color: #1f2937;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.index-log-state-icon {
  width: 14px;
  text-align: center;
}

.index-log-path {
  margin: 2px 0 0;
  font-size: 11px;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.index-log-dir {
  color: #64748b;
}

.index-log-detail {
  margin: 2px 0 0;
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ide-root.dark .index-log-empty,
.ide-root.dark .index-log-time,
.ide-root.dark .index-log-detail {
  color: #94a3b8;
}

.ide-root.dark .index-log-path {
  color: #e2e8f0;
}

.ide-root.dark .index-log-dir {
  color: #94a3b8;
}

.ide-root.dark .index-log-main {
  color: #e2e8f0;
}

.index-stop-btn {
  border-color: #dc2626 !important;
  background: #fef2f2 !important;
  color: #b91c1c !important;
}

.ide-root.dark .index-stop-btn {
  border-color: #ef4444 !important;
  background: rgba(127, 29, 29, 0.36) !important;
  color: #fecaca !important;
}

@media (max-width: 980px) {
  .index-status-modal {
    width: min(760px, calc(100vw - 20px));
  }
  .index-overview-main {
    align-items: flex-start;
  }
  .index-alert {
    flex-direction: column;
  }
  .index-log-header {
    align-items: flex-start;
  }
  .index-log-list {
    height: 220px;
  }
  .index-log-row {
    grid-template-columns: 1fr;
  }
  .index-log-time {
    white-space: normal;
  }
}

.toast {
  position: fixed;
  right: 12px;
  bottom: 34px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  border: 1px solid transparent;
  z-index: 80;
}

.toast-error {
  border-color: #fda4af;
  background: #fff1f2;
  color: #9f1239;
}

.toast-success {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.toast-info {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1d4ed8;
}

.ide-root.dark .toast-error {
  border-color: #e06c75;
  background: #3b1e22;
  color: #e06c75;
}

.ide-root.dark .toast-success {
  border-color: #98c379;
  background: #1e3a22;
  color: #98c379;
}

.ide-root.dark .toast-info {
  border-color: #61afef;
  background: #1e2a3a;
  color: #61afef;
}

.toast-close {
  border: 0;
  background: transparent;
  color: currentColor;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.85;
}

.toast-close:hover {
  opacity: 1;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 60;
}

.modal {
  width: min(760px, calc(100vw - 32px));
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 6px;
  padding: 10px;
}

.ide-root.dark .modal {
  border-color: #3e4451;
  background: #282c34;
}

.shortcuts-modal {
  width: min(900px, calc(100vw - 32px));
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcuts-filter-input {
  flex: 0 0 auto;
}

.shortcuts-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  margin-top: 2px;
  overflow: auto;
  padding-right: 4px;
}

.shortcuts-section {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  min-width: 0;
}

.ide-root.dark .shortcuts-section {
  border-color: #3e4451;
}

.shortcuts-title {
  margin: 0 0 8px;
  font-size: 12px;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ide-root.dark .shortcuts-title {
  color: #5c6370;
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  align-items: start;
}

.shortcut-keys {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  color: #0f172a;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 3px 6px;
  white-space: nowrap;
}

.ide-root.dark .shortcut-keys {
  color: #abb2bf;
  background: #21252b;
  border-color: #3e4451;
}

.ide-root.dark .shortcut-action {
  color: #abb2bf;
}

.shortcut-action {
  font-size: 12px;
  color: #334155;
}

.ide-root.dark .shortcut-action {
  color: #cbd5e1;
}

.modal-list {
  margin-top: 8px;
  max-height: 360px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-item {
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 4px;
  padding: 6px;
  text-align: left;
  font-size: 12px;
}

.modal-item.active {
  border-color: #93c5fd;
  background: #dbeafe;
}

.ide-root.dark .modal-item {
  border-color: #3e4451;
  background: #21252b;
  color: #abb2bf;
}

.ide-root.dark .modal-item.active {
  border-color: #61afef;
  background: #2c313a;
}

.confirm-modal:not(.index-status-modal) {
  width: min(560px, calc(100vw - 32px));
}

.cosmos-command-loading-modal {
  width: min(460px, calc(100vw - 32px));
}

.settings-modal {
  width: min(960px, calc(100vw - 32px));
}

.settings-tabs {
  display: inline-flex;
  gap: 6px;
  margin: 2px 0 0;
}

.settings-tab-btn {
  border: 1px solid #cbd5e1;
  border-bottom-color: transparent;
  background: #f1f5f9;
  border-radius: 8px 8px 0 0;
  font-size: 12px;
  padding: 6px 10px;
  color: #334155;
}

.settings-tab-btn.active {
  border-color: #e2e8f0;
  border-bottom-color: #f8fafc;
  background: #f8fafc;
  color: #1e3a8a;
  position: relative;
  z-index: 1;
}

.settings-tab-panel {
  border: 1px solid #e2e8f0;
  border-top: 0;
  border-radius: 0 8px 8px 8px;
  padding: 12px;
  background: #f8fafc;
}

.settings-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ide-root.dark .settings-tab-btn {
  border-color: #3e4451;
  border-bottom-color: transparent;
  background: #21252b;
  color: #cbd5e1;
}

.ide-root.dark .settings-tab-btn.active {
  border-color: #61afef;
  border-bottom-color: rgba(30, 41, 59, 0.35);
  background: #1e3a5f;
  color: #dbeafe;
}

.ide-root.dark .settings-tab-panel {
  border-color: #3e4451;
  background: rgba(30, 41, 59, 0.35);
}

.cosmos-command-loading-track {
  margin-top: 6px;
  height: 8px;
  width: 100%;
  border-radius: 999px;
  overflow: hidden;
  background: #e2e8f0;
}

.ide-root.dark .cosmos-command-loading-track {
  background: #3e4451;
}

.cosmos-command-loading-bar {
  height: 100%;
  width: 42%;
  border-radius: 999px;
  background-image: linear-gradient(90deg, #2563eb 0%, #3b82f6 50%, #2563eb 100%);
  background-size: 200% 100%;
  animation: cosmos-command-loading-slide 1.05s linear infinite;
}

@keyframes cosmos-command-loading-slide {
  from {
    transform: translateX(-120%);
    background-position: 0% 0%;
  }
  to {
    transform: translateX(260%);
    background-position: 100% 0%;
  }
}

.confirm-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.ide-root.dark .confirm-title {
  color: #e5e7eb;
}

.ide-root.dark .confirm-text {
  color: #5c6370;
}

.ide-root.dark .modal-input-error {
  color: #e06c75;
}

.ide-root.dark .confirm-path {
  color: #abb2bf;
}

.confirm-text {
  margin: 10px 0 12px;
  font-size: 13px;
  color: #475569;
}

.modal-field-label {
  display: block;
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #475569;
}

.modal-field-hint {
  margin: 6px 0 10px;
  font-size: 11px;
  color: #475569;
}

.settings-model-group {
  margin: 0 0 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 8px;
  background: #f1f5f9;
}

.settings-model-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.settings-discover-btn {
  border: 0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #334155;
  background: #e2e8f0;
  cursor: pointer;
  white-space: nowrap;
}

.settings-discover-btn:hover:not(:disabled) {
  background: #cbd5e1;
}

.settings-discover-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.settings-footer {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.settings-config-path {
  margin: 0;
  font-size: 11px;
  color: #64748b;
}

.settings-footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-cancel-btn {
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}

.settings-cancel-btn:hover {
  color: #334155;
}

.ide-root.dark .confirm-text {
  color: #94a3b8;
}

.ide-root.dark .modal-field-label {
  color: #94a3b8;
}

.ide-root.dark .modal-field-hint {
  color: #94a3b8;
}

.ide-root.dark .settings-model-group {
  background: rgba(15, 23, 42, 0.45);
}

.ide-root.dark .settings-discover-btn {
  background: #2c313a;
  color: #cbd5e1;
}

.ide-root.dark .settings-discover-btn:hover:not(:disabled) {
  background: #3e4451;
}

.ide-root.dark .settings-config-path {
  color: #94a3b8;
}

.ide-root.dark .settings-cancel-btn {
  color: #94a3b8;
}

.ide-root.dark .settings-cancel-btn:hover {
  color: #cbd5e1;
}

.modal-input-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #b91c1c;
}

.ide-root.dark .modal-input-error {
  color: #fda4af;
}

.confirm-path {
  margin: 4px 0;
  font-size: 12px;
  color: #334155;
}

.ide-root.dark .confirm-path {
  color: #cbd5e1;
}

.confirm-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.placeholder {
  color: #64748b;
  font-size: 12px;
  padding: 6px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 980px) {
  .global-actions {
    gap: 4px;
    padding-right: 4px;
  }
}
</style>
