<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ComputerDesktopIcon,
  CommandLineIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SparklesIcon,
  ShareIcon,
  SunIcon
} from '@heroicons/vue/24/outline'
import EditorPaneGrid, { type EditorPaneGridExposed } from './components/panes/EditorPaneGrid.vue'
import MultiPaneToolbarMenu from './components/panes/MultiPaneToolbarMenu.vue'
import EditorRightPane from './components/EditorRightPane.vue'
import ExplorerTree from './components/explorer/ExplorerTree.vue'
import UiButton from './components/ui/UiButton.vue'
import { type DocumentHistoryEntry, useDocumentHistory } from './composables/useDocumentHistory'
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
  readAppSettings,
  revealInFileManager,
  setWorkingFolder,
  selectWorkingFolder,
  type AppSettingsView,
  type FileMetadata,
  type IndexLogEntry,
  type IndexRuntimeStatus,
  type SaveAppSettingsPayload,
  type WikilinkGraph,
  type WorkspaceFsChange,
  listenWorkspaceFsChanged,
  updateWikilinksForRename,
  writeAppSettings,
  writePropertyTypeSchema,
  writeTextFile
} from './lib/api'
import { parseSearchSnippet } from './lib/searchSnippets'
import { applySearchMode, detectSearchMode, type SearchMode } from './lib/searchMode'
import { hasActiveTextSelectionInEditor, shouldBlockGlobalShortcutsFromTarget } from './lib/shortcutTargets'
import { parseWikilinkTarget } from './lib/wikilinks'
import { buildCosmosGraph } from './lib/graphIndex'
import { useEditorState } from './composables/useEditorState'
import { useCosmosController } from './composables/useCosmosController'
import { useFilesystemState } from './composables/useFilesystemState'
import { useWorkspaceState, type SidebarMode } from './composables/useWorkspaceState'
import {
  createInitialLayout,
  hydrateLayout,
  serializeLayout,
  useMultiPaneWorkspaceState
} from './composables/useMultiPaneWorkspaceState'

type ThemePreference = 'light' | 'dark' | 'system'
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

type NavigateOptions = {
  recordHistory?: boolean
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

type CosmosHistorySnapshot = {
  query: string
  selectedNodeId: string
  focusMode: boolean
  focusDepth: number
}
type SecondBrainHistorySnapshot = {
  surface: 'chat'
}
type IndexRunKind = 'idle' | 'background' | 'rebuild' | 'rename'
type IndexRunPhase = 'idle' | 'indexing_files' | 'refreshing_views' | 'done' | 'error'
type SemanticIndexState = 'idle' | 'pending' | 'running' | 'error'
type IndexLogFilter = 'all' | 'errors' | 'slow'
type IndexActivityState = 'running' | 'done' | 'error'
type IndexActivityRow = {
  id: string
  ts: number
  timeLabel: string
  state: IndexActivityState
  group: 'file' | 'engine' | 'rebuild' | 'system'
  path: string
  directory: string
  fileName: string
  title: string
  detail: string
  durationMs: number | null
  chunks: number | null
  targets: number | null
  properties: number | null
  embeddingStatus: string
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
const isMacOs = typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent)

const themePreference = ref<ThemePreference>('system')
const searchQuery = ref('')
const searchHits = ref<SearchHit[]>([])
const searchLoading = ref(false)
const hasSearched = ref(false)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let searchRequestToken = 0
const quickOpenVisible = ref(false)
const quickOpenQuery = ref('')
const quickOpenActiveIndex = ref(0)
const searchInputRef = ref<HTMLInputElement | null>(null)
const leftPaneWidth = ref(290)
const rightPaneWidth = ref(300)
const allWorkspaceFiles = ref<string[]>([])
const loadingAllFiles = ref(false)
const editorRef = ref<EditorViewExposed | null>(null)
const explorerRef = ref<ExplorerTreeExposed | null>(null)
const overflowMenuRef = ref<HTMLElement | null>(null)
const backHistoryMenuRef = ref<HTMLElement | null>(null)
const forwardHistoryMenuRef = ref<HTMLElement | null>(null)
const backHistoryButtonRef = ref<HTMLElement | null>(null)
const forwardHistoryButtonRef = ref<HTMLElement | null>(null)
const backlinks = ref<string[]>([])
const backlinksLoading = ref(false)
const semanticLinks = ref<SemanticLinkRow[]>([])
const semanticLinksLoading = ref(false)
const activeFileMetadata = ref<FileMetadata | null>(null)
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
const settingsActiveTab = ref<'llm' | 'embeddings'>('llm')
const settingsConfigPath = ref('~/.tomosona/conf.json')
const settingsLlmProviderPreset = ref<'openai' | 'anthropic' | 'custom'>('openai')
const settingsLlmApiKey = ref('')
const settingsLlmHasStoredApiKey = ref(false)
const settingsLlmModel = ref('gpt-4.1')
const settingsLlmBaseUrl = ref('')
const settingsLlmCustomProvider = ref('openai')
const settingsLlmLabel = ref('OpenAI Remote')
const settingsEmbeddingsMode = ref<'internal' | 'external'>('internal')
const settingsEmbeddingsProvider = ref<'openai'>('openai')
const settingsEmbeddingsApiKey = ref('')
const settingsEmbeddingsHasStoredApiKey = ref(false)
const settingsEmbeddingsModel = ref('text-embedding-3-small')
const settingsEmbeddingsBaseUrl = ref('')
const settingsEmbeddingsLabel = ref('OpenAI Embeddings')
const settingsModalError = ref('')
const shortcutsModalVisible = ref(false)
const indexStatusModalVisible = ref(false)
const cosmosCommandLoadingVisible = ref(false)
const cosmosCommandLoadingLabel = ref('Loading graph...')
const secondBrainRequestedSessionId = ref('')
const secondBrainRequestedSessionNonce = ref(0)
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
let activeFileMetadataRequestToken = 0
const historyMenuOpen = ref<'back' | 'forward' | null>(null)
const historyMenuStyle = ref<Record<string, string>>({})
let historyMenuTimer: ReturnType<typeof setTimeout> | null = null
let historyLongPressTarget: 'back' | 'forward' | null = null
let cosmosHistoryDebounceTimer: ReturnType<typeof setTimeout> | null = null
let isApplyingHistoryNavigation = false
let unlistenWorkspaceFsChanged: (() => void) | null = null
let modalFocusReturnTarget: HTMLElement | null = null
let reindexWorkerRunning = false
let reindexGeneration = 0
const pendingReindexPaths = new Set<string>()
const pendingReindexCount = ref(0)
const pendingSemanticReindexAt = new Map<string, number>()
let semanticReindexTimer: ReturnType<typeof setTimeout> | null = null
let semanticReindexWorkerRunning = false
const semanticDebounceMs = 15_000
const semanticIndexState = ref<SemanticIndexState>('idle')
const indexRunKind = ref<IndexRunKind>('idle')
const indexRunPhase = ref<IndexRunPhase>('idle')
const indexRunCurrentPath = ref('')
const indexRunCompleted = ref(0)
const indexRunTotal = ref(0)
const indexFinalizeCompleted = ref(0)
const indexFinalizeTotal = ref(0)
const indexRunMessage = ref('')
const indexRunLastFinishedAt = ref<number | null>(null)
const indexStatusBusy = ref(false)
const indexRuntimeStatus = ref<IndexRuntimeStatus | null>(null)
const indexLogEntries = ref<IndexLogEntry[]>([])
const indexLogFilter = ref<IndexLogFilter>('all')
let indexStatusPollTimer: ReturnType<typeof setInterval> | null = null

const resizeState = ref<{
  side: 'left' | 'right'
  startX: number
  startWidth: number
} | null>(null)

const systemPrefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (themePreference.value === 'system') {
    return systemPrefersDark() ? 'dark' : 'light'
  }
  return themePreference.value
})

const paneCount = computed(() => Object.keys(multiPane.layout.value.panesById).length)
const activeFilePath = computed(() => multiPane.getActiveDocumentPath())
const activeStatus = computed(() => editorState.getStatus(activeFilePath.value))
const indexStateLabel = computed(() => {
  if (filesystem.indexingState.value === 'indexing') return 'reindexing'
  if (filesystem.indexingState.value === 'indexed') return 'indexed'
  return 'out of sync'
})
const indexStateClass = computed(() => {
  if (filesystem.indexingState.value === 'indexing') return 'status-item-indexing'
  if (filesystem.indexingState.value === 'indexed') return 'status-item-indexed'
  return 'status-item-out-of-sync'
})
const indexRunning = computed(() => filesystem.indexingState.value === 'indexing')
const indexProgressLabel = computed(() => {
  if (!indexRunning.value) return indexStateLabel.value
  if (indexRunKind.value === 'background') {
    if (indexRunPhase.value === 'refreshing_views') {
      const total = Math.max(1, indexFinalizeTotal.value)
      const completed = Math.min(indexFinalizeCompleted.value, total)
      return `finalizing ${completed}/${total}`
    }
    const total = Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value)
    if (total <= 0) return 'processing queued files'
    return `${indexRunCompleted.value}/${total} files`
  }
  if (indexRunKind.value === 'rebuild') {
    if (indexRunPhase.value === 'refreshing_views') {
      const total = Math.max(1, indexFinalizeTotal.value)
      const completed = Math.min(indexFinalizeCompleted.value, total)
      return `finalizing ${completed}/${total}`
    }
    return 'rebuilding workspace index'
  }
  if (indexRunKind.value === 'rename') {
    if (indexRunPhase.value === 'refreshing_views') {
      const total = Math.max(1, indexFinalizeTotal.value)
      const completed = Math.min(indexFinalizeCompleted.value, total)
      return `finalizing ${completed}/${total}`
    }
    return 'rewriting wikilinks'
  }
  return 'indexing'
})
const indexActionLabel = computed(() => (indexRunning.value ? 'Stop' : 'Rebuild index'))
const indexModelStatusLabel = computed(() => {
  const status = indexRuntimeStatus.value
  if (!status) return 'unknown'
  if (status.model_state === 'ready') return 'ready'
  if (status.model_state === 'initializing') return 'initializing'
  if (status.model_state === 'failed') return 'failed'
  if (status.model_state === 'not_initialized') return 'not initialized'
  return status.model_state
})
const indexStatusBadgeLabel = computed(() => {
  if (indexRunPhase.value === 'error' || filesystem.indexingState.value === 'out_of_sync') return 'Needs attention'
  if (indexRunning.value) return 'Reindexing'
  if (semanticIndexState.value === 'running') return 'Semantic sync'
  if (semanticIndexState.value === 'pending') return 'Semantic pending'
  if (semanticIndexState.value === 'error') return 'Semantic warning'
  return 'Ready'
})
const indexStatusBadgeClass = computed(() => {
  if (indexRunPhase.value === 'error' || filesystem.indexingState.value === 'out_of_sync') return 'index-badge-error'
  if (indexRunning.value) return 'index-badge-running'
  if (semanticIndexState.value === 'error') return 'index-badge-error'
  if (semanticIndexState.value === 'pending' || semanticIndexState.value === 'running') return 'index-badge-running'
  return 'index-badge-ready'
})
const indexProgressTotal = computed(() => {
  if (indexRunKind.value === 'background') {
    return Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value)
  }
  return Math.max(indexRunTotal.value, indexRunCompleted.value)
})
const indexProgressCurrent = computed(() => {
  const total = indexProgressTotal.value
  if (total <= 0) return 0
  return Math.min(indexRunCompleted.value, total)
})
const indexProgressPercent = computed(() => {
  if (indexRunning.value) {
    if (indexRunPhase.value === 'refreshing_views') {
      const finalizeTotal = Math.max(1, indexFinalizeTotal.value)
      const finalizeCurrent = Math.min(indexFinalizeCompleted.value, finalizeTotal)
      const finalizePercent = Math.round((finalizeCurrent / finalizeTotal) * 15)
      return Math.min(99, 85 + Math.max(0, finalizePercent))
    }
    const total = indexProgressTotal.value
    if (total <= 0) return 8
    return Math.min(85, Math.max(0, Math.round((indexProgressCurrent.value / total) * 85)))
  }
  return filesystem.indexingState.value === 'indexed' ? 100 : 0
})
const indexProgressSummary = computed(() => {
  if (!indexRunning.value) {
    if (filesystem.indexingState.value === 'out_of_sync') return 'Pending reindex'
    if (semanticIndexState.value === 'pending') return 'Semantic index pending'
    if (semanticIndexState.value === 'running') return 'Semantic index syncing'
    if (semanticIndexState.value === 'error') return 'Semantic index warning'
    return indexRunLastFinishedAt.value ? `Last run ${formatTimestamp(indexRunLastFinishedAt.value)}` : ''
  }
  if (indexRunPhase.value === 'refreshing_views') {
    const total = Math.max(1, indexFinalizeTotal.value)
    const completed = Math.min(indexFinalizeCompleted.value, total)
    return `Finalizing ${completed}/${total} tasks`
  }
  const total = indexProgressTotal.value
  if (total <= 0) return indexProgressLabel.value
  return `${indexProgressCurrent.value}/${total} files`
})
const indexShowProgressBar = computed(() => indexRunning.value)
const indexModelStateClass = computed(() => {
  if (indexModelStatusLabel.value === 'ready') return 'index-model-ready'
  if (indexModelStatusLabel.value === 'initializing') return 'index-model-busy'
  if (indexModelStatusLabel.value === 'failed') return 'index-model-failed'
  return 'index-model-idle'
})
const indexShowWarmupNote = computed(() => {
  const status = indexRuntimeStatus.value
  if (!status) return false
  return status.model_init_attempts <= 1 && status.model_state !== 'ready'
})
const indexAlert = computed(() => {
  if (indexRunPhase.value === 'error') {
    return {
      level: 'error',
      title: 'Index run interrupted',
      message: indexRunMessage.value || 'An indexing step failed. You can retry a full rebuild.'
    } as const
  }
  if (filesystem.indexingState.value === 'out_of_sync') {
    return {
      level: 'warning',
      title: 'Workspace changed',
      message: 'Some files are not indexed yet. Run a rebuild to sync search and semantic links.'
    } as const
  }
  if (semanticIndexState.value === 'error') {
    return {
      level: 'warning',
      title: 'Semantic indexing warning',
      message: 'Lexical index is up to date, but semantic vectors need attention.'
    } as const
  }
  return null
})
const indexActivityRows = computed(() => buildIndexActivityRows(indexLogEntries.value))
const filteredIndexActivityRows = computed(() => {
  if (indexLogFilter.value === 'all') return indexActivityRows.value
  if (indexLogFilter.value === 'errors') {
    return indexActivityRows.value.filter((row) => row.state === 'error')
  }
  return indexActivityRows.value.filter((row) => (row.durationMs ?? 0) > 1000)
})
const indexErrorCount = computed(() => indexActivityRows.value.filter((row) => row.state === 'error').length)
const indexSlowCount = computed(() => indexActivityRows.value.filter((row) => (row.durationMs ?? 0) > 1000).length)
const cosmos = useCosmosController({
  workingFolderPath: filesystem.workingFolderPath,
  activeTabPath: activeFilePath,
  getWikilinkGraph,
  reindexMarkdownFile: reindexMarkdownFileLexical,
  readTextFile: async (path: string) => await readTextFile(path),
  ftsSearch,
  buildCosmosGraph
})

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

