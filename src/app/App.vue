<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorPaneGrid, { type EditorPaneGridExposed } from './components/panes/EditorPaneGrid.vue'
import EditorRightPane from '../domains/editor/components/EditorRightPane.vue'
import SidebarSurface from './components/app/SidebarSurface.vue'
import IndexStatusModal from './components/app/IndexStatusModal.vue'
import QuickOpenModal from './components/app/QuickOpenModal.vue'
import ShortcutsModal from './components/app/ShortcutsModal.vue'
import AboutModal from './components/app/AboutModal.vue'
import TopbarNavigationControls from './components/app/TopbarNavigationControls.vue'
import WorkspaceSetupWizardModal from './components/app/WorkspaceSetupWizardModal.vue'
import WikilinkRewriteModal from './components/app/WikilinkRewriteModal.vue'
import WorkspaceEntryModals from './components/app/WorkspaceEntryModals.vue'
import WorkspaceStatusBar from './components/app/WorkspaceStatusBar.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import DesignSystemDebugModal from './components/app/DesignSystemDebugModal.vue'
import { useDocumentHistory } from '../domains/editor/composables/useDocumentHistory'
import {
  clearWorkingFolder,
  createEntry,
  listChildren,
  listMarkdownFiles,
  pathExists,
  readFileMetadata,
  readTextFile,
  renameEntry,
  revealInFileManager,
  setWorkingFolder,
  selectWorkingFolder,
  writeTextFile,
  listenWorkspaceFsChanged
} from '../shared/api/workspaceApi'
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  renameFavorite,
} from '../shared/api/favoritesApi'
import {
  backlinksForPath,
  ftsSearch,
  getWikilinkGraph,
  initDb,
  readIndexLogs,
  readIndexRuntimeStatus,
  readPropertyTypeSchema,
  rebuildWorkspaceIndex,
  removeMarkdownFileFromIndex,
  refreshSemanticEdgesCacheNow,
  requestIndexCancel,
  reindexMarkdownFileLexical,
  reindexMarkdownFileSemantic,
  updateWikilinksForRename,
  writePropertyTypeSchema
} from '../shared/api/indexApi'
import type { WikilinkGraph, WorkspaceFsChange } from '../shared/api/apiTypes'
import {
  bindPendingOpenTrace,
  finishOpenTrace,
  installOpenDebugLongTaskObserver,
  startOpenTrace,
  traceOpenStep
} from '../shared/lib/openTrace'
import { parseSearchSnippet } from '../shared/lib/searchSnippets'
import { type SearchMode } from '../shared/lib/searchMode'
import { hasActiveTextSelectionInEditor, shouldBlockGlobalShortcutsFromTarget } from '../shared/lib/shortcutTargets'
import { parseWikilinkTarget } from '../domains/editor/lib/wikilinks'
import { buildCosmosGraph } from '../domains/cosmos/lib/graphIndex'
import {
  createDeliberationSession,
  loadDeliberationSession,
  replaceSessionContext
} from '../domains/second-brain/lib/secondBrainApi'
import {
  normalizeContextPathsForUpdate,
  toAbsoluteWorkspacePath,
  workspaceScopedSecondBrainSessionKey
} from '../domains/second-brain/lib/secondBrainContextPaths'
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
import {
  extractHeadingsFromMarkdown,
  hasForbiddenEntryNameChars,
  isReservedEntryName,
  markdownExtensionFromPath,
  noteTitleFromPath,
  parentPrefixForModal,
  resolveExistingWikilinkPath,
  sanitizeTitleForFileName
} from './lib/appShellDocuments'
import { formatDurationMs } from './lib/indexActivity'
import {
  readRecentWorkspaces,
  removeRecentWorkspace,
  upsertRecentWorkspace
} from './lib/recentWorkspaces'
import {
  readRecentNotes,
  removeRecentNote,
  renameRecentNote,
  upsertRecentNote,
  writeRecentNotes
} from './lib/recentNotes'
import {
  buildWorkspaceSetupPlan,
  type WorkspaceSetupOption,
  type WorkspaceSetupUseCase
} from './lib/workspaceSetupWizard'
import { useAppIndexingController } from './composables/useAppIndexingController'
import {
  useAppNavigationController,
  type CosmosHistorySnapshot,
  type HomeHistorySnapshot,
  type SecondBrainHistorySnapshot
} from './composables/useAppNavigationController'
import { useAppShellHistoryUi } from './composables/useAppShellHistoryUi'
import { useAppShellCommands } from './composables/useAppShellCommands'
import { useAppShellKeyboard } from './composables/useAppShellKeyboard'
import { useAppShellLaunchpad } from './composables/useAppShellLaunchpad'
import { useAppShellSearch, type AppShellSearchHit } from './composables/useAppShellSearch'
import { useAppModalController } from './composables/useAppModalController'
import { useAppSecondBrainBridge } from './composables/useAppSecondBrainBridge'
import { useAppQuickOpen, type PaletteAction, type QuickOpenResult } from './composables/useAppQuickOpen'
import { useAppTheme, type ThemePreference } from './composables/useAppTheme'
import { useAppWorkspaceController } from './composables/useAppWorkspaceController'
import { useEditorState } from '../domains/editor/composables/useEditorState'
import { useEchoesDiscoverability } from '../domains/echoes/composables/useEchoesDiscoverability'
import { useEchoesPack } from '../domains/echoes/composables/useEchoesPack'
import { useCosmosController } from '../domains/cosmos/composables/useCosmosController'
import { useFilesystemState } from './composables/useFilesystemState'
import { useWorkspaceState, type SidebarMode } from './composables/useWorkspaceState'
import { useFavoritesController } from '../domains/favorites/composables/useFavoritesController'
import type {
  AppShellCosmosViewModel,
  AppShellLaunchpadViewModel,
  AppShellSecondBrainViewModel
} from './lib/appShellViewModels'
import {
  createInitialLayout,
  hydrateLayout,
  serializeLayout,
  useMultiPaneWorkspaceState
} from './composables/useMultiPaneWorkspaceState'
import packageJson from '../../package.json'

type SearchHit = AppShellSearchHit
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
const RECENT_WORKSPACES_STORAGE_KEY = 'tomosona:recent-workspaces'
const MULTI_PANE_STORAGE_KEY = 'tomosona:editor:multi-pane'
const VIEW_MODE_STORAGE_KEY = 'tomosona:view:active'
const PREVIOUS_NON_COSMOS_VIEW_MODE_STORAGE_KEY = 'tomosona:view:last-non-cosmos'