type QuickOpenResult =
  | { kind: 'file'; path: string; label: string }
  | { kind: 'daily'; date: string; path: string; label: string; exists: boolean }

type PaletteAction = {
  id: string
  label: string
  run: () => boolean | Promise<boolean>
  closeBeforeRun?: boolean
  loadingLabel?: string
}

const SECOND_BRAIN_TAB_PATH = '__tomosona_second_brain_view__'

const paletteActionPriority: Record<string, number> = {
  'open-file': 0,
  'open-workspace': 1,
  'open-today': 2,
  'open-yesterday': 3,
  'open-specific-date': 4,
  'open-cosmos-view': 5,
  'open-second-brain-view': 6,
  'open-settings': 7,
  'open-note-in-cosmos': 8,
  'reveal-in-explorer': 9,
  'show-shortcuts': 10,
  'create-new-file': 11,
  'close-other-tabs': 12,
  'close-all-tabs': 13,
  'close-all-tabs-current-pane': 14,
  'split-pane-right': 15,
  'split-pane-down': 16,
  'focus-pane-1': 17,
  'focus-pane-2': 18,
  'focus-pane-3': 19,
  'focus-pane-4': 20,
  'focus-next-pane': 21,
  'move-tab-next-pane': 22,
  'close-active-pane': 23,
  'join-panes': 24,
  'reset-pane-layout': 25,
  'zoom-in': 26,
  'zoom-out': 27,
  'zoom-reset': 28,
  'theme-light': 29,
  'theme-dark': 30,
  'theme-system': 31,
  'close-workspace': 32
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

const quickOpenIsActionMode = computed(() => quickOpenQuery.value.trimStart().startsWith('>'))
const quickOpenActionQuery = computed(() => quickOpenQuery.value.trimStart().slice(1).trim().toLowerCase())

const quickOpenResults = computed<QuickOpenResult[]>(() => {
  if (quickOpenIsActionMode.value) return []
  const q = quickOpenQuery.value.trim().toLowerCase()
  if (!q) return []

  const fileResults = allWorkspaceFiles.value
    .filter((path) => path.toLowerCase().includes(q) || toRelativePath(path).toLowerCase().includes(q))
    .map((path) => ({ kind: 'file' as const, path, label: toRelativePath(path) }))
    .slice(0, 80)

  if (!isIsoDate(q) || !filesystem.workingFolderPath.value) {
    return fileResults
  }

  const path = dailyNotePath(filesystem.workingFolderPath.value, q)
  const exists = allWorkspaceFiles.value.some((item) => item.toLowerCase() === path.toLowerCase())
  const dateResult: QuickOpenResult = {
    kind: 'daily',
    date: q,
    path,
    exists,
    label: exists ? `Open daily note ${q}` : `Create daily note ${q}`
  }

  return [dateResult, ...fileResults]
})

const quickOpenActionResults = computed(() => {
  if (!quickOpenIsActionMode.value) return []
  const q = quickOpenActionQuery.value
  const withRank = paletteActions.value
    .map((item) => {
      const label = item.label.toLowerCase()
      const matchRank = !q
        ? 0
        : label === q
          ? 0
          : label.startsWith(q)
            ? 1
            : label.includes(q)
              ? 2
              : 99
      const priority = paletteActionPriority[item.id] ?? Number.MAX_SAFE_INTEGER
      return { item, matchRank, priority, label }
    })
    .filter((entry) => entry.matchRank < 99)
    .sort((left, right) =>
      left.matchRank - right.matchRank ||
      left.priority - right.priority ||
      left.label.localeCompare(right.label)
    )

  return withRank.map((entry) => entry.item)
})

const quickOpenItemCount = computed(() =>
  quickOpenIsActionMode.value ? quickOpenActionResults.value.length : quickOpenResults.value.length
)

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

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN_FILE_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g
const FORBIDDEN_FILE_NAME_CHARS_RE = /[<>:"\\|?*\u0000-\u001f]/
const MAX_FILE_STEM_LENGTH = 120

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function applyTheme() {
  const root = document.documentElement
  root.classList.toggle('dark', resolvedTheme.value === 'dark')
}

function loadThemePreference() {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    themePreference.value = saved
  } else {
    themePreference.value = 'system'
  }
}

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

function toRelativePath(path: string): string {
  const root = filesystem.workingFolderPath.value
  if (!root) return path
  if (path === root) return '.'
  if (path.startsWith(`${root}/`)) {
    return path.slice(root.length + 1)
  }
  return path
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function normalizePathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function upsertWorkspaceFilePath(path: string) {
  if (!isMarkdownPath(path)) return
  const normalized = normalizePathKey(path)
  const exists = allWorkspaceFiles.value.some((item) => normalizePathKey(item) === normalized)
  if (exists) return
  allWorkspaceFiles.value = [...allWorkspaceFiles.value, path].sort((a, b) => a.localeCompare(b))
}

function removeWorkspaceFilePath(path: string) {
  const normalized = normalizePathKey(path)
  const normalizedPrefix = `${normalized}/`
  allWorkspaceFiles.value = allWorkspaceFiles.value.filter((item) => {
    const candidate = normalizePathKey(item)
    return candidate !== normalized && !candidate.startsWith(normalizedPrefix)
  })
}

function replaceWorkspaceFilePath(oldPath: string, newPath: string) {
  if (!oldPath || !newPath) return
  const oldNormalized = normalizePath(oldPath)
  const newNormalized = normalizePath(newPath)
  const oldKey = oldNormalized.toLowerCase()
  const newKey = newNormalized.toLowerCase()
  if (oldKey === newKey) return

  const next = allWorkspaceFiles.value.map((entry) => {
    const entryNormalized = normalizePath(entry)
    const entryKey = entryNormalized.toLowerCase()
    if (entryKey === oldKey) {
      return `${newNormalized}${entryNormalized.slice(oldNormalized.length)}`
    }
    if (entryKey.startsWith(`${oldKey}/`)) {
      return `${newNormalized}${entryNormalized.slice(oldNormalized.length)}`
    }
    return entry
  })
  allWorkspaceFiles.value = Array.from(new Set(next)).sort((a, b) => a.localeCompare(b))
}

function markIndexOutOfSync() {
  if (filesystem.indexingState.value !== 'indexing') {
    filesystem.indexingState.value = 'out_of_sync'
  }
}

function updatePendingReindexCount() {
  pendingReindexCount.value = pendingReindexPaths.size
}

function parseIndexLogFields(message: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of message.split(/\s+/)) {
    const equals = token.indexOf('=')
    if (equals <= 0 || equals >= token.length - 1) continue
    const key = token.slice(0, equals).trim()
    const value = token.slice(equals + 1).trim()
    if (!key || !value) continue
    out[key] = value
  }
  return out
}

function toNumberOrNull(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function formatTimeOnly(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return `${normalizeDatePart(date.getHours())}:${normalizeDatePart(date.getMinutes())}:${normalizeDatePart(date.getSeconds())}`
}

function formatDurationMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return ''
  const durationMs = Math.max(0, Math.round(value))
  if (durationMs < 1000) return `${durationMs} ms`
  const seconds = durationMs / 1000
  if (seconds < 60) {
    const precision = seconds < 10 ? 1 : 0
    return `${seconds.toFixed(precision)} s`
  }
  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainderSeconds = totalSeconds % 60
  if (hours > 0) {
    if (remainderSeconds > 0) return `${hours} h ${minutes} min ${remainderSeconds} s`
    if (minutes > 0) return `${hours} h ${minutes} min`
    return `${hours} h`
  }
  if (remainderSeconds > 0) return `${minutes} min ${remainderSeconds} s`
  return `${minutes} min`
}

function formatSearchScore(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(3)
}

function splitRelativePath(path: string): { directory: string; fileName: string } {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) {
    return { directory: '', fileName: normalized }
  }
  return {
    directory: normalized.slice(0, lastSlash),
    fileName: normalized.slice(lastSlash + 1)
  }
}

function buildIndexActivityRows(entries: IndexLogEntry[]): IndexActivityRow[] {
  const sorted = entries.slice().sort((left, right) => left.ts_ms - right.ts_ms)
  const rows: IndexActivityRow[] = []
  const activeByPath = new Map<string, { startedAt: number; path: string }>()

  for (const entry of sorted) {
    const message = entry.message.trim()
    const fields = parseIndexLogFields(message)
    const resolvedPath = fields.path ? toRelativePath(fields.path) : ''
    const split = splitRelativePath(resolvedPath)
    const base = {
      ts: entry.ts_ms,
      timeLabel: formatTimeOnly(entry.ts_ms),
      path: resolvedPath,
      directory: split.directory,
      fileName: split.fileName,
      chunks: toNumberOrNull(fields.chunks),
      targets: toNumberOrNull(fields.targets),
      properties: toNumberOrNull(fields.properties),
      durationMs: toNumberOrNull(fields.total_ms) ?? toNumberOrNull(fields.embedding_ms),
      embeddingStatus: fields.embedding ?? ''
    }

    if (message.startsWith('reindex:start') && resolvedPath) {
      activeByPath.set(resolvedPath, { startedAt: entry.ts_ms, path: resolvedPath })
      continue
    }

    if (message.startsWith('reindex:done') && resolvedPath) {
      const run = activeByPath.get(resolvedPath)
      const stats: string[] = []
      if (base.chunks != null) stats.push(`🧩 ${base.chunks}`)
      if (base.targets != null) stats.push(`🎯 ${base.targets}`)
      if (base.properties != null) stats.push(`🏷️ ${base.properties}`)
      if (base.embeddingStatus) stats.push(`embed ${base.embeddingStatus}`)
      const durationLabel = formatDurationMs(base.durationMs)
      if (durationLabel) stats.push(durationLabel)
      const failedEmbedding = base.embeddingStatus.includes('failed')
      rows.push({
        id: `done-${resolvedPath}-${entry.ts_ms}`,
        state: failedEmbedding ? 'error' : 'done',
        group: 'file',
        title: run ? 'Indexed file' : 'File index update',
        detail: stats.join(' · '),
        ...base
      })
      activeByPath.delete(resolvedPath)
      continue
    }

    if (message.startsWith('rebuild:done')) {
      const indexed = fields.indexed ?? '?'
      rows.push({
        id: `rebuild-done-${entry.ts_ms}`,
        state: 'done',
        group: 'rebuild',
        title: `Workspace rebuild done (${indexed} indexed)`,
        detail: formatDurationMs(base.durationMs),
        ...base
      })
      continue
    }

    if (message.startsWith('rebuild:start')) {
      rows.push({
        id: `rebuild-start-${entry.ts_ms}`,
        state: 'running',
        group: 'rebuild',
        title: 'Workspace rebuild started',
        detail: '',
        ...base
      })
      continue
    }

    const isError = message.includes('failed') || message.includes(':error') || message.includes('unavailable')
    if (isError) {
      rows.push({
        id: `err-${entry.ts_ms}`,
        state: 'error',
        group: message.includes('reindex:') ? 'engine' : 'system',
        title: message.startsWith('reindex:')
          ? 'Indexing warning'
          : message.startsWith('model:')
            ? 'Model warning'
            : 'Indexer error',
        detail: message,
        ...base
      })
      continue
    }
  }

  for (const run of activeByPath.values()) {
    const split = splitRelativePath(run.path)
    rows.push({
      id: `running-${run.path}-${run.startedAt}`,
      ts: run.startedAt,
      timeLabel: formatTimeOnly(run.startedAt),
      state: 'running',
      group: 'file',
      path: run.path,
      directory: split.directory,
      fileName: split.fileName,
      title: 'Processing file',
      detail: '',
      durationMs: null,
      chunks: null,
      targets: null,
      properties: null,
      embeddingStatus: ''
    })
  }

  return rows.sort((left, right) => right.ts - left.ts).slice(0, 120)
}

function stopIndexStatusPolling() {
  if (indexStatusPollTimer) {
    clearInterval(indexStatusPollTimer)
    indexStatusPollTimer = null
  }
}

function startIndexStatusPolling() {
  stopIndexStatusPolling()
  indexStatusPollTimer = setInterval(() => {
    if (!indexStatusModalVisible.value) return
    void refreshIndexModalData()
  }, 900)
}

function openIndexStatusModal() {
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  indexStatusModalVisible.value = true
  void refreshIndexModalData()
  startIndexStatusPolling()
}

function closeIndexStatusModal() {
  indexStatusModalVisible.value = false
  stopIndexStatusPolling()
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function refreshIndexLogs() {
  if (!filesystem.hasWorkspace.value) {
    indexLogEntries.value = []
    return
  }
  try {
    indexLogEntries.value = await readIndexLogs(160)
  } catch {
    indexLogEntries.value = []
  }
}

async function refreshIndexRuntimeStatus() {
  if (!filesystem.hasWorkspace.value) return
  try {
    indexRuntimeStatus.value = await readIndexRuntimeStatus()
  } catch {
    indexRuntimeStatus.value = null
  }
}

async function refreshIndexModalData() {
  await Promise.all([refreshIndexRuntimeStatus(), refreshIndexLogs()])
}

async function stopCurrentIndexOperation() {
  if (!indexRunning.value) return
  if (indexRunKind.value === 'background') {
    reindexGeneration += 1
    pendingReindexPaths.clear()
    updatePendingReindexCount()
    pendingSemanticReindexAt.clear()
    if (semanticReindexTimer) {
      clearTimeout(semanticReindexTimer)
      semanticReindexTimer = null
    }
    semanticIndexState.value = 'idle'
    reindexWorkerRunning = false
    filesystem.indexingState.value = 'out_of_sync'
    indexRunPhase.value = 'error'
    indexRunMessage.value = 'Stopped by user.'
    return
  }
  try {
    await requestIndexCancel()
    indexRunMessage.value = 'Stop requested. Waiting for backend to stop...'
  } catch {
    indexRunMessage.value = 'Could not request stop.'
  }
}

async function onIndexPrimaryAction() {
  if (indexStatusBusy.value) return
  indexStatusBusy.value = true
  try {
    if (indexRunning.value) {
      if (typeof window !== 'undefined' && !window.confirm('Cancel current indexing run?')) return
      await stopCurrentIndexOperation()
    } else {
      await rebuildIndexFromOverflow()
    }
    await refreshIndexModalData()
  } finally {
    indexStatusBusy.value = false
  }
}

function enqueueMarkdownReindex(path: string) {
  if (!filesystem.workingFolderPath.value || !isMarkdownPath(path)) return
  pendingReindexPaths.add(path)
  updatePendingReindexCount()
  if (filesystem.indexingState.value !== 'indexing') {
    filesystem.indexingState.value = 'out_of_sync'
  }
  if (indexRunKind.value !== 'background' || indexRunPhase.value === 'idle') {
    indexRunKind.value = 'background'
    indexRunPhase.value = 'idle'
    indexRunCompleted.value = 0
    indexRunTotal.value = Math.max(1, pendingReindexCount.value)
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 0
    indexRunCurrentPath.value = ''
    indexRunMessage.value = ''
  } else {
    indexRunTotal.value = Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value)
  }
  pendingSemanticReindexAt.set(path, Date.now() + semanticDebounceMs)
  if (semanticIndexState.value !== 'running') {
    semanticIndexState.value = 'pending'
  }
  scheduleSemanticReindexTimer()
  void runReindexWorker()
}

function scheduleSemanticReindexTimer() {
  if (semanticReindexTimer) {
    clearTimeout(semanticReindexTimer)
    semanticReindexTimer = null
  }
  if (!pendingSemanticReindexAt.size) {
    if (!semanticReindexWorkerRunning && semanticIndexState.value !== 'error') {
      semanticIndexState.value = 'idle'
    }
    return
  }
  const now = Date.now()
  let nextDue = Number.POSITIVE_INFINITY
  for (const dueAt of pendingSemanticReindexAt.values()) {
    nextDue = Math.min(nextDue, dueAt)
  }
  const delay = Math.max(20, Math.min(semanticDebounceMs, nextDue - now))
  semanticReindexTimer = setTimeout(() => {
    semanticReindexTimer = null
    void runSemanticReindexWorker()
  }, delay)
}

async function runSemanticReindexWorker() {
  if (semanticReindexWorkerRunning) return
  if (!filesystem.workingFolderPath.value) return
  semanticReindexWorkerRunning = true
  semanticIndexState.value = 'running'
  try {
    while (pendingSemanticReindexAt.size > 0) {
      const now = Date.now()
      const duePaths = Array.from(pendingSemanticReindexAt.entries())
        .filter(([, dueAt]) => dueAt <= now)
        .map(([path]) => path)

      if (!duePaths.length) {
        semanticIndexState.value = 'pending'
        scheduleSemanticReindexTimer()
        return
      }

      let hadSemanticError = false
      let updated = 0
      for (const path of duePaths) {
        pendingSemanticReindexAt.delete(path)
        try {
          await reindexMarkdownFileSemantic(path)
          updated += 1
        } catch {
          hadSemanticError = true
          console.warn('[index] semantic:file:error', { path })
        }
      }
      if (updated > 0) {
        try {
          await refreshSemanticEdgesCacheNow()
          // Refresh visible consumers once per semantic batch to avoid stale panels.
          await refreshBacklinks()
          if (multiPane.findPaneContainingSurface('cosmos') !== null) {
            await cosmos.refreshGraph()
          }
        } catch {
          hadSemanticError = true
          console.warn('[index] semantic:refresh:error')
        }
      }
      if (hadSemanticError) {
        semanticIndexState.value = 'error'
      } else if (pendingSemanticReindexAt.size > 0) {
        semanticIndexState.value = 'pending'
      } else {
        semanticIndexState.value = 'idle'
      }
    }
  } finally {
    semanticReindexWorkerRunning = false
    if (pendingSemanticReindexAt.size > 0) {
      if (semanticIndexState.value !== 'error') {
        semanticIndexState.value = 'pending'
      }
      scheduleSemanticReindexTimer()
    } else if (semanticIndexState.value !== 'error') {
      semanticIndexState.value = 'idle'
    }
  }
}

async function runReindexWorker() {
  if (reindexWorkerRunning) return
  if (!filesystem.workingFolderPath.value) return
  const generationAtStart = reindexGeneration
  reindexWorkerRunning = true
  console.info('[index] background:worker:start', { queued: pendingReindexCount.value })
  indexRunKind.value = 'background'
  indexRunPhase.value = 'indexing_files'
  indexRunCompleted.value = 0
  indexRunTotal.value = Math.max(1, pendingReindexCount.value)
  indexFinalizeCompleted.value = 0
  indexFinalizeTotal.value = 0
  indexRunCurrentPath.value = ''
  indexRunMessage.value = ''
  filesystem.indexingState.value = 'indexing'
  try {
    while (pendingReindexPaths.size > 0) {
      if (reindexGeneration !== generationAtStart) {
        pendingReindexPaths.clear()
        updatePendingReindexCount()
        return
      }
      const [nextPath] = pendingReindexPaths
      if (!nextPath) break
      pendingReindexPaths.delete(nextPath)
      updatePendingReindexCount()
      indexRunCurrentPath.value = nextPath
      indexRunTotal.value = Math.max(indexRunTotal.value, indexRunCompleted.value + pendingReindexCount.value + 1)
      try {
        await reindexMarkdownFileLexical(nextPath)
      } catch {
        filesystem.indexingState.value = 'out_of_sync'
        indexRunPhase.value = 'error'
        indexRunMessage.value = `Failed to reindex ${toRelativePath(nextPath)}.`
        console.warn('[index] background:file:error', { path: nextPath })
      }
      indexRunCompleted.value += 1
      indexRunCurrentPath.value = ''
    }
  } finally {
    reindexWorkerRunning = false
    if (reindexGeneration !== generationAtStart) {
      return
    }
    if (pendingReindexPaths.size > 0) {
      filesystem.indexingState.value = 'out_of_sync'
      console.info('[index] background:worker:restart', { queued: pendingReindexPaths.size })
      void runReindexWorker()
      return
    }
    indexRunPhase.value = 'refreshing_views'
    indexRunCurrentPath.value = ''
    indexFinalizeCompleted.value = 0
    const hasCosmosSurface = multiPane.findPaneContainingSurface('cosmos') !== null
    indexFinalizeTotal.value = hasCosmosSurface ? 2 : 1
    await refreshBacklinks()
    indexFinalizeCompleted.value = 1
    if (hasCosmosSurface) {
      await cosmos.refreshGraph()
      indexFinalizeCompleted.value = 2
    }
    if (filesystem.indexingState.value !== 'out_of_sync') {
      filesystem.indexingState.value = 'indexed'
      indexRunPhase.value = 'done'
      indexRunMessage.value = ''
      indexRunLastFinishedAt.value = Date.now()
      console.info('[index] background:worker:done', {
        indexed: indexRunCompleted.value,
        total: indexRunTotal.value
      })
      setTimeout(() => {
        if (indexRunKind.value === 'background' && indexRunPhase.value === 'done' && pendingReindexCount.value === 0) {
          indexRunKind.value = 'idle'
          indexRunPhase.value = 'idle'
        }
      }, 600)
    } else {
      indexRunPhase.value = 'error'
      console.warn('[index] background:worker:out_of_sync')
    }
  }
}

function removeMarkdownFromIndexInBackground(path: string) {
  pendingSemanticReindexAt.delete(path)
  scheduleSemanticReindexTimer()
  void removeMarkdownFileFromIndex(path).then(() => {
    console.info('[index] background:remove:done', { path })
    if (multiPane.findPaneContainingSurface('cosmos') !== null) {
      void cosmos.refreshGraph()
    }
    void refreshBacklinks()
  }).catch((err) => {
    console.warn('[index] background:remove:error', {
      path,
      reason: err instanceof Error ? err.message : String(err)
    })
    markIndexOutOfSync()
  })
}