const workspace = useWorkspaceState()
const editorState = useEditorState()
const filesystem = useFilesystemState()
const documentHistory = useDocumentHistory()
const {
  themePreference,
  applyTheme,
  loadThemePreference,
  persistThemePreference,
  onSystemThemeChanged
} = useAppTheme({ storageKey: THEME_STORAGE_KEY })
const isMacOs = typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent)

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
const designSystemDebugVisible = ref(false)
const shortcutsModalVisible = ref(false)
const aboutModalVisible = ref(false)
const workspaceSetupWizardVisible = ref(false)
const workspaceSetupWizardBusy = ref(false)
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
let unlistenWorkspaceFsChanged: (() => void) | null = null
const showDebugTools = import.meta.env.DEV
const appVersion = packageJson.version

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
const workspaceControllerShellPort = {
  workingFolderPath: filesystem.workingFolderPath,
  hasWorkspace: filesystem.hasWorkspace,
  activeFilePath,
  indexingState: filesystem.indexingState,
  errorMessage: filesystem.errorMessage,
  selectedCount: filesystem.selectedCount,
  storageKey: WORKING_FOLDER_STORAGE_KEY,
  setWorkspacePath: (path: string) => filesystem.setWorkspacePath(path),
  clearWorkspacePath: () => filesystem.clearWorkspacePath(),
  resetIndexingState: () => indexing.resetIndexingState()
}

const workspaceControllerFsPort = {
  setWorkingFolder,
  clearWorkingFolder,
  initDb,
  readFileMetadata,
  pathExists,
  listChildren,
  listMarkdownFiles,
  createEntry,
  writeTextFile
}

const workspaceControllerDocumentPort = {
  readPropertyTypeSchema,
  writePropertyTypeSchema,
  normalizePath,
  normalizePathKey,
  isMarkdownPath,
  isIsoDate,
  dailyNotePath
}

const workspaceControllerEffectsPort = {
  enqueueMarkdownReindex: (path: string) => indexing.enqueueMarkdownReindex(path),
  removeMarkdownFromIndexInBackground: (path: string) => indexing.removeMarkdownFromIndexInBackground(path),
  refreshCosmosGraph: () => cosmos.refreshGraph(),
  hasCosmosSurface: () => multiPane.findPaneContainingSurface('cosmos') !== null
}