function applyWorkspaceFsChanges(changes: WorkspaceFsChange[]) {
  if (!changes.length) return
  const activePath = activeFilePath.value
  const activePathKey = activePath ? normalizePathKey(activePath) : ''
  let shouldRefreshActiveMetadata = false
  let shouldRefreshCosmos = false
  for (const change of changes) {
    if (change.kind === 'removed' && change.path) {
      removeWorkspaceFilePath(change.path)
      if (isMarkdownPath(change.path)) {
        shouldRefreshCosmos = true
        removeMarkdownFromIndexInBackground(change.path)
      }
      if (activePathKey && normalizePathKey(change.path) === activePathKey) {
        activeFileMetadata.value = null
      }
      continue
    }
    if (change.kind === 'renamed') {
      if (change.old_path && change.new_path) {
        replaceWorkspaceFilePath(change.old_path, change.new_path)
        if (isMarkdownPath(change.old_path) || isMarkdownPath(change.new_path)) {
          shouldRefreshCosmos = true
          if (isMarkdownPath(change.old_path)) {
            removeMarkdownFromIndexInBackground(change.old_path)
          }
          if (isMarkdownPath(change.new_path)) {
            enqueueMarkdownReindex(change.new_path)
          }
        }
      } else if (change.old_path) {
        removeWorkspaceFilePath(change.old_path)
        if (isMarkdownPath(change.old_path)) {
          shouldRefreshCosmos = true
          removeMarkdownFromIndexInBackground(change.old_path)
        }
      } else if (!change.is_dir && change.new_path) {
        upsertWorkspaceFilePath(change.new_path)
        if (isMarkdownPath(change.new_path)) {
          shouldRefreshCosmos = true
          enqueueMarkdownReindex(change.new_path)
        }
      }
      if (
        activePathKey &&
        ((change.old_path && normalizePathKey(change.old_path) === activePathKey) ||
          (change.new_path && normalizePathKey(change.new_path) === activePathKey))
      ) {
        shouldRefreshActiveMetadata = true
      }
      continue
    }
    if ((change.kind === 'created' || change.kind === 'modified') && !change.is_dir && change.path) {
      upsertWorkspaceFilePath(change.path)
      if (isMarkdownPath(change.path)) {
        shouldRefreshCosmos = true
        enqueueMarkdownReindex(change.path)
      }
      if (activePathKey && normalizePathKey(change.path) === activePathKey) {
        shouldRefreshActiveMetadata = true
      }
    }
  }
  if (shouldRefreshActiveMetadata && activePath) {
    void refreshActiveFileMetadata(activePath)
  }
  if (shouldRefreshCosmos && multiPane.findPaneContainingSurface('cosmos') !== null) {
    void cosmos.refreshGraph()
  }
}

function normalizeDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const value = new Date(year, month - 1, day)
  return value.getFullYear() === year && value.getMonth() + 1 === month && value.getDate() === day
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${normalizeDatePart(date.getMonth() + 1)}-${normalizeDatePart(date.getDate())}`
}

function formatTimestamp(value: number | null): string {
  if (!Number.isFinite(value) || value == null || value < 0) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return `${date.getFullYear()}-${normalizeDatePart(date.getMonth() + 1)}-${normalizeDatePart(date.getDate())} ${normalizeDatePart(date.getHours())}:${normalizeDatePart(date.getMinutes())}:${normalizeDatePart(date.getSeconds())}`
}

async function refreshActiveFileMetadata(path: string | null = activeFilePath.value) {
  const targetPath = path?.trim() || ''
  const requestToken = ++activeFileMetadataRequestToken
  if (!targetPath) {
    activeFileMetadata.value = null
    return
  }
  try {
    const next = await readFileMetadata(targetPath)
    if (requestToken === activeFileMetadataRequestToken && activeFilePath.value === targetPath) {
      activeFileMetadata.value = next
    }
  } catch {
    if (requestToken === activeFileMetadataRequestToken && activeFilePath.value === targetPath) {
      activeFileMetadata.value = null
    }
  }
}

function isIsoDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false
  const [yearRaw, monthRaw, dayRaw] = input.split('-')
  const year = Number.parseInt(yearRaw, 10)
  const month = Number.parseInt(monthRaw, 10)
  const day = Number.parseInt(dayRaw, 10)
  return isValidCalendarDate(year, month, day)
}

function parseIsoDateInput(input: string): string | null {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!isValidCalendarDate(year, month, day)) return null
  return `${year}-${normalizeDatePart(month)}-${normalizeDatePart(day)}`
}

function dailyNotePath(root: string, date: string): string {
  return `${root}/journal/${date}.md`
}

function sanitizeRelativePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function normalizeRelativeNotePath(raw: string): string | null {
  const cleaned = raw.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!cleaned) return null

  const stack: string[] = []
  const segments = cleaned.split('/')
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) {
        return null
      }
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  if (!stack.length) return null
  return stack.join('/')
}

function isTitleOnlyContent(content: string, titleLine: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return normalized === titleLine
}

function onSystemThemeChanged() {
  if (themePreference.value === 'system') {
    applyTheme()
  }
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
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
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

function historyTargetLabel(entry: DocumentHistoryEntry): string {
  if (entry.kind === 'cosmos') return entry.label
  if (entry.kind === 'second-brain') return entry.label || 'Second Brain'
  return toRelativePath(entry.path)
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

function recordSecondBrainHistorySnapshot() {
  if (isApplyingHistoryNavigation) return
  const active = multiPane.getActiveTab()
  if (!active || active.type !== 'second-brain-chat') return
  const snapshot = currentSecondBrainHistorySnapshot()
  documentHistory.recordEntry({
    kind: 'second-brain',
    path: SECOND_BRAIN_TAB_PATH,
    label: secondBrainHistoryLabel(snapshot),
    stateKey: secondBrainSnapshotStateKey(snapshot),
    payload: snapshot
  })
}

function recordCosmosHistorySnapshot() {
  if (isApplyingHistoryNavigation) return
  const active = multiPane.getActiveTab()
  if (!active || active.type !== 'cosmos') return
  const snapshot = currentCosmosHistorySnapshot()
  documentHistory.recordEntry({
    kind: 'cosmos',
    path: 'cosmos',
    label: cosmosHistoryLabel(snapshot),
    stateKey: cosmosSnapshotStateKey(snapshot),
    payload: snapshot
  })
}

function scheduleCosmosHistorySnapshot() {
  if (cosmosHistoryDebounceTimer) {
    clearTimeout(cosmosHistoryDebounceTimer)
    cosmosHistoryDebounceTimer = null
  }
  cosmosHistoryDebounceTimer = setTimeout(() => {
    recordCosmosHistorySnapshot()
  }, 260)
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

async function openHistoryEntry(entry: DocumentHistoryEntry): Promise<boolean> {
  if (entry.kind === 'cosmos') {
    const snapshot = readCosmosHistorySnapshot(entry.payload)
    if (!snapshot) return false
    return await applyCosmosHistorySnapshot(snapshot)
  }
  if (entry.kind === 'second-brain') {
    const snapshot = readSecondBrainHistorySnapshot(entry.payload)
    if (!snapshot) return false
    multiPane.openSurfaceInPane('second-brain-chat')
    if (!allWorkspaceFiles.value.length) {
      await loadAllFiles()
    }
    return true
  }

  const opened = await openTabWithAutosave(entry.path, { recordHistory: false })
  if (!opened) return false
  await nextTick()
  editorRef.value?.focusEditor()
  return true
}

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
  const anchor = side === 'back'
    ? backHistoryButtonRef.value
    : forwardHistoryButtonRef.value
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
    isApplyingHistoryNavigation = true
    let opened = false
    try {
      opened = await openHistoryEntry(targetEntry)
    } finally {
      isApplyingHistoryNavigation = false
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

  if (overflowMenuOpen.value && !overflowMenuRef.value?.contains(target)) {
    closeOverflowMenu()
  }

  if (historyMenuOpen.value === 'back' && !backHistoryMenuRef.value?.contains(target)) {
    closeHistoryMenu()
  }

  if (historyMenuOpen.value === 'forward' && !forwardHistoryMenuRef.value?.contains(target)) {
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

function onSecondBrainContextChanged(_paths: string[]) {}

function applySettingsLlmPreset(provider: 'openai' | 'anthropic' | 'custom') {
  settingsLlmProviderPreset.value = provider
  settingsModalError.value = ''
  if (provider === 'openai') {
    settingsLlmLabel.value = 'OpenAI Remote'
    settingsLlmCustomProvider.value = 'openai'
    settingsLlmModel.value = 'gpt-4.1'
    settingsLlmBaseUrl.value = ''
    return
  }
  if (provider === 'anthropic') {
    settingsLlmLabel.value = 'Anthropic Claude'
    settingsLlmCustomProvider.value = 'anthropic'
    settingsLlmModel.value = 'claude-3-7-sonnet-latest'
    settingsLlmBaseUrl.value = ''
    return
  }
  settingsLlmLabel.value = 'Custom LLM'
  settingsLlmCustomProvider.value = 'openai_compatible'
  settingsLlmModel.value = ''
  settingsLlmBaseUrl.value = ''
}

function applySettingsDefaults() {
  settingsActiveTab.value = 'llm'
  settingsConfigPath.value = '~/.tomosona/conf.json'
  settingsLlmApiKey.value = ''
  settingsLlmHasStoredApiKey.value = false
  applySettingsLlmPreset('openai')
  settingsEmbeddingsMode.value = 'internal'
  settingsEmbeddingsProvider.value = 'openai'
  settingsEmbeddingsLabel.value = 'OpenAI Embeddings'
  settingsEmbeddingsModel.value = 'text-embedding-3-small'
  settingsEmbeddingsBaseUrl.value = ''
  settingsEmbeddingsApiKey.value = ''
  settingsEmbeddingsHasStoredApiKey.value = false
  settingsModalError.value = ''
}

function hydrateSettingsFromConfig(view: AppSettingsView) {
  settingsConfigPath.value = view.path || settingsConfigPath.value
  if (view.llm && view.llm.profiles.length > 0) {
    const active = view.llm.profiles.find((item) => item.id === view.llm!.active_profile) ?? view.llm.profiles[0]
    const provider = active.provider.trim().toLowerCase()
    settingsLlmProviderPreset.value = provider === 'openai'
      ? 'openai'
      : provider === 'anthropic'
        ? 'anthropic'
        : 'custom'
    settingsLlmCustomProvider.value = active.provider
    settingsLlmLabel.value = active.label
    settingsLlmModel.value = active.model
    settingsLlmBaseUrl.value = active.base_url ?? ''
    settingsLlmHasStoredApiKey.value = active.has_api_key
    settingsLlmApiKey.value = ''
  }
  settingsEmbeddingsMode.value = view.embeddings.mode
  if (view.embeddings.external) {
    settingsEmbeddingsProvider.value = 'openai'
    settingsEmbeddingsLabel.value = view.embeddings.external.label
    settingsEmbeddingsModel.value = view.embeddings.external.model
    settingsEmbeddingsBaseUrl.value = view.embeddings.external.base_url ?? ''
    settingsEmbeddingsHasStoredApiKey.value = view.embeddings.external.has_api_key
    settingsEmbeddingsApiKey.value = ''
  } else {
    settingsEmbeddingsProvider.value = 'openai'
    settingsEmbeddingsLabel.value = 'OpenAI Embeddings'
    settingsEmbeddingsModel.value = 'text-embedding-3-small'
    settingsEmbeddingsBaseUrl.value = ''
    settingsEmbeddingsHasStoredApiKey.value = false
    settingsEmbeddingsApiKey.value = ''
  }
}

function closeSettingsModal() {
  settingsModalVisible.value = false
  settingsModalError.value = ''
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function openSettingsModal() {
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  applySettingsDefaults()
  try {
    const view = await readAppSettings()
    hydrateSettingsFromConfig(view)
  } catch (err) {
    settingsModalError.value = err instanceof Error ? err.message : 'Could not read settings.'
  }
  settingsModalVisible.value = true
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-settings-llm-apikey="true"]')?.focus()
}

function buildSaveSettingsPayload(): SaveAppSettingsPayload {
  const llmProvider = settingsLlmProviderPreset.value === 'openai'
    ? 'openai'
    : settingsLlmProviderPreset.value === 'anthropic'
      ? 'anthropic'
      : settingsLlmCustomProvider.value.trim()
  const llmProfileId = settingsLlmProviderPreset.value === 'custom' ? 'custom-profile' : `${llmProvider}-profile`
  const capabilities = {
    text: true,
    image_input: settingsLlmProviderPreset.value !== 'custom',
    audio_input: false,
    tool_calling: true,
    streaming: true
  }
  const llmProfile = {
    id: llmProfileId,
    label: settingsLlmLabel.value.trim(),
    provider: llmProvider,
    model: settingsLlmModel.value.trim(),
    preserve_existing_api_key: settingsLlmHasStoredApiKey.value && !settingsLlmApiKey.value.trim(),
    capabilities,
    default_mode: 'freestyle',
    ...(settingsLlmApiKey.value.trim() ? { api_key: settingsLlmApiKey.value.trim() } : {}),
    ...(settingsLlmBaseUrl.value.trim() ? { base_url: settingsLlmBaseUrl.value.trim() } : {})
  }

  const payload: SaveAppSettingsPayload = {
    llm: {
      active_profile: llmProfileId,
      profiles: [llmProfile]
    },
    embeddings: {
      mode: settingsEmbeddingsMode.value
    }
  }
  if (settingsEmbeddingsMode.value === 'external') {
    payload.embeddings.external = {
      id: 'emb-openai-profile',
      label: settingsEmbeddingsLabel.value.trim() || 'OpenAI Embeddings',
      provider: settingsEmbeddingsProvider.value,
      model: settingsEmbeddingsModel.value.trim(),
      preserve_existing_api_key: settingsEmbeddingsHasStoredApiKey.value && !settingsEmbeddingsApiKey.value.trim(),
      ...(settingsEmbeddingsApiKey.value.trim() ? { api_key: settingsEmbeddingsApiKey.value.trim() } : {}),
      ...(settingsEmbeddingsBaseUrl.value.trim() ? { base_url: settingsEmbeddingsBaseUrl.value.trim() } : {})
    }
  }
  return payload
}

async function submitSettingsModal() {
  if (!settingsLlmModel.value.trim()) {
    settingsModalError.value = 'LLM model is required.'
    return false
  }
  if (!settingsLlmLabel.value.trim()) {
    settingsModalError.value = 'LLM profile label is required.'
    return false
  }
  if (settingsLlmProviderPreset.value === 'custom' && !settingsLlmCustomProvider.value.trim()) {
    settingsModalError.value = 'Custom LLM provider is required.'
    return false
  }
  if (!settingsLlmHasStoredApiKey.value && !settingsLlmApiKey.value.trim()) {
    settingsModalError.value = 'LLM API key is required.'
    return false
  }
  if (settingsEmbeddingsMode.value === 'external' && !settingsEmbeddingsModel.value.trim()) {
    settingsModalError.value = 'Embeddings model is required.'
    return false
  }
  if (settingsEmbeddingsMode.value === 'external' && !settingsEmbeddingsHasStoredApiKey.value && !settingsEmbeddingsApiKey.value.trim()) {
    settingsModalError.value = 'Embeddings API key is required for external mode.'
    return false
  }
  settingsModalError.value = ''

  try {
    const result = await writeAppSettings(buildSaveSettingsPayload())
    filesystem.notifySuccess(`Settings saved at ${result.path}.`)
    if (result.embeddings_changed) {
      markIndexOutOfSync()
      filesystem.notifyInfo('Embedding settings changed. Rebuild index to resync semantic search.')
    }
    closeSettingsModal()
    return true
  } catch (err) {
    settingsModalError.value = err instanceof Error ? err.message : 'Could not save settings.'
    return false
  }
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
  reindexGeneration += 1
  pendingReindexPaths.clear()
  updatePendingReindexCount()
  pendingSemanticReindexAt.clear()
  if (semanticReindexTimer) {
    clearTimeout(semanticReindexTimer)
    semanticReindexTimer = null
  }
  semanticIndexState.value = 'idle'
  reindexWorkerRunning = false
  indexRunKind.value = 'idle'
  indexRunPhase.value = 'idle'
  indexRunCurrentPath.value = ''
  indexRunCompleted.value = 0
  indexRunTotal.value = 0
  indexFinalizeCompleted.value = 0
  indexFinalizeTotal.value = 0
  indexRunMessage.value = ''
  multiPane.resetToSinglePane()
  multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
  documentHistory.reset()
  editorState.setActiveOutline([])
  searchHits.value = []
  allWorkspaceFiles.value = []
  backlinks.value = []
  backlinksLoading.value = false
  semanticLinks.value = []
  semanticLinksLoading.value = false
  cosmos.clearState()
  filesystem.selectedCount.value = 0
  filesystem.clearWorkspacePath()
  try {
    await clearWorkingFolder()
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not close workspace.'
  }
  window.localStorage.removeItem(WORKING_FOLDER_STORAGE_KEY)
  filesystem.indexingState.value = 'indexed'
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
  try {
    reindexGeneration += 1
    pendingReindexPaths.clear()
    updatePendingReindexCount()
    pendingSemanticReindexAt.clear()
    if (semanticReindexTimer) {
      clearTimeout(semanticReindexTimer)
      semanticReindexTimer = null
    }
    semanticIndexState.value = 'idle'
    reindexWorkerRunning = false
    indexRunKind.value = 'idle'
    indexRunPhase.value = 'idle'
    indexRunCurrentPath.value = ''
    indexRunCompleted.value = 0
    indexRunTotal.value = 0
    indexFinalizeCompleted.value = 0
    indexFinalizeTotal.value = 0
    indexRunMessage.value = ''
    const canonical = await setWorkingFolder(path)
    filesystem.setWorkspacePath(canonical)
    filesystem.indexingState.value = 'indexing'
    await initDb()
    searchHits.value = []
    allWorkspaceFiles.value = []
    window.localStorage.setItem(WORKING_FOLDER_STORAGE_KEY, canonical)
    if (multiPane.findPaneContainingSurface('cosmos') !== null) {
      await cosmos.refreshGraph()
    }

    if (activeFilePath.value && !activeFilePath.value.startsWith(canonical)) {
      multiPane.resetToSinglePane()
      multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
      editorState.setActiveOutline([])
    }
  } catch (err) {
    filesystem.clearWorkspacePath()
    multiPane.resetToSinglePane()
    multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
    searchHits.value = []
    window.localStorage.removeItem(WORKING_FOLDER_STORAGE_KEY)
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not open working folder.'
  } finally {
    if (filesystem.hasWorkspace.value) {
      filesystem.indexingState.value = 'indexed'
    }
  }
}

function onExplorerError(message: string) {
  filesystem.errorMessage.value = message
}

function onExplorerSelection(paths: string[]) {
  filesystem.selectedCount.value = paths.length
}

async function ensureActiveTabSavedBeforeSwitch(targetPath: string): Promise<boolean> {
  const target = targetPath.trim()
  const current = activeFilePath.value
  if (!target || !current || current === target) return true

  const status = editorState.getStatus(current)
  if (!status.dirty) return true

  await editorRef.value?.saveNow()

  const activeAfterSave = activeFilePath.value || current
  const statusAfterSave = editorState.getStatus(activeAfterSave)
  if (statusAfterSave.dirty) {
    filesystem.errorMessage.value = statusAfterSave.saveError || 'Could not save current note before switching tabs.'
    return false
  }

  return true
}

async function openTabWithAutosave(path: string, options: NavigateOptions = {}): Promise<boolean> {
  const target = path.trim()
  if (!target) return false
  const canSwitch = await ensureActiveTabSavedBeforeSwitch(target)
  if (!canSwitch) return false
  multiPane.openPathInPane(target)
  exitCosmosForNoteNavigation()
  if (options.recordHistory !== false) {
    documentHistory.record(target)
  }
  return true
}

async function setActiveTabWithAutosave(path: string, options: NavigateOptions = {}): Promise<boolean> {
  const target = path.trim()
  if (!target) return false
  const canSwitch = await ensureActiveTabSavedBeforeSwitch(target)
  if (!canSwitch) return false
  multiPane.setActivePathInPane(multiPane.layout.value.activePaneId, target)
  exitCosmosForNoteNavigation()
  if (options.recordHistory !== false) {
    documentHistory.record(target)
  }
  return true
}

function exitCosmosForNoteNavigation() {
  // Pane-native surfaces do not own global sidebar mode.
}

async function goBackInHistory() {
  const target = documentHistory.goBackEntry()
  if (!target) return false
  isApplyingHistoryNavigation = true
  let opened = false
  try {
    opened = await openHistoryEntry(target)
  } finally {
    isApplyingHistoryNavigation = false
  }
  if (opened) {
    return true
  }
  documentHistory.goForwardEntry()
  return false
}

async function goForwardInHistory() {
  const target = documentHistory.goForwardEntry()
  if (!target) return false
  isApplyingHistoryNavigation = true
  let opened = false
  try {
    opened = await openHistoryEntry(target)
  } finally {
    isApplyingHistoryNavigation = false
  }
  if (opened) {
    return true
  }
  documentHistory.goBackEntry()
  return false
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

async function ensureParentFolders(filePath: string) {
  const root = filesystem.workingFolderPath.value
  if (!root) throw new Error('Working folder is not set.')

  const relative = toRelativePath(filePath)
  const parts = relative.split('/').filter(Boolean)
  if (parts.length <= 1) return

  let current = root
  for (const segment of parts.slice(0, -1)) {
    const next = `${current}/${segment}`
    const exists = await pathExists(next)
    if (!exists) {
      await createEntry(current, segment, 'folder', 'fail')
    }
    current = next
  }
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
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
    const input = searchInputRef.value
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

async function openNextTabWithAutosave() {
  const activePane = multiPane.layout.value.panesById[multiPane.layout.value.activePaneId]
  const tabs = (activePane?.openTabs ?? []).filter((tab) => tab.type === 'document')
  if (!tabs.length) return
  const currentPath = multiPane.getActiveDocumentPath(activePane?.id ?? multiPane.layout.value.activePaneId)
  const currentIndex = tabs.findIndex((tab) => tab.path === currentPath)
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length
  const nextPath = tabs[nextIndex] && tabs[nextIndex].type === 'document' ? tabs[nextIndex].path : ''
  if (!nextPath) return
  const opened = await setActiveTabWithAutosave(nextPath)
  if (!opened) return
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

async function openDailyNote(date: string) {
  const root = filesystem.workingFolderPath.value
  if (!root) {
    filesystem.errorMessage.value = 'Working folder is not set.'
    return false
  }
  if (!isIsoDate(date)) {
    filesystem.errorMessage.value = 'Invalid date format. Use YYYY-MM-DD.'
    return false
  }
  const path = dailyNotePath(root, date)
  let exists = false
  try {
    exists = await pathExists(path)
  } catch {
    exists = false
  }

  if (!exists) {
    await ensureParentFolders(path)
    await writeTextFile(path, '')
    upsertWorkspaceFilePath(path)
  }

  return await openTabWithAutosave(path)
}

async function openTodayNote() {
  return await openDailyNote(formatIsoDate(new Date()))
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
  return await openDailyNote(formatIsoDate(value))
}

async function openSpecificDateNote() {
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
  const opened = await openDailyNote(isoDate)
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
    const opened = await openDailyNote(normalized)
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

async function loadWikilinkTargets(): Promise<string[]> {
  const root = filesystem.workingFolderPath.value
  if (!root) return []
  try {
    return await listMarkdownFiles()
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not load wikilink targets.'
    return []
  }
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

async function loadPropertyTypeSchema(): Promise<Record<string, string>> {
  const root = filesystem.workingFolderPath.value
  if (!root) return {}
  try {
    return await readPropertyTypeSchema()
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not load property types.'
    return {}
  }
}

async function savePropertyTypeSchema(schema: Record<string, string>): Promise<void> {
  const root = filesystem.workingFolderPath.value
  if (!root) return
  await writePropertyTypeSchema(schema)
}

async function loadAllFiles() {
  if (!filesystem.workingFolderPath.value || loadingAllFiles.value) return
  loadingAllFiles.value = true

  try {
    const files: string[] = []
    const queue: string[] = [filesystem.workingFolderPath.value]

    while (queue.length > 0) {
      const dir = queue.shift()!
      const children = await listChildren(dir)
      for (const child of children) {
        if (child.is_dir) {
          queue.push(child.path)
          continue
        }
        if (child.is_markdown) {
          files.push(child.path)
        }
      }
    }

    allWorkspaceFiles.value = files.sort((a, b) => a.localeCompare(b))
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not load file list.'
  } finally {
    loadingAllFiles.value = false
  }
}

async function openQuickOpen(initialQuery = '') {
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  quickOpenVisible.value = true
  quickOpenQuery.value = initialQuery
  quickOpenActiveIndex.value = 0
  if (!allWorkspaceFiles.value.length) {
    await loadAllFiles()
  }
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-quick-open-input=\"true\"]')?.focus()
}

function closeQuickOpen(restoreFocusOrEvent: boolean | PointerEvent = true) {
  const restoreFocus = typeof restoreFocusOrEvent === 'boolean' ? restoreFocusOrEvent : true
  quickOpenVisible.value = false
  quickOpenQuery.value = ''
  quickOpenActiveIndex.value = 0
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
  void openDailyNote(item.date).then((opened) => {
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
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
  modalFocusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
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

async function rebuildIndexFromOverflow() {
  const root = filesystem.workingFolderPath.value
  if (!root) return
  closeOverflowMenu()
  filesystem.indexingState.value = 'indexing'
  reindexGeneration += 1
  pendingReindexPaths.clear()
  updatePendingReindexCount()
  pendingSemanticReindexAt.clear()
  if (semanticReindexTimer) {
    clearTimeout(semanticReindexTimer)
    semanticReindexTimer = null
  }
  semanticIndexState.value = 'running'
  reindexWorkerRunning = false
  indexRunKind.value = 'rebuild'
  indexRunPhase.value = 'indexing_files'
  indexRunCurrentPath.value = ''
  indexRunCompleted.value = 0
  indexRunTotal.value = 0
  indexFinalizeCompleted.value = 0
  indexFinalizeTotal.value = 0
  indexRunMessage.value = ''
  console.info('[index] rebuild:start')
  try {
    const result = await rebuildWorkspaceIndex()
    indexRunTotal.value = result.indexed_files
    indexRunCompleted.value = result.indexed_files
    if (result.canceled) {
      filesystem.indexingState.value = 'out_of_sync'
      semanticIndexState.value = 'error'
      indexRunPhase.value = 'error'
      indexRunMessage.value = 'Rebuild canceled by user.'
      filesystem.notifyInfo('Index rebuild canceled.')
      return
    }
    indexRunPhase.value = 'refreshing_views'
    indexFinalizeCompleted.value = 0
    const hasCosmosSurface = multiPane.findPaneContainingSurface('cosmos') !== null
    indexFinalizeTotal.value = hasCosmosSurface ? 3 : 2
    await loadAllFiles()
    indexFinalizeCompleted.value = 1
    await refreshBacklinks()
    indexFinalizeCompleted.value = 2
    if (hasCosmosSurface) {
      await cosmos.refreshGraph()
      indexFinalizeCompleted.value = 3
    }
    filesystem.indexingState.value = 'indexed'
    semanticIndexState.value = 'idle'
    indexRunPhase.value = 'done'
    indexRunLastFinishedAt.value = Date.now()
    console.info('[index] rebuild:done', { indexed: result.indexed_files })
    filesystem.notifySuccess(`Index rebuilt (${result.indexed_files} file${result.indexed_files === 1 ? '' : 's'}).`)
  } catch (err) {
    filesystem.indexingState.value = 'out_of_sync'
    semanticIndexState.value = 'error'
    indexRunPhase.value = 'error'
    indexRunMessage.value = err instanceof Error ? err.message : 'Could not rebuild index.'
    console.warn('[index] rebuild:error', {
      message: err instanceof Error ? err.message : 'Could not rebuild index.'
    })
    filesystem.notifyError(err instanceof Error ? err.message : 'Could not rebuild index.')
  }
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

function onSettingsInputKeydown(event: KeyboardEvent) {
  if (event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.stopPropagation()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeSettingsModal()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    void submitSettingsModal()
  }
}

function activeModalSelector(): string | null {
  if (wikilinkRewritePrompt.value) return '[data-modal="wikilink-rewrite"]'
  if (cosmosCommandLoadingVisible.value) return '[data-modal="cosmos-command-loading"]'
  if (indexStatusModalVisible.value) return '[data-modal="index-status"]'
  if (shortcutsModalVisible.value) return '[data-modal="shortcuts"]'
  if (settingsModalVisible.value) return '[data-modal="settings"]'
  if (openDateModalVisible.value) return '[data-modal="open-date"]'
  if (newFolderModalVisible.value) return '[data-modal="new-folder"]'
  if (newFileModalVisible.value) return '[data-modal="new-file"]'
  if (quickOpenVisible.value) return '[data-modal="quick-open"]'
  return null
}

function hasBlockingModalOpen(): boolean {
  return Boolean(
    quickOpenVisible.value ||
    cosmosCommandLoadingVisible.value ||
    indexStatusModalVisible.value ||
    newFileModalVisible.value ||
    newFolderModalVisible.value ||
    openDateModalVisible.value ||
    settingsModalVisible.value ||
    shortcutsModalVisible.value ||
    wikilinkRewritePrompt.value
  )
}

function restoreFocusAfterModalClose() {
  if (activeModalSelector()) return
  if (modalFocusReturnTarget && document.contains(modalFocusReturnTarget)) {
    modalFocusReturnTarget.focus()
  } else {
    editorRef.value?.focusEditor()
  }
  modalFocusReturnTarget = null
}

function trapTabWithinActiveModal(event: KeyboardEvent): boolean {
  if (event.key !== 'Tab') return false
  const selector = activeModalSelector()
  if (!selector) return false
  const modal = document.querySelector<HTMLElement>(selector)
  if (!modal) return false

  const focusable = Array.from(
    modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'))

  if (!focusable.length) {
    event.preventDefault()
    modal.focus()
    return true
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  const isInsideModal = Boolean(active && modal.contains(active))

  if (event.shiftKey) {
    if (!isInsideModal || active === first) {
      event.preventDefault()
      last.focus()
      return true
    }
    return false
  }

  if (!isInsideModal || active === last) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
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

function moveQuickOpenSelection(delta: number) {
  const count = quickOpenItemCount.value
  if (!count) return
  quickOpenActiveIndex.value = (quickOpenActiveIndex.value + delta + count) % count
}

function setQuickOpenActiveIndex(index: number) {
  quickOpenActiveIndex.value = index
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

  if (hasBlockingModalOpen()) return

  if (shouldBlockGlobalShortcutsFromTarget(event.target)) return

  const isMod = event.metaKey || event.ctrlKey
  if (!isMod) return

  const key = event.key.toLowerCase()

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

  if (key === 'w') {
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

watch(themePreference, (next) => {
  window.localStorage.setItem(THEME_STORAGE_KEY, next)
  applyTheme()
})

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
    allWorkspaceFiles.value = []
    backlinks.value = []
    semanticLinks.value = []
    virtualDocs.value = {}
    activeFileMetadata.value = null
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
  stopIndexStatusPolling()
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  if (cosmosHistoryDebounceTimer) {
    clearTimeout(cosmosHistoryDebounceTimer)
    cosmosHistoryDebounceTimer = null
  }
  if (historyMenuTimer) {
    clearTimeout(historyMenuTimer)
    historyMenuTimer = null
  }
  if (semanticReindexTimer) {
    clearTimeout(semanticReindexTimer)
    semanticReindexTimer = null
  }
  pendingSemanticReindexAt.clear()
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
      <aside class="activity-bar">
        <button
          class="activity-btn"
          :class="{ active: workspace.sidebarMode.value === 'explorer' && workspace.sidebarVisible.value }"
          type="button"
          title="Explorer"
          aria-label="Explorer"
          @click="setSidebarMode('explorer')"
        >
          <FolderIcon class="activity-btn-icon" />
        </button>
        <button
          class="activity-btn"
          :class="{ active: workspace.sidebarMode.value === 'search' && workspace.sidebarVisible.value }"
          type="button"
          title="Search"
          aria-label="Search"
          @click="setSidebarMode('search')"
        >
          <MagnifyingGlassIcon class="activity-btn-icon" />
        </button>
      </aside>

      <aside
        v-if="workspace.sidebarVisible.value"
        class="left-sidebar"
        :style="{ width: `${leftPaneWidth}px` }"
      >
        <div class="panel-header">
          <h2 class="panel-title">{{ workspace.sidebarMode.value }}</h2>
        </div>

        <div class="panel-body" :class="{ 'panel-body-explorer': workspace.sidebarMode.value === 'explorer' }">
          <div v-if="workspace.sidebarMode.value === 'explorer'" class="panel-fill">
            <ExplorerTree
              v-if="filesystem.hasWorkspace.value"
              ref="explorerRef"
              :folder-path="filesystem.workingFolderPath.value"
              :active-path="activeFilePath"
              @open="onExplorerOpen"
              @path-renamed="onExplorerPathRenamed"
              @request-create="onExplorerRequestCreate"
              @select="onExplorerSelection"
              @error="onExplorerError"
            />
            <div v-else class="placeholder empty-explorer">
              <span>No workspace selected.</span>
              <button type="button" class="inline-link-btn" @click="onSelectWorkingFolder">Open folder</button>
            </div>
          </div>

          <div v-else-if="workspace.sidebarMode.value === 'search'" class="panel-fill search-panel">
            <div class="search-controls">
              <input
                ref="searchInputRef"
                v-model="searchQuery"
                data-search-input="true"
                :disabled="!filesystem.hasWorkspace.value"
                class="tool-input"
                placeholder="Search content (e.g. tags:dev has:deadline deadline>=2026-03-01)"
                @keydown.enter.prevent="runGlobalSearch"
              />
            </div>
            <div class="search-mode-controls">
              <button
                v-for="option in searchModeOptions"
                :key="option.mode"
                type="button"
                class="search-mode-chip"
                :class="{ active: globalSearchMode === option.mode }"
                :disabled="!filesystem.hasWorkspace.value"
                @click="onGlobalSearchModeSelect(option.mode)"
              >
                {{ option.label }}
              </button>
            </div>
            <p class="search-mode-hint">Hint: <code>semantic:</code> concept | <code>lexical:</code> exact term</p>

            <div class="results-list">
              <div v-if="hasSearched && !searchLoading && !searchHits.length" class="placeholder">No results</div>
              <section v-for="group in groupedSearchResults" :key="group.path" class="result-group">
                <h3 class="result-file">{{ toRelativePath(group.path) }}</h3>
                <button
                  v-for="item in group.items"
                  :key="`${group.path}-${item.score}-${item.snippet}`"
                  type="button"
                  class="result-item"
                  @click="onSearchResultOpen(item)"
                >
                  <p v-if="showSearchScore" class="result-score">score: {{ formatSearchScore(item.score) }}</p>
                  <div class="result-snippet">
                    <template v-for="(part, idx) in parseSearchSnippet(item.snippet)" :key="`${idx}-${part.text}`">
                      <strong v-if="part.highlighted">{{ part.text }}</strong>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </div>
                </button>
              </section>
            </div>
          </div>

          <div v-else class="placeholder">No panel selected</div>
        </div>
      </aside>

      <section class="workspace-column">
        <header class="topbar">
          <div class="global-actions">
            <div class="nav-actions">
              <div ref="backHistoryMenuRef" class="history-nav-wrap">
                <button
                  ref="backHistoryButtonRef"
                  type="button"
                  class="toolbar-icon-btn"
                  :disabled="!documentHistory.canGoBack.value"
                  :title="`Back (${backShortcutLabel})`"
                  :aria-label="`Back (${backShortcutLabel})`"
                  @click="onHistoryButtonClick('back')"
                  @contextmenu.prevent="onHistoryButtonContextMenu('back', $event)"
                  @pointerdown="onHistoryButtonPointerDown('back', $event)"
                  @pointerup="cancelHistoryLongPress"
                  @pointerleave="cancelHistoryLongPress"
                  @pointercancel="cancelHistoryLongPress"
                >
                  <ArrowLeftIcon />
                </button>
                <div v-if="historyMenuOpen === 'back'" class="history-menu" :style="historyMenuStyle">
                  <button
                    v-for="target in documentHistory.backTargets.value.slice(0, 14)"
                    :key="`back-${target.index}-${target.entry.stateKey}`"
                    type="button"
                    class="history-menu-item"
                    @click="onHistoryTargetClick(target.index)"
                  >
                    {{ historyTargetLabel(target.entry) }}
                  </button>
                  <div v-if="!documentHistory.backTargets.value.length" class="history-menu-empty">No back history</div>
                </div>
              </div>
              <button
                type="button"
                class="toolbar-icon-btn"
                :disabled="!filesystem.hasWorkspace.value"
                :title="`Home: today note (${homeShortcutLabel})`"
                :aria-label="`Home: today note (${homeShortcutLabel})`"
                @click="void openTodayNote()"
              >
                <HomeIcon />
              </button>
              <button
                type="button"
                class="toolbar-icon-btn"
                :disabled="!filesystem.hasWorkspace.value"
                title="Cosmos view"
                aria-label="Cosmos view"
                @click="void openCosmosViewFromPalette()"
              >
                <ShareIcon />
              </button>
              <button
                type="button"
                class="toolbar-icon-btn"
                :disabled="!filesystem.hasWorkspace.value"
                title="Second Brain"
                aria-label="Second Brain"
                @click="void openSecondBrainViewFromPalette()"
              >
                <SparklesIcon />
              </button>
              <div ref="forwardHistoryMenuRef" class="history-nav-wrap">
                <button
                  ref="forwardHistoryButtonRef"
                  type="button"
                  class="toolbar-icon-btn"
                  :disabled="!documentHistory.canGoForward.value"
                  :title="`Forward (${forwardShortcutLabel})`"
                  :aria-label="`Forward (${forwardShortcutLabel})`"
                  @click="onHistoryButtonClick('forward')"
                  @contextmenu.prevent="onHistoryButtonContextMenu('forward', $event)"
                  @pointerdown="onHistoryButtonPointerDown('forward', $event)"
                  @pointerup="cancelHistoryLongPress"
                  @pointerleave="cancelHistoryLongPress"
                  @pointercancel="cancelHistoryLongPress"
                >
                  <ArrowRightIcon />
                </button>
                <div v-if="historyMenuOpen === 'forward'" class="history-menu history-menu-forward" :style="historyMenuStyle">
                  <button
                    v-for="target in documentHistory.forwardTargets.value.slice(0, 14)"
                    :key="`forward-${target.index}-${target.entry.stateKey}`"
                    type="button"
                    class="history-menu-item"
                    @click="onHistoryTargetClick(target.index)"
                  >
                    {{ historyTargetLabel(target.entry) }}
                  </button>
                  <div v-if="!documentHistory.forwardTargets.value.length" class="history-menu-empty">No forward history</div>
                </div>
              </div>
              <MultiPaneToolbarMenu
                :can-split="paneCount < 4"
                :pane-count="paneCount"
                @split-right="splitPaneFromPalette('row')"
                @split-down="splitPaneFromPalette('column')"
                @focus-pane="focusPaneFromPalette($event.index)"
                @focus-next="focusNextPaneFromPalette()"
                @move-tab-next="moveTabToNextPaneFromPalette()"
                @close-pane="closeActivePaneFromPalette()"
                @join-panes="joinPanesFromPalette()"
                @reset-layout="resetPaneLayoutFromPalette()"
              />
            </div>
            <button
              type="button"
              class="toolbar-icon-btn"
              :class="{ active: workspace.rightPaneVisible.value }"
              :title="workspace.rightPaneVisible.value ? 'Hide right pane' : 'Show right pane'"
              :aria-label="workspace.rightPaneVisible.value ? 'Hide right pane' : 'Show right pane'"
              @click="workspace.toggleRightPane()"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" ry="1.5" />
                <line x1="10" y1="2.5" x2="10" y2="13.5" />
              </svg>
            </button>
            <div ref="overflowMenuRef" class="overflow-wrap">
              <button
                type="button"
                class="toolbar-icon-btn"
                title="View options"
                aria-label="View options"
                :aria-expanded="overflowMenuOpen"
                @click="toggleOverflowMenu"
              >
                <EllipsisHorizontalIcon />
              </button>
              <div v-if="overflowMenuOpen" class="overflow-menu">
                <button
                  type="button"
                  class="overflow-item"
                  @click="openCommandPalette"
                >
                  <CommandLineIcon class="overflow-item-icon" />
                  Command palette
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  @click="openShortcutsFromOverflow"
                >
                  <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="1.5" y="2.5" width="13" height="10.5" rx="1.6" ry="1.6" />
                    <line x1="4" y1="6" x2="12" y2="6" />
                    <line x1="4" y1="9" x2="8.5" y2="9" />
                  </svg>
                  Keyboard shortcuts
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  @click="openSettingsFromOverflow"
                >
                  <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="2.2" />
                    <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4" />
                  </svg>
                  Open Settings
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  :disabled="!filesystem.hasWorkspace.value || filesystem.indexingState.value === 'indexing'"
                  @click="void rebuildIndexFromOverflow()"
                >
                  <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 2.5a5.5 5.5 0 1 1-4.4 2.2" />
                    <polyline points="1.8,2.6 4.9,2.6 4.9,5.7" />
                  </svg>
                  Reindex workspace
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  :disabled="!filesystem.hasWorkspace.value"
                  @click="closeWorkspace"
                >
                  <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                  Close workspace
                </button>
                <div class="overflow-divider"></div>
                <div class="overflow-label">Zoom</div>
                <button
                  type="button"
                  class="overflow-item"
                  @click="zoomInFromOverflow"
                >
                  <span class="overflow-item-icon overflow-glyph">+</span>
                  Zoom in
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  @click="zoomOutFromOverflow"
                >
                  <span class="overflow-item-icon overflow-glyph">-</span>
                  Zoom out
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  @click="resetZoomFromOverflow"
                >
                  <span class="overflow-item-icon overflow-glyph">100</span>
                  Reset zoom
                </button>
                <div class="overflow-zoom-state">Editor zoom: {{ zoomPercentLabel }}</div>
                <div class="overflow-divider"></div>
                <div class="overflow-label">Theme</div>
                <button
                  type="button"
                  class="overflow-item"
                  :class="{ active: themePreference === 'light' }"
                  @click="setThemeFromOverflow('light')"
                >
                  <SunIcon class="overflow-item-icon" />
                  Light
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  :class="{ active: themePreference === 'dark' }"
                  @click="setThemeFromOverflow('dark')"
                >
                  <MoonIcon class="overflow-item-icon" />
                  Dark
                </button>
                <button
                  type="button"
                  class="overflow-item"
                  :class="{ active: themePreference === 'system' }"
                  @click="setThemeFromOverflow('system')"
                >
                  <ComputerDesktopIcon class="overflow-item-icon" />
                  System
                </button>
              </div>
            </div>
          </div>
        </header>

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
                requestedSessionNonce: secondBrainRequestedSessionNonce
              }"
              @pane-focus="multiPane.setActivePane($event.paneId)"
              @pane-tab-click="void onPaneTabClick($event)"
              @pane-tab-close="onPaneTabClose($event)"
              @pane-tab-close-others="onPaneTabCloseOthers($event)"
              @pane-tab-close-all="onPaneTabCloseAll($event)"
              @pane-request-move-tab="multiPane.moveActiveTabToAdjacentPane($event.direction)"
              @open-note="void openTabWithAutosave($event)"
              @second-brain-context-changed="onSecondBrainContextChanged"
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
            :outline="editorState.activeOutline.value"
            :semantic-links="semanticLinks"
            :semantic-links-loading="semanticLinksLoading"
            :backlinks="backlinks"
            :backlinks-loading="backlinksLoading"
            :metadata-rows="metadataRows"
            :properties-preview="propertiesPreview"
            :property-parse-error-count="propertyParseErrorCount"
            :to-relative-path="toRelativePath"
            @outline-click="void onOutlineHeadingClick($event)"
            @backlink-open="void onBacklinkOpen($event)"
          />
        </div>
      </section>
    </div>

    <footer class="status-bar">
      <span class="status-item">{{ activeFilePath ? toRelativePath(activeFilePath) : 'No file' }}</span>
      <span class="status-item status-item-state">{{ activeStatus.saving ? 'saving...' : virtualDocs[activeFilePath] ? 'unsaved' : activeStatus.dirty ? 'edit' : 'saved' }}</span>
      <button type="button" class="status-item status-item-index status-trigger" :class="indexStateClass" @click="openIndexStatusModal">
        <span class="status-dot" :class="indexStateClass"></span>
        <span>index: {{ indexStateLabel }}</span>
      </button>
      <span class="status-item">workspace: {{ filesystem.workingFolderPath.value || 'none' }}</span>
    </footer>

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

    <div v-if="indexStatusModalVisible" class="modal-overlay" @click.self="closeIndexStatusModal">
      <div
        class="modal confirm-modal index-status-modal"
        data-modal="index-status"
        role="dialog"
        aria-modal="true"
        aria-labelledby="index-status-title"
        tabindex="-1"
      >
        <h3 id="index-status-title" class="confirm-title">Index Status</h3>
        <div class="index-status-body">
          <section class="index-overview">
            <div class="index-overview-main">
              <span class="index-status-badge" :class="indexStatusBadgeClass">
                <span class="index-status-badge-dot"></span>
                {{ indexStatusBadgeLabel }}
              </span>
              <div
                v-if="indexShowProgressBar"
                class="index-overview-progress-inline"
              >
                <div class="index-progress-track" role="progressbar" :aria-valuenow="indexProgressPercent" aria-valuemin="0" aria-valuemax="100">
                  <div class="index-progress-fill" :style="{ width: `${indexProgressPercent}%` }"></div>
                </div>
                <div class="index-progress-meta">
                  <span>{{ indexProgressLabel }}</span>
                  <span>{{ indexProgressPercent }}%</span>
                </div>
              </div>
              <p v-else-if="indexProgressSummary" class="index-overview-summary">{{ indexProgressSummary }}</p>
              <p v-if="indexRunCurrentPath" class="index-overview-current">
                Current: {{ toRelativePath(indexRunCurrentPath) }}
              </p>
            </div>
          </section>

          <section class="index-model-card">
            <div class="index-model-head">
              <p class="index-model-label">Embedding model</p>
              <span class="index-model-state" :class="indexModelStateClass">{{ indexModelStatusLabel }}</span>
            </div>
            <p class="index-model-name">{{ indexRuntimeStatus?.model_name || 'n/a' }}</p>
            <p v-if="indexRuntimeStatus?.model_last_duration_ms != null" class="index-model-meta">
              Last init {{ formatDurationMs(indexRuntimeStatus.model_last_duration_ms) }}
              <span v-if="indexRuntimeStatus.model_last_finished_at_ms"> at {{ formatTimestamp(indexRuntimeStatus.model_last_finished_at_ms) }}</span>
            </p>
            <p v-if="indexShowWarmupNote" class="index-model-hint">
              First initialization can download model weights and take longer.
            </p>
          </section>

          <section v-if="indexAlert" class="index-alert" :class="`index-alert-${indexAlert.level}`">
            <div>
              <p class="index-alert-title">{{ indexAlert.title }}</p>
              <p class="index-alert-message">{{ indexAlert.message }}</p>
            </div>
            <UiButton
              v-if="!indexRunning"
              size="sm"
              variant="secondary"
              class-name="index-alert-action"
              :disabled="indexStatusBusy"
              @click="onIndexPrimaryAction"
            >
              Retry rebuild
            </UiButton>
          </section>

          <div class="index-status-sections">
            <div class="index-log-panel">
              <div class="index-log-header">
                <p class="index-log-title">Recent indexing activity</p>
                <div class="index-log-filters" role="tablist" aria-label="Index log filters">
                  <button
                    type="button"
                    class="index-log-filter-btn"
                    :class="{ active: indexLogFilter === 'all' }"
                    @click="indexLogFilter = 'all'"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="index-log-filter-btn"
                    :class="{ active: indexLogFilter === 'errors' }"
                    @click="indexLogFilter = 'errors'"
                  >
                    Errors ({{ indexErrorCount }})
                  </button>
                  <button
                    type="button"
                    class="index-log-filter-btn"
                    :class="{ active: indexLogFilter === 'slow' }"
                    @click="indexLogFilter = 'slow'"
                  >
                    Slow >1s ({{ indexSlowCount }})
                  </button>
                </div>
              </div>
              <div v-if="!filteredIndexActivityRows.length" class="index-log-empty">No matching activity.</div>
              <div v-else class="index-log-list">
                <div
                  v-for="row in filteredIndexActivityRows"
                  :key="row.id"
                  class="index-log-row"
                  :class="`index-log-row-${row.state}`"
                >
                  <span class="index-log-time">{{ row.timeLabel }}</span>
                  <div class="index-log-copy">
                    <p class="index-log-main">
                      <span class="index-log-state-icon" aria-hidden="true">{{ row.state === 'done' ? '✅' : row.state === 'error' ? '⚠️' : '⏳' }}</span>
                      <span>{{ row.title }}</span>
                    </p>
                    <p v-if="row.path" class="index-log-path">
                      <span v-if="row.directory" class="index-log-dir">{{ row.directory }}/</span><strong>{{ row.fileName }}</strong>
                    </p>
                    <p v-if="row.detail" class="index-log-detail">{{ row.detail }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="confirm-actions">
          <UiButton
            size="sm"
            :variant="indexRunning ? 'secondary' : 'primary'"
            :class-name="indexRunning ? 'index-stop-btn' : ''"
            :disabled="indexStatusBusy"
            @click="onIndexPrimaryAction"
          >
            {{ indexActionLabel }}
          </UiButton>
          <UiButton size="sm" @click="closeIndexStatusModal">Close</UiButton>
        </div>
      </div>
    </div>

    <div v-if="quickOpenVisible" class="modal-overlay" @click.self="() => closeQuickOpen()">
      <div
        class="modal quick-open"
        data-modal="quick-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-open-title"
        aria-describedby="quick-open-description"
        tabindex="-1"
      >
        <h3 id="quick-open-title" class="sr-only">Quick open</h3>
        <p id="quick-open-description" class="sr-only">Type a file name, or start with greater-than for actions.</p>
        <input
          v-model="quickOpenQuery"
          data-quick-open-input="true"
          class="tool-input"
          placeholder="Type file name, or start with > for actions"
          @keydown="onQuickOpenInputKeydown"
        />
        <div class="modal-list">
          <button
            v-for="(item, index) in quickOpenActionResults"
            :key="item.id"
            type="button"
            class="modal-item"
            :class="{ active: quickOpenActiveIndex === index }"
            @click="runQuickOpenAction(item.id)"
            @mousemove="setQuickOpenActiveIndex(index)"
          >
            {{ item.label }}
          </button>
          <button
            v-for="(item, index) in quickOpenResults"
            :key="item.kind === 'file' ? item.path : `daily-${item.date}`"
            type="button"
            class="modal-item"
            :class="{ active: quickOpenActiveIndex === index }"
            @click="openQuickResult(item)"
            @mousemove="setQuickOpenActiveIndex(index)"
          >
            {{ item.label }}
          </button>
          <div v-if="quickOpenIsActionMode && !quickOpenActionResults.length" class="placeholder">No matching actions</div>
          <div v-else-if="!quickOpenIsActionMode && !quickOpenResults.length" class="placeholder">
            {{ quickOpenQuery.trim() ? 'No matching files' : 'Type to search files' }}
          </div>
        </div>
      </div>
    </div>

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

    <div v-if="newFileModalVisible" class="modal-overlay" @click.self="closeNewFileModal">
      <div
        class="modal confirm-modal"
        data-modal="new-file"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-file-title"
        aria-describedby="new-file-description"
        tabindex="-1"
      >
        <h3 id="new-file-title" class="confirm-title">New Note</h3>
        <p id="new-file-description" class="confirm-text">Enter a workspace-relative note path. `.md` is added automatically.</p>
        <input
          v-model="newFilePathInput"
          data-new-file-input="true"
          class="tool-input"
          placeholder="untitled"
          @keydown="onNewFileInputKeydown"
        />
        <p v-if="newFileModalError" class="modal-input-error">{{ newFileModalError }}</p>
        <div class="confirm-actions">
          <UiButton size="sm" variant="ghost" @click="closeNewFileModal">Cancel</UiButton>
          <UiButton size="sm" @click="submitNewFileFromModal">Create</UiButton>
        </div>
      </div>
    </div>

    <div v-if="newFolderModalVisible" class="modal-overlay" @click.self="closeNewFolderModal">
      <div
        class="modal confirm-modal"
        data-modal="new-folder"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-folder-title"
        aria-describedby="new-folder-description"
        tabindex="-1"
      >
        <h3 id="new-folder-title" class="confirm-title">New Folder</h3>
        <p id="new-folder-description" class="confirm-text">Enter a workspace-relative folder path.</p>
        <input
          v-model="newFolderPathInput"
          data-new-folder-input="true"
          class="tool-input"
          placeholder="new-folder"
          @keydown="onNewFolderInputKeydown"
        />
        <p v-if="newFolderModalError" class="modal-input-error">{{ newFolderModalError }}</p>
        <div class="confirm-actions">
          <UiButton size="sm" variant="ghost" @click="closeNewFolderModal">Cancel</UiButton>
          <UiButton size="sm" @click="submitNewFolderFromModal">Create</UiButton>
        </div>
      </div>
    </div>

    <div v-if="openDateModalVisible" class="modal-overlay" @click.self="closeOpenDateModal">
      <div
        class="modal confirm-modal"
        data-modal="open-date"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-date-title"
        aria-describedby="open-date-description"
        tabindex="-1"
      >
        <h3 id="open-date-title" class="confirm-title">Open Specific Date</h3>
        <p id="open-date-description" class="confirm-text">Enter a date as `YYYY-MM-DD`.</p>
        <input
          v-model="openDateInput"
          data-open-date-input="true"
          class="tool-input"
          placeholder="2026-02-22"
          @keydown="onOpenDateInputKeydown"
        />
        <p v-if="openDateModalError" class="modal-input-error">{{ openDateModalError }}</p>
        <div class="confirm-actions">
          <UiButton size="sm" variant="ghost" @click="closeOpenDateModal">Cancel</UiButton>
          <UiButton size="sm" @click="submitOpenDateFromModal">Open</UiButton>
        </div>
      </div>
    </div>

    <div v-if="settingsModalVisible" class="modal-overlay" @click.self="closeSettingsModal">
      <div
        class="modal settings-modal"
        data-modal="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabindex="-1"
      >
        <h3 id="settings-title" class="confirm-title">Settings</h3>
        <p class="confirm-text">Config path: <code>{{ settingsConfigPath }}</code></p>
        <div class="settings-tabs" role="tablist" aria-label="Settings tabs">
          <button type="button" class="settings-tab-btn" :class="{ active: settingsActiveTab === 'llm' }" @click="settingsActiveTab = 'llm'">LLM</button>
          <button type="button" class="settings-tab-btn" :class="{ active: settingsActiveTab === 'embeddings' }" @click="settingsActiveTab = 'embeddings'">Embeddings</button>
        </div>

        <div v-if="settingsActiveTab === 'llm'" class="settings-tab-panel">
          <label class="modal-field-label" for="settings-llm-provider">Provider preset</label>
          <select
            id="settings-llm-provider"
            class="tool-input"
            :value="settingsLlmProviderPreset"
            @change="applySettingsLlmPreset(($event.target as HTMLSelectElement).value as 'openai' | 'anthropic' | 'custom')"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="custom">Custom</option>
          </select>

          <label class="modal-field-label" for="settings-llm-label">Profile label</label>
          <input id="settings-llm-label" v-model="settingsLlmLabel" class="tool-input" placeholder="Profile label" @keydown="onSettingsInputKeydown" />

          <label v-if="settingsLlmProviderPreset === 'custom'" class="modal-field-label" for="settings-llm-custom-provider">Custom provider</label>
          <input
            v-if="settingsLlmProviderPreset === 'custom'"
            id="settings-llm-custom-provider"
            v-model="settingsLlmCustomProvider"
            class="tool-input"
            placeholder="openai_compatible"
            @keydown="onSettingsInputKeydown"
          />

          <label class="modal-field-label" for="settings-llm-model">Model</label>
          <input id="settings-llm-model" v-model="settingsLlmModel" class="tool-input" placeholder="Model name" @keydown="onSettingsInputKeydown" />

          <label class="modal-field-label" for="settings-llm-base-url">Base URL (optional)</label>
          <input
            id="settings-llm-base-url"
            v-model="settingsLlmBaseUrl"
            class="tool-input"
            placeholder="https://... or http://localhost:11434/v1"
            @keydown="onSettingsInputKeydown"
          />

          <label class="modal-field-label" for="settings-llm-apikey">API key</label>
          <input
            id="settings-llm-apikey"
            v-model="settingsLlmApiKey"
            data-settings-llm-apikey="true"
            class="tool-input"
            type="password"
            :placeholder="settingsLlmHasStoredApiKey ? 'stored key (leave empty to keep)' : 'api key'"
            @keydown="onSettingsInputKeydown"
          />
        </div>

        <div v-else class="settings-tab-panel">
          <label class="modal-field-label settings-checkbox-row">
            <input v-model="settingsEmbeddingsMode" type="radio" value="internal" />
            <span>Internal model (fastembed)</span>
          </label>
          <label class="modal-field-label settings-checkbox-row">
            <input v-model="settingsEmbeddingsMode" type="radio" value="external" />
            <span>External model (API)</span>
          </label>

          <template v-if="settingsEmbeddingsMode === 'external'">
            <label class="modal-field-label" for="settings-emb-provider">Provider</label>
            <select id="settings-emb-provider" v-model="settingsEmbeddingsProvider" class="tool-input">
              <option value="openai">OpenAI</option>
            </select>

            <label class="modal-field-label" for="settings-emb-label">Profile label</label>
            <input id="settings-emb-label" v-model="settingsEmbeddingsLabel" class="tool-input" placeholder="OpenAI Embeddings" @keydown="onSettingsInputKeydown" />

            <label class="modal-field-label" for="settings-emb-model">Model</label>
            <input id="settings-emb-model" v-model="settingsEmbeddingsModel" class="tool-input" placeholder="text-embedding-3-small" @keydown="onSettingsInputKeydown" />

            <label class="modal-field-label" for="settings-emb-base-url">Base URL (optional)</label>
            <input id="settings-emb-base-url" v-model="settingsEmbeddingsBaseUrl" class="tool-input" placeholder="https://..." @keydown="onSettingsInputKeydown" />

            <label class="modal-field-label" for="settings-emb-apikey">API key</label>
            <input
              id="settings-emb-apikey"
              v-model="settingsEmbeddingsApiKey"
              class="tool-input"
              type="password"
              :placeholder="settingsEmbeddingsHasStoredApiKey ? 'stored key (leave empty to keep)' : 'api key'"
              @keydown="onSettingsInputKeydown"
            />
          </template>
        </div>

        <p v-if="settingsModalError" class="modal-input-error">{{ settingsModalError }}</p>
        <div class="confirm-actions">
          <UiButton size="sm" variant="ghost" @click="closeSettingsModal">Close</UiButton>
          <UiButton size="sm" @click="submitSettingsModal">Save</UiButton>
        </div>
      </div>
    </div>

    <div v-if="shortcutsModalVisible" class="modal-overlay" @click.self="closeShortcutsModal">
      <div
        class="modal shortcuts-modal"
        data-modal="shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        aria-describedby="shortcuts-description"
        tabindex="-1"
      >
        <h3 id="shortcuts-title" class="confirm-title">Keyboard Shortcuts</h3>
        <p id="shortcuts-description" class="sr-only">Browse and filter keyboard shortcuts.</p>
        <input
          v-model="shortcutsFilterQuery"
          data-shortcuts-filter="true"
          class="tool-input shortcuts-filter-input"
          placeholder="Filter shortcuts (ex: zoom, save, Ctrl+P)"
        />
        <div class="shortcuts-sections">
          <section v-for="section in filteredShortcutSections" :key="section.title" class="shortcuts-section">
            <h4 class="shortcuts-title">{{ section.title }}</h4>
            <div class="shortcuts-grid">
              <template v-for="item in section.items" :key="`${section.title}-${item.keys}-${item.action}`">
                <span class="shortcut-keys">{{ item.keys }}</span>
                <span class="shortcut-action">{{ item.action }}</span>
              </template>
            </div>
          </section>
          <div v-if="!filteredShortcutSections.length" class="placeholder">No matching shortcuts</div>
        </div>
        <div class="confirm-actions">
          <UiButton size="sm" @click="closeShortcutsModal">Close</UiButton>
        </div>
      </div>
    </div>

    <div v-if="wikilinkRewritePrompt" class="modal-overlay" @click.self="resolveWikilinkRewritePrompt(false)">
      <div
        class="modal confirm-modal"
        data-modal="wikilink-rewrite"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wikilink-rewrite-title"
        aria-describedby="wikilink-rewrite-description"
        tabindex="-1"
      >
        <h3 id="wikilink-rewrite-title" class="confirm-title">Update wikilinks?</h3>
        <p id="wikilink-rewrite-description" class="confirm-text">The file was renamed. Do you want to rewrite matching wikilinks across the workspace?</p>
        <p class="confirm-path"><strong>From:</strong> {{ toRelativePath(wikilinkRewritePrompt.fromPath) }}</p>
        <p class="confirm-path"><strong>To:</strong> {{ toRelativePath(wikilinkRewritePrompt.toPath) }}</p>
        <div class="confirm-actions">
          <UiButton size="sm" variant="ghost" @click="resolveWikilinkRewritePrompt(false)">Keep links</UiButton>
          <UiButton size="sm" @click="resolveWikilinkRewritePrompt(true)">Update links</UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.ide-root.dark .tool-input {
  border-color: #3e4451;
  background: #282c34;
  color: #abb2bf;
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
  margin: 2px 0 10px;
}

.settings-tab-btn {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 12px;
  padding: 6px 10px;
  color: #334155;
}

.settings-tab-btn.active {
  border-color: #60a5fa;
  background: #dbeafe;
  color: #1e3a8a;
}

.settings-tab-panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
}

.settings-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ide-root.dark .settings-tab-btn {
  border-color: #3e4451;
  background: #21252b;
  color: #cbd5e1;
}

.ide-root.dark .settings-tab-btn.active {
  border-color: #61afef;
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
  font-size: 12px;
  color: #475569;
}

.ide-root.dark .confirm-text {
  color: #94a3b8;
}

.ide-root.dark .modal-field-label {
  color: #94a3b8;
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