const workspaceController = useAppWorkspaceController({
  workspaceShellPort: workspaceControllerShellPort,
  workspaceFsPort: workspaceControllerFsPort,
  workspaceDocumentPort: workspaceControllerDocumentPort,
  workspaceEffectsPort: workspaceControllerEffectsPort
})
const {
  allWorkspaceFiles,
  loadingAllFiles,
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
const launchpad = useAppShellLaunchpad({
  storageKey: RECENT_WORKSPACES_STORAGE_KEY,
  workingFolderPath: filesystem.workingFolderPath,
  hasWorkspace: filesystem.hasWorkspace,
  allWorkspaceFiles,
  loadingAllFiles,
  readFileMetadata,
  readRecentWorkspaces,
  upsertRecentWorkspace,
  removeRecentWorkspace,
  readRecentNotes,
  writeRecentNotes,
  upsertRecentNote,
  removeRecentNote,
  renameRecentNote,
  normalizePathKey,
  toRelativePath,
  noteTitleFromPath,
  basenameLabel,
  formatRelativeTime
})
const {
  recentViewedNotes,
  recentUpdatedNotes,
  launchpadRecentWorkspaces,
  launchpadShowWizardAction,
  resetWorkspaceRecentState,
  recordRecentWorkspace,
  removeRecentWorkspaceEntry,
  recordRecentNote,
  removeLaunchpadRecentNote,
  renameLaunchpadRecentNote,
  invalidateRecentNotes,
  dispose: disposeShellLaunchpad
} = launchpad
const favorites = useFavoritesController({
  workingFolderPath: filesystem.workingFolderPath,
  listFavorites,
  addFavorite,
  removeFavorite,
  renameFavorite
})
const indexingControllerShellPort = {
  workingFolderPath: filesystem.workingFolderPath,
  hasWorkspace: filesystem.hasWorkspace,
  indexingState: filesystem.indexingState,
  toRelativePath
}

const indexingControllerApiPort = {
  readIndexLogs,
  readIndexRuntimeStatus,
  requestIndexCancel,
  rebuildWorkspaceIndex,
  reindexMarkdownFileLexical,
  reindexMarkdownFileSemantic,
  refreshSemanticEdgesCacheNow,
  removeMarkdownFileFromIndex
}

const indexingControllerDocumentPort = {
  isMarkdownPath
}

const indexingControllerSurfacePort = {
  refreshBacklinks,
  refreshCosmosGraph: () => cosmos.refreshGraph(),
  hasCosmosSurface: () => multiPane.findPaneContainingSurface('cosmos') !== null
}

const indexingControllerUiEffectsPort = {
  confirmStopCurrentOperation: () => typeof window === 'undefined' || window.confirm('Cancel current indexing run?'),
  notifyInfo: (message: string) => filesystem.notifyInfo(message),
  notifySuccess: (message: string) => filesystem.notifySuccess(message),
  notifyError: (message: string) => filesystem.notifyError(message)
}

const indexing = useAppIndexingController({
  indexingShellPort: indexingControllerShellPort,
  indexingApiPort: indexingControllerApiPort,
  indexingDocumentPort: indexingControllerDocumentPort,
  indexingSurfacePort: indexingControllerSurfacePort,
  indexingUiEffectsPort: indexingControllerUiEffectsPort
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
  aboutModalVisible,
  workspaceSetupWizardVisible,
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
const secondBrainWorkspacePort = {
  workingFolderPath: filesystem.workingFolderPath,
  activeFilePath
}

const secondBrainContextPort = {
  storageKeyForWorkspace: workspaceScopedSecondBrainSessionKey,
  toAbsoluteWorkspacePath,
  normalizeContextPathsForUpdate
}

const secondBrainSessionPort = {
  createDeliberationSession,
  loadDeliberationSession,
  replaceSessionContext
}

const secondBrainUiEffectsPort = {
  errorMessage: filesystem.errorMessage,
  notifySuccess: (message: string) => filesystem.notifySuccess(message)
}

const secondBrainBridge = useAppSecondBrainBridge({
  secondBrainWorkspacePort,
  secondBrainContextPort,
  secondBrainSessionPort,
  secondBrainUiEffectsPort
})
const {
  secondBrainRequestedSessionId,
  secondBrainRequestedSessionNonce,
  secondBrainRequestedPrompt,
  secondBrainRequestedPromptNonce,
  setSecondBrainSessionId,
  setSecondBrainPrompt,
  addActiveNoteToSecondBrain,
  onSecondBrainContextChanged,
  onSecondBrainSessionChanged
} = secondBrainBridge

const search = useAppShellSearch({
  workingFolderPath: filesystem.workingFolderPath,
  allWorkspaceFiles,
  ensureAllFilesLoaded: loadAllFiles,
  toRelativePath,
  ftsSearch,
  notifyError: (message: string) => filesystem.notifyError(message)
})
const {
  searchQuery,
  searchLoading,
  hasSearched,
  groupedSearchResults,
  globalSearchMode,
  showSearchScore,
  resetSearchState,
  runGlobalSearch,
  selectGlobalSearchMode,
  dispose: disposeShellSearch
} = search
const searchModeOptions: Array<{ mode: SearchMode; label: string }> = [
  { mode: 'hybrid', label: 'Hybrid' },
  { mode: 'semantic', label: 'Semantic' },
  { mode: 'lexical', label: 'Lexical' }
]

const paletteActionPriority: Record<string, number> = {
  'open-file': 0,
  'open-workspace': 1,
  'open-home-view': 2,
  'open-favorites': 3,
  'open-today': 4,
  'open-yesterday': 5,
  'open-specific-date': 6,
  'open-cosmos-view': 7,
  'open-second-brain-view': 8,
  'add-active-note-to-second-brain': 9,
  'add-active-note-to-favorites': 10,
  'remove-active-note-from-favorites': 11,
  'open-settings': 12,
  'open-note-in-cosmos': 13,
  'reveal-in-explorer': 14,
  'show-shortcuts': 15,
  'create-new-file': 16,
  'close-other-tabs': 17,
  'close-all-tabs': 18,
  'close-all-tabs-current-pane': 19,
  'split-pane-right': 20,
  'split-pane-down': 21,
  'focus-pane-1': 22,
  'focus-pane-2': 23,
  'focus-pane-3': 24,
  'focus-pane-4': 25,
  'focus-next-pane': 26,
  'move-tab-next-pane': 27,
  'close-active-pane': 28,
  'join-panes': 29,
  'reset-pane-layout': 30,
  'zoom-in': 31,
  'zoom-out': 32,
  'zoom-reset': 33,
  'theme-light': 34,
  'theme-dark': 35,
  'theme-system': 36,
  'close-workspace': 37
}

const paletteActions = computed<PaletteAction[]>(() => [
  {
    id: 'open-home-view',
    label: 'Open Home',
    run: () => openHomeViewFromPalette(),
    closeBeforeRun: true
  },
  {
    id: 'open-favorites',
    label: 'Open Favorites',
    run: () => openFavoritesPanelFromPalette(),
    closeBeforeRun: true
  },
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
  ...(
    activeFilePath.value && isMarkdownPath(activeFilePath.value) && !favorites.isFavorite(activeFilePath.value)
      ? [{
          id: 'add-active-note-to-favorites',
          label: 'Add Active Note to Favorites',
          run: () => addActiveNoteToFavoritesFromPalette()
        } satisfies PaletteAction]
      : []
  ),
  ...(
    activeFilePath.value && isMarkdownPath(activeFilePath.value) && favorites.isFavorite(activeFilePath.value)
      ? [{
          id: 'remove-active-note-from-favorites',
          label: 'Remove Active Note from Favorites',
          run: () => removeActiveNoteFromFavoritesFromPalette()
        } satisfies PaletteAction]
      : []
  ),
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

const quickOpenDataPort = {
  allWorkspaceFiles,
  workingFolderPath: filesystem.workingFolderPath
}

const quickOpenDocumentPort = {
  isIsoDate,
  toRelativePath,
  dailyNotePath
}

const quickOpenPalettePort = {
  paletteActions,
  paletteActionPriority
}

const {
  quickOpenIsActionMode,
  quickOpenActionResults,
  quickOpenResults,
  quickOpenItemCount,
  moveQuickOpenSelection,
  setQuickOpenActiveIndex,
  resetQuickOpenState
} = useAppQuickOpen({
  quickOpenDataPort,
  quickOpenDocumentPort,
  quickOpenPalettePort,
  quickOpenQuery,
  quickOpenActiveIndex
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
        { keys: backShortcutLabel.value, action: 'Back in history' },
        { keys: forwardShortcutLabel.value, action: 'Forward in history' },
        { keys: `${mod}+D`, action: 'Open today note' },
        { keys: `${mod}+Shift+H`, action: 'Open Home' },
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
    const label = activeTab.type === 'home'
      ? 'Home'
      : activeTab.type === 'cosmos'
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
const cosmosPaneViewModel = computed<AppShellCosmosViewModel>(() => ({
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
  selectedNode: cosmosSelectedNodeForPanel.value,
  selectedLinkCount: cosmos.selectedLinkCount.value,
  preview: cosmos.preview.value,
  previewLoading: cosmos.previewLoading.value,
  previewError: cosmos.previewError.value,
  outgoingNodes: cosmos.outgoingNodes.value,
  incomingNodes: cosmos.incomingNodes.value
}))
const secondBrainPaneViewModel = computed<AppShellSecondBrainViewModel>(() => ({
  workspacePath: filesystem.workingFolderPath.value,
  allWorkspaceFiles: allWorkspaceFiles.value,
  requestedSessionId: secondBrainRequestedSessionId.value,
  requestedSessionNonce: secondBrainRequestedSessionNonce.value,
  requestedPrompt: secondBrainRequestedPrompt.value,
  requestedPromptNonce: secondBrainRequestedPromptNonce.value,
  activeNotePath: activeFilePath.value
}))
const launchpadPaneViewModel = computed<AppShellLaunchpadViewModel>(() => ({
  workspaceLabel: filesystem.workingFolderPath.value ? basenameLabel(filesystem.workingFolderPath.value) : '',
  recentWorkspaces: launchpadRecentWorkspaces.value,
  recentViewedNotes: recentViewedNotes.value,
  recentUpdatedNotes: recentUpdatedNotes.value,
  showWizardAction: launchpadShowWizardAction.value
}))

const mediaQuery = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

const backShortcutLabel = computed(() => (isMacOs ? 'Cmd+[' : 'Alt+Left'))
const forwardShortcutLabel = computed(() => (isMacOs ? 'Cmd+]' : 'Alt+Right'))
const homeShortcutLabel = computed(() => (isMacOs ? 'Cmd+Shift+H' : 'Ctrl+Shift+H'))
const commandPaletteShortcutLabel = computed(() => (isMacOs ? 'Cmd+Shift+P' : 'Ctrl+Shift+P'))
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

function loadSavedSidebarMode() {
  const saved = window.sessionStorage.getItem(VIEW_MODE_STORAGE_KEY)
  if (saved === 'explorer' || saved === 'favorites' || saved === 'search') {
    workspace.sidebarMode.value = saved
  }
  const savedPrevious = window.sessionStorage.getItem(PREVIOUS_NON_COSMOS_VIEW_MODE_STORAGE_KEY)
  if (savedPrevious === 'explorer' || savedPrevious === 'favorites' || savedPrevious === 'search') {
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
  if (current === 'search' || current === 'favorites' || current === 'explorer') return current
  return 'explorer'
}

function formatSearchScore(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(3)
}

function basenameLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const last = normalized.split('/').filter(Boolean).pop()
  return last || path
}

function formatRelativeTime(tsMs: number | null, prefix = ''): string {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs) || tsMs <= 0) {
    return prefix ? `${prefix} recently` : 'recently'
  }
  const deltaMs = tsMs - Date.now()
  const absMs = Math.abs(deltaMs)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['week', 7 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ]
  for (const [unit, size] of units) {
    if (absMs >= size || unit === 'minute') {
      const value = Math.round(deltaMs / size)
      const label = rtf.format(value, unit)
      return prefix ? `${prefix} ${label}` : label
    }
  }
  return prefix ? `${prefix} just now` : 'just now'
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
  return normalized === '' || normalized === titleLine
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

function openAboutModal() {
  rememberFocusBeforeModalOpen()
  aboutModalVisible.value = true
}

function closeAboutModal() {
  aboutModalVisible.value = false
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
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

function openAboutFromOverflow() {
  closeOverflowMenu()
  openAboutModal()
}

function openSettingsFromOverflow() {
  closeOverflowMenu()
  void openSettingsModal()
}

function openDesignSystemDebugFromOverflow() {
  if (!showDebugTools) return
  closeOverflowMenu()
  rememberFocusBeforeModalOpen()
  designSystemDebugVisible.value = true
}

function closeDesignSystemDebugModal() {
  designSystemDebugVisible.value = false
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
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

function readHomeHistorySnapshot(payload: unknown): HomeHistorySnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as { surface?: string }
  if (value.surface !== 'hub') return null
  return { surface: 'hub' }
}

function currentHomeHistorySnapshot(): HomeHistorySnapshot {
  return { surface: 'hub' }
}

function homeSnapshotStateKey(snapshot: HomeHistorySnapshot): string {
  return snapshot.surface
}

function homeHistoryLabel(_snapshot: HomeHistorySnapshot): string {
  return 'Home'
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

async function openHomeHistorySnapshot(_snapshot: HomeHistorySnapshot): Promise<boolean> {
  multiPane.openSurfaceInPane('home')
  return true
}

const navigationWorkspacePort = {
  hasWorkspace: filesystem.hasWorkspace,
  allWorkspaceFiles,
  setErrorMessage: (message: string) => {
    filesystem.errorMessage.value = message
  },
  toRelativePath,
  ensureAllFilesLoaded: loadAllFiles,
  recordRecentNote
}

const navigationEditorPort = {
  activeFilePath,
  saveActiveDocument: async () => {
    await editorRef.value?.saveNow()
  },
  focusEditor: () => {
    editorRef.value?.focusEditor()
  },
  getDocumentStatus: (path: string) => editorState.getStatus(path)
}

const navigationPanePort = {
  getActiveTab: () => multiPane.getActiveTab(),
  getActiveDocumentPath: (paneId?: string) => multiPane.getActiveDocumentPath(paneId),
  getActivePaneId: () => multiPane.layout.value.activePaneId,
  getPaneOrder: () => multiPane.paneOrder.value,
  getDocumentPathsForPane: (paneId: string) => documentPathsForPane(paneId),
  openPathInPane: (path: string, paneId?: string) => multiPane.openPathInPane(path, paneId),
  revealDocumentInPane: (path: string, paneId?: string) => multiPane.revealDocumentInPane(path, paneId),
  setActivePathInPane: (paneId: string, path: string) => multiPane.setActivePathInPane(paneId, path),
  openSurfaceInPane: (type: 'home' | 'cosmos' | 'second-brain-chat', paneId?: string) => multiPane.openSurfaceInPane(type, paneId),
  findPaneContainingSurface: (type: 'home' | 'cosmos' | 'second-brain-chat') => multiPane.findPaneContainingSurface(type)
}

const navigationHistoryPort = {
  documentHistory,
  cosmos: {
    read: readCosmosHistorySnapshot,
    current: currentCosmosHistorySnapshot,
    stateKey: cosmosSnapshotStateKey,
    label: cosmosHistoryLabel,
    apply: applyCosmosHistorySnapshot
  },
  home: {
    read: readHomeHistorySnapshot,
    current: currentHomeHistorySnapshot,
    stateKey: homeSnapshotStateKey,
    label: homeHistoryLabel,
    open: openHomeHistorySnapshot
  },
  secondBrain: {
    read: readSecondBrainHistorySnapshot,
    current: currentSecondBrainHistorySnapshot,
    stateKey: secondBrainSnapshotStateKey,
    label: secondBrainHistoryLabel,
    open: openSecondBrainHistorySnapshot
  }
}

const navigation = useAppNavigationController({
  workspacePort: navigationWorkspacePort,
  editorPort: navigationEditorPort,
  panePort: navigationPanePort,
  historyPort: navigationHistoryPort
})
const {
  isApplyingHistoryNavigation,
  historyTargetLabel,
  recordHomeHistorySnapshot,
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
const historyUi = useAppShellHistoryUi({
  topbarPort: {
    getHistoryButtonEl: (side) => topbarRef.value?.getHistoryButtonEl(side) ?? null,
    containsOverflowTarget: (target) => topbarRef.value?.containsOverflowTarget(target) ?? false,
    containsHistoryMenuTarget: (side, target) => topbarRef.value?.containsHistoryMenuTarget(side, target) ?? false
  },
  closeOverflowMenu,
  canOpenMenu: (side) => side === 'back' ? documentHistory.canGoBack.value : documentHistory.canGoForward.value,
  getTargetCount: (side) => side === 'back'
    ? documentHistory.backTargets.value.length
    : documentHistory.forwardTargets.value.length
})
const {
  historyMenuOpen,
  historyMenuStyle,
  closeHistoryMenu,
  onHistoryButtonPointerDown,
  cancelHistoryLongPress,
  onHistoryButtonContextMenu,
  shouldConsumeHistoryButtonClick,
  onWindowResize,
  onGlobalPointerDown: onGlobalPointerDownInternal,
  dispose: disposeHistoryUi
} = historyUi
const commands = useAppShellCommands({
  workspacePort: {
    hasWorkspace: filesystem.hasWorkspace,
    activeFilePath,
    allWorkspaceFiles,
    previousNonCosmosMode,
    setSidebarMode: (mode) => workspace.setSidebarMode(mode),
    persistSidebarMode,
    persistPreviousNonCosmosMode,
    notifyError: (message) => filesystem.notifyError(message),
    notifySuccess: (message) => filesystem.notifySuccess(message)
  },
  documentPort: {
    isMarkdownPath,
    normalizePathKey,
    toRelativePath,
    clearEditorStatusForPaths,
    resetActiveOutline: () => editorState.setActiveOutline([])
  },
  panePort: {
    activePaneId: computed(() => multiPane.layout.value.activePaneId),
    panesById: computed(() => multiPane.layout.value.panesById),
    openSurfaceInPane: (type) => multiPane.openSurfaceInPane(type),
    splitPane: (paneId, axis) => multiPane.splitPane(paneId, axis),
    setActivePane: (paneId) => multiPane.setActivePane(paneId),
    focusPaneByIndex: (index) => multiPane.focusPaneByIndex(index),
    focusAdjacentPane: (direction) => multiPane.focusAdjacentPane(direction),
    moveActiveTabToAdjacentPane: (direction) => multiPane.moveActiveTabToAdjacentPane(direction),
    closePane: (paneId) => multiPane.closePane(paneId),
    joinAllPanes: () => multiPane.joinAllPanes(),
    resetToSinglePane: () => multiPane.resetToSinglePane(),
    closeAllTabsAndResetLayout: () => multiPane.closeAllTabsAndResetLayout(),
    closeAllTabsInPane: (paneId) => multiPane.closeAllTabsInPane(paneId),
    closeOtherTabsInPane: (paneId, tabId) => multiPane.closeOtherTabsInPane(paneId, tabId)
  },
  navigationPort: {
    openTabWithAutosave,
    recordHomeHistorySnapshot,
    recordSecondBrainHistorySnapshot,
    recordCosmosHistorySnapshot
  },
  favoritesPort: {
    isFavorite: (path) => favorites.isFavorite(path),
    addFavorite: (path) => favorites.addFavorite(path),
    removeFavorite: (path) => favorites.removeFavorite(path)
  },
  cosmosPort: {
    graph: cosmos.graph,
    error: cosmos.error,
    refreshGraph: () => cosmos.refreshGraph(),
    selectNode: (nodeId) => cosmos.selectNode(nodeId)
  },
  actionPort: {
    loadAllFiles,
    addActiveNoteToSecondBrain,
    openSettingsModal,
    openQuickOpen,
    openTodayNote,
    openWorkspacePicker: onSelectWorkingFolder,
    closeWorkspace,
    revealInFileManager,
    closeOverflowMenu,
    focusSearchInput: () => {
      document.querySelector<HTMLInputElement>('[data-search-input="true"]')?.focus()
    },
    scheduleCosmosNodeFocus
  }
})
const {
  openCosmosViewFromPalette,
  openSecondBrainViewFromPalette,
  openHomeViewFromPalette,
  openFavoritesPanelFromPalette,
  addActiveNoteToSecondBrainFromPalette,
  addActiveNoteToFavoritesFromPalette,
  removeActiveNoteFromFavoritesFromPalette,
  removeFavoriteFromList,
  toggleActiveNoteFavoriteFromRightPane,
  openSettingsFromPalette,
  openNoteInCosmosFromPalette,
  openSearchPanel,
  openFavoriteFromSidebar,
  revealActiveInExplorer,
  openCommandPalette,
  runLaunchpadQuickStart,
  closeAllTabsFromPalette,
  closeAllTabsOnCurrentPaneFromPalette,
  openWorkspaceFromPalette,
  closeWorkspaceFromPalette,
  closeOtherTabsFromPalette,
  splitPaneFromPalette,
  focusPaneFromPalette,
  focusNextPaneFromPalette,
  moveTabToNextPaneFromPalette,
  closeActivePaneFromPalette,
  joinPanesFromPalette,
  resetPaneLayoutFromPalette
} = commands
const keyboard = useAppShellKeyboard({
  isMacOs,
  statePort: {
    quickOpenVisible,
    quickOpenIsActionMode,
    historyMenuOpen,
    overflowMenuOpen,
    wikilinkRewriteVisible: computed(() => Boolean(wikilinkRewritePrompt.value)),
    newFileModalVisible,
    newFolderModalVisible,
    openDateModalVisible,
    settingsModalVisible,
    designSystemDebugVisible,
    aboutModalVisible,
    shortcutsModalVisible,
    workspaceSetupWizardVisible,
    indexStatusModalVisible,
    cosmosCommandLoadingVisible
  },
  guardsPort: {
    hasBlockingModalOpen,
    trapTabWithinActiveModal,
    shouldBlockGlobalShortcutsFromTarget,
    hasActiveTextSelectionInEditor
  },
  actionsPort: {
    resolveWikilinkRewritePrompt,
    closeNewFileModal,
    closeNewFolderModal,
    closeOpenDateModal,
    closeSettingsModal,
    closeDesignSystemDebugModal,
    closeAboutModal,
    closeShortcutsModal,
    closeWorkspaceSetupWizard,
    closeIndexStatusModal,
    moveQuickOpenSelection,
    onQuickOpenEnter,
    closeHistoryMenu,
    closeOverflowMenu,
    closeQuickOpen,
    goBackInHistory,
    goForwardInHistory,
    closeActiveTab,
    openQuickOpen,
    openCommandPalette,
    openTodayNote,
    openHomeView: openHomeViewFromPalette,
    splitPane: splitPaneFromPalette,
    focusPane: focusPaneFromPalette,
    moveActiveTabToAdjacentPane: (direction) => multiPane.moveActiveTabToAdjacentPane(direction),
    openNextTab: openNextTabWithAutosave,
    openSearchPanel,
    showExplorerForActiveFile,
    toggleSidebar: () => workspace.toggleSidebar(),
    toggleRightPane: () => workspace.toggleRightPane(),
    saveActiveTab
  }
})

function scheduleCosmosNodeFocus(nodeId: string, remainingAttempts = 12) {
  if (!nodeId || remainingAttempts <= 0) return
}

function onGlobalPointerDown(event: MouseEvent) {
  onGlobalPointerDownInternal(event, overflowMenuOpen.value)
}

function onHistoryButtonClick(side: 'back' | 'forward') {
  if (shouldConsumeHistoryButtonClick(side)) {
    return
  }
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

function setThemeFromOverflow(next: ThemePreference) {
  themePreference.value = next
  closeOverflowMenu()
}

function setThemeFromPalette(next: ThemePreference) {
  themePreference.value = next
  return true
}

async function openPulseContextInSecondBrain(payload: {
  contextPaths: string[]
  prompt?: string
}) {
  if (!filesystem.hasWorkspace.value) {
    filesystem.errorMessage.value = 'Open a workspace first.'
    return false
  }

  const normalized = normalizeContextPathsForUpdate(filesystem.workingFolderPath.value, payload.contextPaths)
  const seedPath = normalized[0] || activeFilePath.value
  if (!seedPath) {
    filesystem.errorMessage.value = 'No note context available for Second Brain.'
    return false
  }

  try {
    const sessionId = await secondBrainBridge.resolveSecondBrainSessionForPath(seedPath)
    await replaceSessionContext(sessionId, normalized)

    setSecondBrainSessionId(sessionId, { bumpNonce: true })
    setSecondBrainPrompt(payload.prompt?.trim() ?? '', { bumpNonce: true })
    await openSecondBrainViewFromPalette()
    return true
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not open Second Brain with Pulse context.'
    return false
  }
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

async function closeWorkspace() {
  if (!filesystem.hasWorkspace.value) return
  multiPane.resetToSinglePane()
  multiPane.closeAllTabsInPane(multiPane.layout.value.activePaneId)
  documentHistory.reset()
  editorState.setActiveOutline([])
  resetSearchState()
  backlinks.value = []
  backlinksLoading.value = false
  semanticLinks.value = []
  semanticLinksLoading.value = false
  favorites.reset()
  cosmos.clearState()
  resetWorkspaceRecentState()
  await closeWorkspaceInternal()
  closeOverflowMenu()
}

function closeWorkspaceSetupWizard() {
  workspaceSetupWizardVisible.value = false
  workspaceSetupWizardBusy.value = false
  void nextTick(() => {
    restoreFocusAfterModalClose()
  })
}

async function openWorkspaceSetupWizard() {
  rememberFocusBeforeModalOpen()
  workspaceSetupWizardVisible.value = true
  workspaceSetupWizardBusy.value = false
  await nextTick()
}

async function ensureRelativeFolder(relativePath: string) {
  const root = filesystem.workingFolderPath.value
  if (!root) throw new Error('Working folder is not set.')
  const normalized = sanitizeRelativePath(relativePath)
  if (!normalized) return
  const parentPath = await ensureParentDirectoriesForRelativePath(normalized)
  const targetPath = `${parentPath}/${normalized.split('/').filter(Boolean).pop() ?? ''}`
  if (await pathExists(targetPath)) return
  await createEntry(parentPath, normalized.split('/').filter(Boolean).pop() ?? normalized, 'folder', 'fail')
}

async function applyWorkspaceSetupWizard(payload: {
  useCase: WorkspaceSetupUseCase
  options: WorkspaceSetupOption[]
}) {
  workspaceSetupWizardBusy.value = true
  try {
    if (!filesystem.hasWorkspace.value) {
      const selectedPath = await selectWorkingFolder()
      if (!selectedPath) {
        workspaceSetupWizardBusy.value = false
        return
      }
      await loadWorkingFolder(selectedPath)
      if (!filesystem.hasWorkspace.value) {
        workspaceSetupWizardBusy.value = false
        return
      }
    }

    const plan = buildWorkspaceSetupPlan(payload.useCase, payload.options)
    for (const entry of plan) {
      if (entry.kind === 'folder') {
        await ensureRelativeFolder(entry.path)
        continue
      }
      const root = filesystem.workingFolderPath.value
      if (!root) throw new Error('Working folder is not set.')
      const fullPath = `${root}/${entry.path}`
      if (await pathExists(fullPath)) continue
      await ensureParentFolders(fullPath)
      await writeTextFile(fullPath, '')
      upsertWorkspaceFilePath(fullPath)
      enqueueMarkdownReindex(fullPath)
    }

    await loadAllFiles()
    invalidateRecentNotes()
    filesystem.notifySuccess('Workspace starter structure created.')
    closeWorkspaceSetupWizard()
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not create starter structure.'
    workspaceSetupWizardBusy.value = false
  }
}

async function openRecentWorkspace(path: string) {
  filesystem.errorMessage.value = ''
  await loadWorkingFolder(path)
  if (!filesystem.hasWorkspace.value) {
    removeRecentWorkspaceEntry(path)
    filesystem.errorMessage.value = filesystem.errorMessage.value || 'Could not reopen that workspace.'
  }
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
    resetSearchState()
    favorites.reset()
    return
  }

  recordRecentWorkspace(canonical)
  resetSearchState()
  invalidateRecentNotes()
  try {
    await favorites.loadFavorites()
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not load favorites.'
  }
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

function onExplorerPathsDeleted(paths: string[]) {
  for (const path of paths) {
    favorites.markFavoriteMissing(path)
    removeLaunchpadRecentNote(path)
  }
}

async function onExplorerOpen(path: string) {
  const traceId = startOpenTrace(path, 'explorer-click')
  bindPendingOpenTrace(path, traceId)
  traceOpenStep(traceId, 'explorer open requested')
  const opened = await openTabWithAutosave(path, { traceId })
  if (!opened) {
    finishOpenTrace(traceId, 'blocked', { stage: 'navigation' })
  }
  if (!opened) return
}

function syncFavoritesForWorkspaceChanges(changes: WorkspaceFsChange[]) {
  for (const change of changes) {
    if (change.kind !== 'renamed' || !change.old_path || !change.new_path) continue
    void favorites.renameFavorite(change.old_path, change.new_path).catch((err) => {
      filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
    })
  }
}

function syncViewedNotesForWorkspaceChanges(changes: WorkspaceFsChange[]) {
  for (const change of changes) {
    if (change.kind === 'removed' && change.path) {
      removeLaunchpadRecentNote(change.path)
      continue
    }
    if (change.kind === 'renamed' && change.old_path && change.new_path) {
      renameLaunchpadRecentNote(change.old_path, change.new_path)
    }
  }
}

async function openFile(path: string) {
  if (!filesystem.workingFolderPath.value) {
    throw new Error('Working folder is not set.')
  }
  const virtual = virtualDocs.value[path]
  if (virtual) return virtual.content
  return await readTextFile(path)
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
  renameLaunchpadRecentNote(fromPath, toPath)

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
  void favorites.renameFavorite(payload.from, payload.to).catch((err) => {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
  })
  void maybeRewriteWikilinksForRename(payload.from, payload.to)
}

function onExplorerPathRenamed(payload: { from: string; to: string }) {
  applyPathRenameLocally(payload)
  void favorites.renameFavorite(payload.from, payload.to).catch((err) => {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update favorite.'
  })
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
      content: '',
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

function onGlobalSearchModeSelect(mode: SearchMode) {
  const next = selectGlobalSearchMode(mode)
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

function closeActiveTab() {
  const paneId = multiPane.layout.value.activePaneId
  const pane = multiPane.layout.value.panesById[paneId]
  const tab = pane?.openTabs.find((item) => item.id === pane.activeTabId)
  if (!tab) return
  multiPane.closeTabInPane(paneId, tab.id)
  if (tab.type === 'document') {
    editorState.clearStatus(tab.path)
  }
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
  const target = mode === 'search' ? 'search' : mode === 'favorites' ? 'favorites' : 'explorer'
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
        !designSystemDebugVisible.value &&
        !shortcutsModalVisible.value &&
        !workspaceSetupWizardVisible.value &&
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
  return parentPrefixForModal(activePath.replace(/\/[^/]+$/, ''), root)
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
  const prefill = parentPrefixForModal(payload.parentPath, filesystem.workingFolderPath.value)
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
  if (parts.some((part) => hasForbiddenEntryNameChars(part))) {
    newFileModalError.value = 'File names cannot include < > : " \\ | ? *'
    return false
  }

  const rawName = parts[parts.length - 1]
  const stem = rawName.replace(/\.(md|markdown)$/i, '')
  if (!stem) {
    newFileModalError.value = 'File name is required.'
    return false
  }
  if (isReservedEntryName(stem)) {
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
  if (parts.some((part) => hasForbiddenEntryNameChars(part))) {
    newFolderModalError.value = 'Folder names cannot include < > : " \\ | ? *'
    return false
  }

  const name = parts[parts.length - 1]
  if (!name) {
    newFolderModalError.value = 'Folder name is required.'
    return false
  }
  if (isReservedEntryName(name)) {
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
    resetWorkspaceRecentState()
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
  installOpenDebugLongTaskObserver()
  mediaQuery?.addEventListener('change', onSystemThemeChanged)
  window.addEventListener('mousedown', onGlobalPointerDown, true)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', stopResize)
  void listenWorkspaceFsChanged((payload) => {
    const root = filesystem.workingFolderPath.value
    if (!root) return
    if (normalizePath(payload.root).toLowerCase() !== normalizePath(root).toLowerCase()) return
    applyWorkspaceFsChanges(payload.changes)
    favorites.applyWorkspaceFsChanges(payload.changes)
    syncFavoritesForWorkspaceChanges(payload.changes)
    syncViewedNotesForWorkspaceChanges(payload.changes)
    if (payload.changes.some((change) => change.kind === 'modified' || change.kind === 'created' || change.kind === 'removed' || change.kind === 'renamed')) {
      invalidateRecentNotes()
    }
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
  disposeShellSearch()
  disposeShellLaunchpad()
  disposeHistoryUi()
  keyboard.dispose()
  mediaQuery?.removeEventListener('change', onSystemThemeChanged)
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
  <div class="ide-root" :class="{ 'macos-overlay': isMacOs }">
    <TopbarNavigationControls
      ref="topbarRef"
      :can-go-back="documentHistory.canGoBack.value"
      :can-go-forward="documentHistory.canGoForward.value"
      :back-shortcut-label="backShortcutLabel"
      :forward-shortcut-label="forwardShortcutLabel"
      :home-shortcut-label="homeShortcutLabel"
      :command-palette-shortcut-label="commandPaletteShortcutLabel"
      :has-workspace="filesystem.hasWorkspace.value"
      :sidebar-visible="workspace.sidebarVisible.value"
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
      :show-debug-tools="showDebugTools"
      @history-button-click="onHistoryButtonClick"
      @history-button-context-menu="onHistoryButtonContextMenu"
      @history-button-pointer-down="onHistoryButtonPointerDown"
      @history-long-press-cancel="cancelHistoryLongPress"
      @history-target-click="onHistoryTargetClick"
      @open-today="void openHomeViewFromPalette()"
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
      @toggle-sidebar="workspace.toggleSidebar()"
      @toggle-right-pane="workspace.toggleRightPane()"
      @toggle-overflow="toggleOverflowMenu"
      @open-command-palette="openCommandPalette"
      @open-shortcuts="openShortcutsFromOverflow"
      @open-about="openAboutFromOverflow"
      @open-settings="openSettingsFromOverflow"
      @open-design-system-debug="openDesignSystemDebugFromOverflow"
      @rebuild-index="void rebuildIndexFromOverflow()"
      @close-workspace="closeWorkspace"
      @zoom-in="zoomInFromOverflow"
      @zoom-out="zoomOutFromOverflow"
      @reset-zoom="resetZoomFromOverflow"
      @set-theme="setThemeFromOverflow"
    />

    <div class="body-row">
      <SidebarSurface
        ref="explorerRef"
        :sidebar-visible="workspace.sidebarVisible.value"
        :sidebar-mode="workspace.sidebarMode.value"
        :working-folder-path="filesystem.workingFolderPath.value"
        :has-workspace="filesystem.hasWorkspace.value"
        :left-pane-width="leftPaneWidth"
        :active-file-path="activeFilePath"
        :favorite-items="favorites.items.value"
        :favorites-loading="favorites.loading.value"
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
        @explorer-paths-deleted="onExplorerPathsDeleted"
        @explorer-request-create="onExplorerRequestCreate"
        @explorer-selection="onExplorerSelection"
        @explorer-error="onExplorerError"
        @favorites-open="openFavoriteFromSidebar"
        @favorites-remove="removeFavoriteFromList"
        @select-working-folder="void onSelectWorkingFolder()"
        @update-search-query="searchQuery = $event"
        @run-global-search="runGlobalSearch"
        @select-global-search-mode="onGlobalSearchModeSelect"
        @open-search-result="onSearchResultOpen"
      />

      <section class="workspace-column">
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
              :cosmos="cosmosPaneViewModel"
              :second-brain="secondBrainPaneViewModel"
              :launchpad="launchpadPaneViewModel"
              @pane-focus="multiPane.setActivePane($event.paneId)"
              @pane-tab-click="void onPaneTabClick($event)"
              @pane-tab-close="onPaneTabClose($event)"
              @pane-tab-close-others="onPaneTabCloseOthers($event)"
              @pane-tab-close-all="onPaneTabCloseAll($event)"
              @pane-request-move-tab="multiPane.moveActiveTabToAdjacentPane($event.direction)"
              @open-note="void openNoteFromSecondBrain($event)"
              @pulse-open-second-brain="void openPulseContextInSecondBrain($event)"
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
              @launchpad-open-workspace="void onSelectWorkingFolder()"
              @launchpad-open-wizard="void openWorkspaceSetupWizard()"
              @launchpad-open-command-palette="openCommandPalette"
              @launchpad-open-shortcuts="openShortcutsModal"
              @launchpad-open-recent-workspace="void openRecentWorkspace($event)"
              @launchpad-open-today="void openTodayNote()"
              @launchpad-open-quick-open="void openQuickOpen()"
              @launchpad-create-note="void createNewFileFromPalette()"
              @launchpad-open-recent-note="void onExplorerOpen($event)"
              @launchpad-quick-start="void runLaunchpadQuickStart($event)"
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
            :active-note-path="activeFilePath"
            :can-toggle-favorite="Boolean(activeFilePath && isMarkdownPath(activeFilePath))"
            :is-favorite="Boolean(activeFilePath && favorites.isFavorite(activeFilePath))"
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
            @toggle-favorite="void toggleActiveNoteFavoriteFromRightPane()"
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

    <WorkspaceSetupWizardModal
      :visible="workspaceSetupWizardVisible"
      :busy="workspaceSetupWizardBusy"
      @cancel="closeWorkspaceSetupWizard"
      @submit="void applyWorkspaceSetupWizard($event)"
    />

    <SettingsModal
      :visible="settingsModalVisible"
      @cancel="closeSettingsModal"
      @saved="onSettingsSaved"
    />

    <DesignSystemDebugModal
      :visible="designSystemDebugVisible"
      @close="closeDesignSystemDebugModal"
    />

    <ShortcutsModal
      :visible="shortcutsModalVisible"
      :filter-query="shortcutsFilterQuery"
      :sections="filteredShortcutSections"
      @close="closeShortcutsModal"
      @update:filter-query="shortcutsFilterQuery = $event"
    />

    <AboutModal
      :visible="aboutModalVisible"
      :version="appVersion"
      @close="closeAboutModal"
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
  background: var(--app-bg);
  color: var(--text-main);
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
  background: var(--tab-strip-bg);
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-right: 1px solid var(--tab-border);
  border-bottom: 2px solid transparent;
  background: var(--tab-bg);
  color: var(--tab-text);
  min-width: 140px;
  max-width: 220px;
  padding: 0 12px;
  font-size: 12px;
}

.tab-item.active {
  border: 1px solid var(--tab-active-border);
  border-bottom-color: var(--tab-active-bottom);
  background: var(--tab-active-bg);
  color: var(--tab-active-text);
  font-weight: 600;
  margin-bottom: -1px;
}

.tab-item:not(.active):hover {
  color: var(--tab-hover-text);
  background: var(--tab-hover-bg);
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
  color: var(--text-soft);
  font-size: 12px;
}

.toolbar-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    box-shadow 140ms ease,
    transform 90ms ease;
}

.toolbar-icon-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--border-strong) 82%, transparent);
  background: color-mix(in srgb, var(--surface-bg) 62%, var(--accent-soft));
  color: var(--menu-text-strong);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 50%, transparent);
}

.toolbar-icon-btn:active:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border-strong));
  background: color-mix(in srgb, var(--accent-soft) 76%, var(--surface-bg));
  color: var(--text-main);
  transform: translateY(1px);
}

.toolbar-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}

.toolbar-icon-btn.active {
  border-color: var(--button-active-border);
  background: var(--button-active-bg);
  color: var(--button-active-text);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 55%, transparent);
}

.toolbar-icon-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
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

.tool-input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--input-border);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--input-text);
  padding: 0 8px;
  font-size: 12px;
}

.tool-input:disabled {
  background: var(--modal-disabled-bg);
  color: var(--modal-disabled-text);
  cursor: not-allowed;
}

.tool-input::placeholder {
  color: var(--input-placeholder);
}

.splitter {
  width: 8px;
  flex: 0 0 8px;
  position: relative;
  cursor: col-resize;
  background: var(--shell-chrome-bg);
}

.splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--shell-splitter);
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

.center-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--surface-bg);
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
  border-color: var(--toast-error-border);
  background: var(--toast-error-bg);
  color: var(--toast-error-text);
}

.toast-success {
  border-color: var(--toast-success-border);
  background: var(--toast-success-bg);
  color: var(--toast-success-text);
}

.toast-info {
  border-color: var(--toast-info-border);
  background: var(--toast-info-bg);
  color: var(--toast-info-text);
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
  background: var(--modal-backdrop);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 60;
}

.modal {
  width: min(760px, calc(100vw - 32px));
  border: 1px solid var(--modal-border);
  background: var(--modal-bg);
  border-radius: var(--modal-radius);
  padding: 10px;
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
  border: 1px solid var(--modal-tab-border);
  border-bottom-color: transparent;
  background: var(--modal-tab-bg);
  border-radius: 8px 8px 0 0;
  font-size: 12px;
  padding: 6px 10px;
  color: var(--text-soft);
}

.settings-tab-btn.active {
  border-color: var(--modal-tab-active-border);
  border-bottom-color: var(--modal-tab-active-bg);
  background: var(--modal-tab-active-bg);
  color: var(--modal-tab-active-text);
  position: relative;
  z-index: 1;
}

.settings-tab-panel {
  border: 1px solid var(--modal-panel-border);
  border-top: 0;
  border-radius: 0 8px 8px 8px;
  padding: 12px;
  background: var(--modal-panel-bg);
}

.settings-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cosmos-command-loading-track {
  margin-top: 6px;
  height: 8px;
  width: 100%;
  border-radius: 999px;
  overflow: hidden;
  background: var(--editor-progress-track);
}

.cosmos-command-loading-bar {
  height: 100%;
  width: 42%;
  border-radius: 999px;
  background-image: linear-gradient(90deg, var(--editor-progress-fill) 0%, var(--editor-progress-fill-2) 50%, var(--editor-progress-fill) 100%);
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
  color: var(--modal-title);
}

.confirm-text {
  margin: 10px 0 12px;
  font-size: 13px;
  color: var(--modal-copy);
}

.modal-field-label {
  display: block;
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--modal-copy);
}

.modal-field-hint {
  margin: 6px 0 10px;
  font-size: 11px;
  color: var(--modal-copy);
}

.settings-model-group {
  margin: 0 0 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 8px;
  background: var(--modal-group-bg);
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
  color: var(--text-soft);
  background: var(--modal-muted-btn-bg);
  cursor: pointer;
  white-space: nowrap;
}

.settings-discover-btn:hover:not(:disabled) {
  background: var(--modal-muted-btn-hover);
  color: var(--text-main);
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
  color: var(--text-dim);
}

.settings-footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-cancel-btn {
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}

.settings-cancel-btn:hover {
  color: var(--text-main);
}

.modal-input-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--modal-danger-text);
}

.confirm-path {
  margin: 4px 0;
  font-size: 12px;
  color: var(--text-soft);
}

.confirm-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.placeholder {
  color: var(--modal-placeholder);
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

</style>
