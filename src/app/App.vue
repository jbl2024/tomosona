<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorPaneGrid, { type EditorPaneGridExposed } from './components/panes/EditorPaneGrid.vue'
import EditorRightPane from '../domains/editor/components/EditorRightPane.vue'
import SidebarSurface from './components/app/SidebarSurface.vue'
import IndexStatusModal from './components/app/IndexStatusModal.vue'
import QuickOpenModal from './components/app/QuickOpenModal.vue'
import ThemePickerModal from './components/app/ThemePickerModal.vue'
import ShortcutsModal from './components/app/ShortcutsModal.vue'
import AboutModal from './components/app/AboutModal.vue'
import TopbarNavigationControls from './components/app/TopbarNavigationControls.vue'
import WorkspaceSetupWizardModal from './components/app/WorkspaceSetupWizardModal.vue'
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
} from '../shared/api/workspaceApi'
import { readAppSettings } from '../shared/api/settingsApi'
import { readNoteSnapshot as readNoteSnapshotIpc, saveNoteBuffer as saveNoteBufferIpc } from '../shared/api/editorSyncApi'
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  renameFavorite,
} from '../shared/api/favoritesApi'
import {
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
  updateWikilinksForPathMoves,
  updateWikilinksForRename,
  writePropertyTypeSchema
} from '../shared/api/indexApi'
import type { FileVersion, PathMove, ReadNoteSnapshotResult, SaveNoteResult, WorkspaceFsChange } from '../shared/api/apiTypes'
import type { AppSettingsAlters } from '../shared/api/apiTypes'
import {
  hasActiveOpenTrace,
  installOpenDebugLongTaskObserver,
  subscribeOpenTraceActivity,
} from '../shared/lib/openTrace'
import { parseSearchSnippet } from '../shared/lib/searchSnippets'
import { type SearchMode } from '../shared/lib/searchMode'
import { hasActiveTextSelectionInEditor, shouldBlockGlobalShortcutsFromTarget } from '../shared/lib/shortcutTargets'
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
  basenameLabel,
  buildMetadataRows,
  buildShortcutSections,
  buildSystemThemeLabel,
  buildThemePickerItems,
  formatRelativeTime,
  formatSearchScore
} from './lib/appShellPresentation'
import { readPersistedMultiPaneLayout } from './lib/appShellPersistence'
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
import { useAppIndexingController } from './composables/useAppIndexingController'
import { useWorkspaceMutationEffects } from './composables/useWorkspaceMutationEffects'
import {
  useAppNavigationController,
  type CosmosHistorySnapshot,
  type HomeHistorySnapshot,
  type SecondBrainHistorySnapshot
} from './composables/useAppNavigationController'
import {
  buildCosmosHistorySnapshot,
  buildHomeHistorySnapshot,
  buildSecondBrainHistorySnapshot,
  cosmosHistoryLabel,
  cosmosSnapshotStateKey,
  homeHistoryLabel,
  homeSnapshotStateKey,
  readCosmosHistorySnapshot,
  readHomeHistorySnapshot,
  readSecondBrainHistorySnapshot,
  secondBrainHistoryLabel,
  secondBrainSnapshotStateKey
} from './lib/appNavigationHistory'
import { useAppShellHistoryUi } from './composables/useAppShellHistoryUi'
import { useAppShellModalInteractions } from './composables/useAppShellModalInteractions'
import { useAppShellCommands } from './composables/useAppShellCommands'
import { useAppShellKeyboard } from './composables/useAppShellKeyboard'
import { useAppShellLaunchpad } from './composables/useAppShellLaunchpad'
import { PALETTE_ACTION_PRIORITY, useAppShellPaletteActions } from './composables/useAppShellPaletteActions'
import { useAppShellEntryActions } from './composables/useAppShellEntryActions'
import { useAppShellModals } from './composables/useAppShellModals'
import { useAppShellOpenFlow, type RefreshBacklinksOptions } from './composables/useAppShellOpenFlow'
import { useAppShellPersistence } from './composables/useAppShellPersistence'
import { useAppShellChromeRuntime } from './composables/useAppShellChromeRuntime'
import { useAppShellRuntimeLifecycle } from './composables/useAppShellRuntimeLifecycle'
import { useAppShellSearch } from './composables/useAppShellSearch'
import { useAppShellWorkspaceEntries } from './composables/useAppShellWorkspaceEntries'
import { useAppShellWorkspaceLifecycle } from './composables/useAppShellWorkspaceLifecycle'
import { useAppShellWorkspaceSetup } from './composables/useAppShellWorkspaceSetup'
import { useAppShellWorkspaceRouting } from './composables/useAppShellWorkspaceRouting'
import { useAppModalController } from './composables/useAppModalController'
import { useAppSecondBrainBridge } from './composables/useAppSecondBrainBridge'
import { useAppShellViewModels } from './composables/useAppShellViewModels'
import { useAppQuickOpen } from './composables/useAppQuickOpen'
import { useAppTheme, type ThemePreference } from './composables/useAppTheme'
import { useAppWorkspaceController } from './composables/useAppWorkspaceController'
import { useEditorState } from '../domains/editor/composables/useEditorState'
import { useEchoesDiscoverability } from '../domains/echoes/composables/useEchoesDiscoverability'
import { useEchoesPack } from '../domains/echoes/composables/useEchoesPack'
import { useConstitutedContext } from '../domains/editor/composables/useConstitutedContext'
import { useCosmosController } from '../domains/cosmos/composables/useCosmosController'
import { useFilesystemState } from './composables/useFilesystemState'
import { useWorkspaceState, type SidebarMode } from './composables/useWorkspaceState'
import { useFavoritesController } from '../domains/favorites/composables/useFavoritesController'
import { rewritePathWithMoves, sortPathMoves } from './lib/pathMoves'
import {
  createInitialLayout,
  useMultiPaneWorkspaceState
} from './composables/useMultiPaneWorkspaceState'
import packageJson from '../../package.json'

type PropertyPreviewRow = { key: string; value: string }

type EditorViewExposed = EditorPaneGridExposed

type ExplorerTreeExposed = {
  revealPathInView: (path: string, options?: { focusTree?: boolean; behavior?: ScrollBehavior }) => Promise<void>
}

type SaveFileOptions = {
  explicit: boolean
  expectedBaseVersion: FileVersion | null
  force?: boolean
}

type SaveFileResult = SaveNoteResult

type RenameFromTitleResult = {
  path: string
  title: string
}

type VirtualDoc = {
  content: string
  titleLine: string
}

// Top-level shell persistence lives here so App stays the single assembly point
// for workspace restore and cross-session UI state.
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
  availableThemes,
  activeTheme,
  activeColorScheme,
  applyTheme,
  applyThemePreview,
  loadThemePreference,
  persistThemePreference,
  onSystemThemeChanged
} = useAppTheme({ storageKey: THEME_STORAGE_KEY })
const isMacOs = typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent)

const quickOpenVisible = ref(false)
const quickOpenQuery = ref('')
const quickOpenActiveIndex = ref(0)
const themePickerVisible = ref(false)
const themePickerQuery = ref('')
const themePickerActiveIndex = ref(0)
const themePickerHasPreview = ref(false)
const editorRef = ref<EditorViewExposed | null>(null)
const explorerRef = ref<ExplorerTreeExposed | null>(null)
const topbarRef = ref<InstanceType<typeof TopbarNavigationControls> | null>(null)
const propertiesPreview = ref<PropertyPreviewRow[]>([])
const propertyParseErrorCount = ref(0)
const virtualDocs = ref<Record<string, VirtualDoc>>({})
const altersSettings = ref<AppSettingsAlters>({
  default_mode: 'neutral',
  show_badge_in_chat: true,
  default_influence_intensity: 'balanced'
})
const overflowMenuOpen = ref(false)
const editorZoom = ref(1)
const workspaceMutationEchoesToken = ref(0)
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
const persistedMultiPane = readPersistedMultiPaneLayout(MULTI_PANE_STORAGE_KEY)
const multiPane = useMultiPaneWorkspaceState(persistedMultiPane ?? createInitialLayout())
const shellPersistence = useAppShellPersistence({
  theme: {
    themePreference,
    loadThemePreference,
    persistThemePreference,
    applyTheme
  },
  workspace: {
    sidebarMode: workspace.sidebarMode,
    previousNonCosmosMode
  },
  layout: multiPane.layout,
  editorZoom,
  storageKeys: {
    sidebarMode: VIEW_MODE_STORAGE_KEY,
    previousNonCosmosMode: PREVIOUS_NON_COSMOS_VIEW_MODE_STORAGE_KEY,
    editorZoom: EDITOR_ZOOM_STORAGE_KEY,
    multiPane: MULTI_PANE_STORAGE_KEY
  }
})
const showDebugTools = import.meta.env.DEV
const appVersion = packageJson.version
let shellOpenFlow: ReturnType<typeof useAppShellOpenFlow> | null = null
let shellModalInteractions: ReturnType<typeof useAppShellModalInteractions> | null = null
let closeQuickOpenProxy = () => {}

const paneCount = computed(() => Object.keys(multiPane.layout.value.panesById).length)
const activeFilePath = computed(() => multiPane.getActiveDocumentPath())
const activeStatus = computed(() => editorState.getStatus(activeFilePath.value))
const activeNoteTitle = computed(() => activeFilePath.value ? noteTitleFromPath(activeFilePath.value) : 'No active note')
const echoesEnabled = ref(!hasActiveOpenTrace())
const activeStateLabel = computed(() => (
  activeStatus.value.saving
    ? 'saving'
    : virtualDocs.value[activeFilePath.value]
      ? 'unsaved'
      : activeStatus.value.dirty
        ? 'editing'
        : 'saved'
))
const noteEchoes = useEchoesPack(activeFilePath, {
  limit: 5,
  enabled: echoesEnabled,
  refreshKey: workspaceMutationEchoesToken
})
const noteEchoesDiscoverability = useEchoesDiscoverability()
const constitutedContext = useConstitutedContext({
  resolveItem: (path) => ({
    path,
    title: noteTitleFromPath(path)
  })
})
const contextActionLoading = ref(false)
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
const entryActions = useAppShellEntryActions()
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
  formatRelativeTime,
  actionPort: entryActions.launchpadActionPort
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
  refreshBacklinks: (options?: RefreshBacklinksOptions) => shellOpenFlow?.refreshBacklinks(options) ?? Promise.resolve(),
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
  indexRunCurrentPath,
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
  indexCurrentOperationLabel,
  indexCurrentOperationDetail,
  indexCurrentOperationPath,
  indexCurrentOperationStatusLabel,
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
  runWorkspaceMutation,
  dispose: disposeIndexingController
} = indexing
const workspaceMutationEffects = useWorkspaceMutationEffects({
  workingFolderPath: filesystem.workingFolderPath,
  allWorkspaceFiles,
  favoriteItems: favorites.items,
  filesystemErrorMessage: filesystem.errorMessage,
  getImmediatePathCandidates: () => multiPane.getOpenDocumentPaths(),
  applyImmediateLocalPathMoves: applyImmediatePathMovesLocally,
  applyDeferredLocalPathMoves: applyDeferredPathMovesLocally,
  renameFavorite: (fromPath, toPath) => favorites.renameFavorite(fromPath, toPath),
  updateWikilinksForRename,
  updateWikilinksForPathMoves,
  runWorkspaceMutation,
  bumpEchoesRefreshToken: () => {
    workspaceMutationEchoesToken.value += 1
  }
})
const modalController = useAppModalController({
  quickOpenVisible,
  themePickerVisible,
  cosmosCommandLoadingVisible,
  indexStatusModalVisible,
  newFileModalVisible,
  newFolderModalVisible,
  openDateModalVisible,
  settingsModalVisible,
  shortcutsModalVisible,
  aboutModalVisible,
  workspaceSetupWizardVisible,
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
  secondBrainRequestedAlterId,
  secondBrainRequestedAlterNonce,
  setSecondBrainSessionId,
  setSecondBrainPrompt,
  setSecondBrainAlterId,
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
const { paletteActions } = useAppShellPaletteActions({
  statePort: {
    activeFilePath,
    quickOpenQuery
  },
  documentPort: {
    isMarkdownPath
  },
  favoritesPort: {
    isFavorite: (path) => favorites.isFavorite(path)
  },
  themePort: {
    availableThemes
  },
  actionPort: entryActions.shellPaletteActionPort
})

const quickOpenDataPort = {
  allWorkspaceFiles,
  workingFolderPath: filesystem.workingFolderPath,
  recentViewedNotes
}

const quickOpenDocumentPort = {
  isIsoDate,
  toRelativePath,
  dailyNotePath
}

const quickOpenPalettePort = {
  paletteActions,
  paletteActionPriority: PALETTE_ACTION_PRIORITY
}

const {
  quickOpenIsActionMode,
  quickOpenActionGroups,
  quickOpenResults,
  quickOpenBrowseRecentResults,
  quickOpenBrowseActionResults,
  quickOpenBrowseItems,
  quickOpenHasTextQuery,
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

const shellModals = useAppShellModals({
  statePort: {
    quickOpenVisible,
    quickOpenQuery,
    quickOpenActiveIndex,
    quickOpenItemCount,
    cosmosCommandLoadingVisible,
    newFileModalVisible,
    newFilePathInput,
    newFileModalError,
    newFolderModalVisible,
    newFolderPathInput,
    newFolderModalError,
    openDateModalVisible,
    openDateInput,
    openDateModalError,
    settingsModalVisible,
    designSystemDebugVisible,
    shortcutsModalVisible,
    shortcutsFilterQuery,
    aboutModalVisible,
    workspaceSetupWizardVisible,
    workspaceSetupWizardBusy
  },
  actionPort: {
    rememberFocusBeforeModalOpen,
    restoreFocusAfterModalClose,
    closeOverflowMenu,
    resetQuickOpenState,
    ensureAllFilesLoaded: loadAllFiles,
    hasAllFilesLoaded: () => allWorkspaceFiles.value.length > 0,
    syncEditorZoom: () => shellPersistence.syncEditorZoom()
  },
  domPort: {
    focusQuickOpenInput: () => {
      document.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')?.focus()
    },
    focusShortcutsFilterInput: () => {
      document.querySelector<HTMLInputElement>('[data-shortcuts-filter="true"]')?.focus()
    },
    focusOpenDateInput: () => {
      document.querySelector<HTMLInputElement>('[data-open-date-input="true"]')?.focus()
    },
    focusNewFileInput: () => {
      document.querySelector<HTMLInputElement>('[data-new-file-input="true"]')?.focus()
    },
    focusNewFolderInput: () => {
      document.querySelector<HTMLInputElement>('[data-new-folder-input="true"]')?.focus()
    },
    focusCosmosLoadingModal: () => {
      document.querySelector<HTMLElement>('[data-modal="cosmos-command-loading"]')?.focus()
    },
    scrollQuickOpenActiveItemIntoView: () => {
      if (!quickOpenVisible.value) return
      void nextTick(() => {
        const modalList = document.querySelector<HTMLElement>('[data-modal="quick-open"] .modal-list')
        if (!modalList) return
        const activeItem = modalList.querySelector<HTMLElement>('.modal-item.active')
        activeItem?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
      })
    }
  },
  currentIsoDate: () => formatIsoDate(new Date())
})
const {
  closeAboutModal,
  openShortcutsModal,
  closeShortcutsModal,
  openSettingsModal,
  closeSettingsModal,
  openDesignSystemDebugModal,
  closeDesignSystemDebugModal,
  openWorkspaceSetupWizard,
  closeWorkspaceSetupWizard,
  openQuickOpen,
  closeQuickOpen,
  openNewFileModal,
  closeNewFileModal,
  openNewFolderModal,
  closeNewFolderModal,
  openOpenDateModal,
  closeOpenDateModal,
  openShortcutsFromOverflow,
  openAboutFromOverflow,
  openSettingsFromOverflow,
  openShortcutsFromPalette
} = shellModals
closeQuickOpenProxy = () => closeQuickOpen()
const workspaceEntries = useAppShellWorkspaceEntries({
  statePort: {
    workingFolderPath: filesystem.workingFolderPath,
    activeFilePath,
    newFilePathInput,
    newFileModalError,
    newFolderPathInput,
    newFolderModalError,
    openDateInput,
    openDateModalError
  },
  documentPort: {
    normalizeRelativeNotePath,
    hasForbiddenEntryNameChars,
    isReservedEntryName,
    parentPrefixForModal,
    parseIsoDateInput
  },
  fsPort: {
    listChildren,
    pathExists,
    createEntry,
    ensureParentFolders,
    openTabWithAutosave: (path) => openTabWithAutosave(path),
    upsertWorkspaceFilePath,
    openDailyNote: (date) => openDailyNote(date, openTabWithAutosave)
  },
  modalPort: {
    openNewFileModal,
    closeNewFileModal,
    openNewFolderModal,
    closeNewFolderModal,
    openOpenDateModal,
    closeOpenDateModal
  }
})
const {
  createNewFileFromPalette,
  openSpecificDateNote,
  onExplorerRequestCreate,
  submitNewFileFromModal,
  submitNewFolderFromModal,
  submitOpenDateFromModal
} = workspaceEntries

const mediaQuery = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

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

function closeOverflowMenu() {
  overflowMenuOpen.value = false
}

async function applyCosmosHistorySnapshot(snapshot: CosmosHistorySnapshot): Promise<boolean> {
  if (!filesystem.hasWorkspace.value) return false

  multiPane.openSurfaceInPane('cosmos')

  // History replay may happen before the graph is ready, so restoration needs
  // to rebuild enough domain state before selection/focus is applied.
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
  openSurfaceInPane: (type: 'home' | 'cosmos' | 'second-brain-chat' | 'alters', paneId?: string) => multiPane.openSurfaceInPane(type, paneId),
  findPaneContainingSurface: (type: 'home' | 'cosmos' | 'second-brain-chat' | 'alters') => multiPane.findPaneContainingSurface(type)
}

const navigationHistoryPort = {
  documentHistory,
  cosmos: {
    read: readCosmosHistorySnapshot,
    current: () =>
      buildCosmosHistorySnapshot({
        query: cosmos.query.value.trim(),
        selectedNodeId: cosmos.selectedNodeId.value,
        focusMode: cosmos.focusMode.value,
        focusDepth: cosmos.focusDepth.value
      }),
    stateKey: cosmosSnapshotStateKey,
    label: (snapshot: CosmosHistorySnapshot) =>
      cosmosHistoryLabel(snapshot, (nodeId) => {
        const node = cosmos.graph.value.nodes.find((item) => item.id === nodeId)
        return node ? node.displayLabel || node.label : null
      }),
    apply: applyCosmosHistorySnapshot
  },
  home: {
    read: readHomeHistorySnapshot,
    current: () => buildHomeHistorySnapshot(),
    stateKey: homeSnapshotStateKey,
    label: homeHistoryLabel,
    open: openHomeHistorySnapshot
  },
  secondBrain: {
    read: readSecondBrainHistorySnapshot,
    current: () => buildSecondBrainHistorySnapshot(),
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
shellOpenFlow = useAppShellOpenFlow({
  workspacePort: {
    workingFolderPath: filesystem.workingFolderPath,
    sidebarVisible: workspace.sidebarVisible,
    previousNonCosmosMode,
    setSidebarMode: (mode) => workspace.setSidebarMode(mode),
    errorMessage: filesystem.errorMessage
  },
  editorPort: {
    activeFilePath,
    editorState,
    editorRef,
    virtualDocs,
    explorerRef
  },
  contextPort: {
    resetForAnchor: (path: string) => constitutedContext.resetForAnchor(path)
  },
  dataPort: {
    refreshActiveFileMetadata,
    loadWikilinkTargets,
    pathExists,
    readTextFile,
    dailyNotePath,
    isIsoDate,
    sanitizeRelativePath,
    resolveExistingWikilinkPath,
    extractHeadingsFromMarkdown
  },
  navigationPort: {
    openTabWithAutosave,
    openDailyNote: (date, openPath) => openDailyNote(date, openPath),
    recordCosmosHistorySnapshot
  },
  uiPort: {
    closeQuickOpen: () => closeQuickOpenProxy()
  }
})
const {
  backlinks,
  backlinksLoading,
  semanticLinks,
  semanticLinksLoading,
  openTodayNote,
  openYesterdayNote,
  showExplorerForActiveFile,
  openWikilinkTarget,
  onCosmosOpenNode,
  loadWikilinkHeadings,
  openQuickResult,
  onSearchResultOpen,
  onBacklinkOpen,
  onExplorerOpen
} = shellOpenFlow

const shellViewModels = useAppShellViewModels({
  theme: {
    activeColorScheme,
    availableThemes
  },
  search: {
    shortcutsFilterQuery
  },
  workspace: {
    workingFolderPath: filesystem.workingFolderPath,
    activeFilePath,
    activeStatus,
    activeFileMetadata,
    virtualDocs,
    editorZoom,
    getActiveTab: () => multiPane.getActiveTab(),
    toRelativePath
  },
  history: {
    backTargets: documentHistory.backTargets,
    forwardTargets: documentHistory.forwardTargets
  },
  notes: {
    noteEchoes: noteEchoes.items,
    semanticLinks
  },
  context: {
    constitutedContext
  },
  cosmos: {
    graph: cosmos.graph,
    loading: cosmos.loading,
    error: cosmos.error,
    selectedNodeId: cosmos.selectedNodeId,
    focusMode: cosmos.focusMode,
    focusDepth: cosmos.focusDepth,
    summary: cosmos.summary,
    query: cosmos.query,
    queryMatches: cosmos.queryMatches,
    showSemanticEdges: cosmos.showSemanticEdges,
    selectedNode: cosmos.selectedNode,
    selectedLinkCount: cosmos.selectedLinkCount,
    preview: cosmos.preview,
    previewLoading: cosmos.previewLoading,
    previewError: cosmos.previewError,
    outgoingNodes: cosmos.outgoingNodes,
    incomingNodes: cosmos.incomingNodes
  },
  launchpad: {
    recentWorkspaces: launchpadRecentWorkspaces,
    recentViewedNotes,
    recentUpdatedNotes,
    showWizardAction: launchpadShowWizardAction
  },
  altersSettings,
  secondBrain: {
    workspacePath: filesystem.workingFolderPath,
    allWorkspaceFiles,
    requestedSessionId: secondBrainRequestedSessionId,
    requestedSessionNonce: secondBrainRequestedSessionNonce,
    requestedPrompt: secondBrainRequestedPrompt,
    requestedPromptNonce: secondBrainRequestedPromptNonce,
    requestedAlterId: secondBrainRequestedAlterId,
    requestedAlterNonce: secondBrainRequestedAlterNonce,
    echoesRefreshToken: workspaceMutationEchoesToken
  },
  labels: {
    formatTimestamp: (value) => formatTimestamp(value ?? null)
  },
  isMacOs,
  libs: {
    buildShortcutSections,
    buildMetadataRows,
    buildSystemThemeLabel,
    buildThemePickerItems,
    basenameLabel
  },
  historyLabels: {
    historyTargetLabel: (entry) => historyTargetLabel(entry)
  }
})

const {
  systemThemeLabel,
  themePickerItems,
  filteredShortcutSections,
  metadataRows,
  backlinkCount,
  semanticLinkCount,
  activeNoteInContext,
  localContextItems,
  pinnedContextItems,
  noteEchoesForPanel,
  cosmosPaneViewModel,
  secondBrainPaneViewModel,
  altersPaneViewModel,
  launchpadPaneViewModel,
  backShortcutLabel,
  forwardShortcutLabel,
  homeShortcutLabel,
  commandPaletteShortcutLabel,
  zoomPercentLabel,
  backHistoryItems,
  forwardHistoryItems
} = shellViewModels

shellModalInteractions = useAppShellModalInteractions({
  quickOpenPort: {
    quickOpenVisible,
    quickOpenIsActionMode,
    quickOpenHasTextQuery,
    quickOpenActiveIndex,
    quickOpenActionGroups,
    quickOpenResults,
    quickOpenBrowseItems,
    paletteActions,
    moveQuickOpenSelection,
    openQuickResult
  },
  themePickerPort: {
    themePickerVisible,
    themePickerQuery,
    themePickerActiveIndex,
    themePickerItems,
    themePickerHasPreview,
    themePreference
  },
  closeQuickOpen: (restoreFocus = true) => closeQuickOpen(restoreFocus),
  closeOverflowMenu: () => closeOverflowMenu(),
  rememberFocusBeforeModalOpen,
  restoreFocusAfterModalClose,
  focusEditor: () => editorRef.value?.focusEditor(),
  focusQuickOpenInput: () => {
    document.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')?.focus()
  },
  focusThemePickerInput: () => {
    document.querySelector<HTMLInputElement>('[data-theme-picker-input="true"]')?.focus()
  },
  scrollThemePickerActiveItemIntoView: () => {
    if (!themePickerVisible.value) return
    void nextTick(() => {
      const modalList = document.querySelector<HTMLElement>('[data-modal="theme-picker"] .modal-list')
      if (!modalList) return
      const activeItem = modalList.querySelector<HTMLElement>('.modal-item.active')
      activeItem?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
    })
  },
  showLoadingState: (label: string) => {
    cosmosCommandLoadingLabel.value = label
    cosmosCommandLoadingVisible.value = true
  },
  hideLoadingState: () => {
    cosmosCommandLoadingVisible.value = false
  },
  setErrorMessage: (message: string) => {
    filesystem.errorMessage.value = message
  },
  canRestoreEditorFocusAfterAction: () =>
    !newFileModalVisible.value &&
    !newFolderModalVisible.value &&
    !openDateModalVisible.value &&
    !settingsModalVisible.value &&
    !designSystemDebugVisible.value &&
    !shortcutsModalVisible.value &&
    !themePickerVisible.value &&
    !workspaceSetupWizardVisible.value &&
    !cosmosCommandLoadingVisible.value,
  applyTheme,
  applyThemePreview
})
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
    : documentHistory.forwardTargets.value.length,
  navigationPort: {
    goBackInHistory: async () => {
      await goBackInHistory()
    },
    goForwardInHistory: async () => {
      await goForwardInHistory()
    },
    openHistoryEntry,
    documentHistory: {
      currentIndex: documentHistory.currentIndex,
      jumpToEntry: (index: number) => documentHistory.jumpToEntry(index)
    },
    isApplyingHistoryNavigation
  }
})
const {
  historyMenuOpen,
  historyMenuStyle,
  closeHistoryMenu,
  onHistoryButtonPointerDown,
  cancelHistoryLongPress,
  onHistoryButtonContextMenu,
  onHistoryButtonClick,
  onHistoryTargetClick,
  onWindowResize,
  onGlobalPointerDown: onGlobalPointerDownInternal,
  dispose: disposeHistoryUi
} = historyUi
const chromeRuntime = useAppShellChromeRuntime({
  editorRef,
  editorZoom,
  overflowMenuOpen,
  closeHistoryMenu: () => closeHistoryMenu(),
  closeOverflowMenu: () => closeOverflowMenu(),
  openDesignSystemDebugModal: () => openDesignSystemDebugModal(),
  showDebugTools,
  syncEditorZoom: (getZoom) => shellPersistence.syncEditorZoom(getZoom)
})
const {
  leftPaneWidth,
  rightPaneWidth,
  beginResize,
  onPointerMove,
  stopResize,
  toggleOverflowMenu,
  openDesignSystemDebugFromOverflow,
  zoomInFromOverflow,
  zoomOutFromOverflow,
  resetZoomFromOverflow,
  zoomInFromPalette,
  zoomOutFromPalette,
  resetZoomFromPalette
} = chromeRuntime
const commands = useAppShellCommands({
  workspacePort: {
    hasWorkspace: filesystem.hasWorkspace,
    activeFilePath,
    allWorkspaceFiles,
    previousNonCosmosMode,
    setSidebarMode: (mode) => workspace.setSidebarMode(mode),
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
    primeSecondBrainSessionRequest: () => secondBrainBridge.primeRequestedSecondBrainSessionFromStorage(),
    openSettingsModal,
    openQuickOpen,
    openTodayNote,
    openWorkspacePicker: () => onSelectWorkingFolder(),
    closeWorkspace: () => closeWorkspace(),
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
  openAltersViewFromPalette,
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
entryActions.bindLaunchpadActionPort({
  openQuickOpen: (initialQuery = '') => openQuickOpen(initialQuery),
  openCommandPalette: () => openCommandPalette(),
  openTodayNote: () => openTodayNote(),
  openCosmosView: () => openCosmosViewFromPalette(),
  openSecondBrainView: () => openSecondBrainViewFromPalette(),
  openAltersView: () => openAltersViewFromPalette()
})
entryActions.bindShellPaletteActionPort({
  openHomeViewFromPalette,
  openFavoritesPanelFromPalette,
  openCosmosViewFromPalette,
  openSecondBrainViewFromPalette,
  openAltersViewFromPalette,
  addActiveNoteToSecondBrainFromPalette,
  addActiveNoteToFavoritesFromPalette,
  removeActiveNoteFromFavoritesFromPalette,
  openSettingsFromPalette,
  openNoteInCosmosFromPalette,
  openWorkspaceFromPalette,
  closeWorkspaceFromPalette,
  openShortcutsFromPalette,
  zoomInFromPalette,
  zoomOutFromPalette,
  resetZoomFromPalette,
  openTodayNote,
  openYesterdayNote,
  openSpecificDateNote,
  createNewFileFromPalette,
  closeAllTabsFromPalette,
  closeAllTabsOnCurrentPaneFromPalette,
  closeOtherTabsFromPalette,
  splitPaneFromPalette,
  focusPaneFromPalette,
  focusNextPaneFromPalette,
  moveTabToNextPaneFromPalette,
  closeActivePaneFromPalette,
  joinPanesFromPalette,
  resetPaneLayoutFromPalette,
  revealActiveInExplorer
})
entryActions.bindThemeActionPort({
  openThemePickerFromPalette: () => shellModalInteractions?.openThemePickerFromPalette() ?? false,
  setThemeFromPalette: (next) => shellModalInteractions?.setThemeFromPalette(next) ?? false
})

const workspaceLifecycle = useAppShellWorkspaceLifecycle({
  shellPort: {
    storageKey: WORKING_FOLDER_STORAGE_KEY,
    workingFolderPath: filesystem.workingFolderPath,
    hasWorkspace: filesystem.hasWorkspace,
    activeFilePath,
    normalizePath,
    clearError: () => {
      filesystem.errorMessage.value = ''
    },
    notifyError: (message) => filesystem.notifyError(message)
  },
  controllerPort: {
    loadWorkingFolderInternal,
    closeWorkspaceInternal,
    resetWorkspaceState,
    applyWorkspaceFsChanges,
    relayEditorFsChanges: async (changes: WorkspaceFsChange[]) => {
      await editorRef.value?.applyWorkspaceFsChanges?.(changes)
    }
  },
  uiPort: {
    activePaneId: computed(() => multiPane.layout.value.activePaneId),
    resetToSinglePane: () => multiPane.resetToSinglePane(),
    closeAllTabsInPane: (paneId) => multiPane.closeAllTabsInPane(paneId),
    findPaneContainingSurface: () => multiPane.findPaneContainingSurface('cosmos'),
    resetDocumentHistory: () => documentHistory.reset(),
    resetActiveOutline: () => editorState.setActiveOutline([]),
    resetSearchState,
    resetWorkspaceRecentState,
    recordRecentWorkspace,
    removeRecentWorkspaceEntry,
    invalidateRecentNotes,
    removeLaunchpadRecentNote,
    renameLaunchpadRecentNote,
    resetInspectorPanels: () => {
      backlinks.value = []
      backlinksLoading.value = false
      semanticLinks.value = []
      semanticLinksLoading.value = false
      virtualDocs.value = {}
    },
    closeOverflowMenu
  },
  favoritesPort: {
    loadFavorites: () => favorites.loadFavorites(),
    reset: () => favorites.reset(),
    applyWorkspaceFsChanges: (changes) => favorites.applyWorkspaceFsChanges(changes),
    renameFavorite: (fromPath, toPath) => favorites.renameFavorite(fromPath, toPath)
  },
  cosmosPort: {
    clearState: () => cosmos.clearState(),
    refreshGraph: () => cosmos.refreshGraph()
  },
  fsPort: {
    selectWorkingFolder
  }
})
const {
  closeWorkspace,
  loadWorkingFolder,
  onSelectWorkingFolder,
  openRecentWorkspace
} = workspaceLifecycle
const appShellRuntimeLifecycle = useAppShellRuntimeLifecycle({
  persistencePort: {
    initializeShellPersistence: () => shellPersistence.initializeShellPersistence()
  },
  alterSettingsPort: {
    syncAlterSettingsFromDisk: () => syncAlterSettingsFromDisk()
  },
  workspaceLifecyclePort: {
    start: () => workspaceLifecycle.start(),
    dispose: () => workspaceLifecycle.dispose()
  },
  openTracePort: {
    installOpenDebugLongTaskObserver: () => installOpenDebugLongTaskObserver(),
    subscribeOpenTraceActivity: (listener) => subscribeOpenTraceActivity(listener),
    onOpenTraceActivityChange: (active) => {
      echoesEnabled.value = !active
    }
  },
  windowPort: {
    onGlobalPointerDown,
    onWindowResize,
    onPointerMove,
    stopResize
  },
  themePort: {
    mediaQuery,
    onSystemThemeChanged
  }
})
const workspaceSetup = useAppShellWorkspaceSetup({
  statePort: {
    workingFolderPath: filesystem.workingFolderPath,
    hasWorkspace: filesystem.hasWorkspace,
    busy: workspaceSetupWizardBusy
  },
  workspacePort: {
    selectWorkingFolder,
    loadWorkingFolder,
    loadAllFiles,
    invalidateRecentNotes
  },
  fsPort: {
    pathExists,
    createEntry,
    ensureParentFolders,
    enqueueMarkdownReindex
  },
  uiPort: {
    notifySuccess: (message) => filesystem.notifySuccess(message),
    notifyError: (message) => filesystem.notifyError(message),
    closeWorkspaceSetupWizard,
    upsertWorkspaceFilePath
  },
  pathPort: {
    sanitizeRelativePath
  }
})
const { applyWorkspaceSetupWizard } = workspaceSetup
const workspaceRouting = useAppShellWorkspaceRouting({
  lifecyclePort: {
    openWorkspacePicker: () => onSelectWorkingFolder(),
    openRecentWorkspace: (path) => openRecentWorkspace(path)
  },
  modalPort: {
    openWorkspaceSetupWizard: () => openWorkspaceSetupWizard(),
    closeWorkspaceSetupWizard: () => closeWorkspaceSetupWizard()
  },
  setupPort: {
    applyWorkspaceSetupWizard: (payload) => applyWorkspaceSetupWizard(payload)
  }
})
const keyboard = useAppShellKeyboard({
  isMacOs,
  statePort: {
    quickOpenVisible,
    quickOpenIsActionMode,
    themePickerVisible,
    historyMenuOpen,
    overflowMenuOpen,
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
    closeNewFileModal,
    closeNewFolderModal,
    closeOpenDateModal,
    closeSettingsModal,
    closeDesignSystemDebugModal,
    closeAboutModal,
    closeShortcutsModal,
    closeWorkspaceSetupWizard,
    closeIndexStatusModal,
    closeThemePickerModal,
    moveQuickOpenSelection,
    onQuickOpenEnter,
    moveThemePickerSelection,
    onThemePickerEnter,
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

function moveThemePickerSelection(delta: number) {
  shellModalInteractions?.moveThemePickerSelection(delta)
}

function closeThemePickerModal(restoreTheme = true) {
  shellModalInteractions?.closeThemePickerModal(restoreTheme)
}

function previewThemePickerItem(next: ThemePreference) {
  shellModalInteractions?.previewThemePickerItem(next)
}

function selectThemeFromModal(next: ThemePreference) {
  shellModalInteractions?.setThemeFromPalette(next)
  shellModalInteractions?.closeThemePickerModal(false)
}

function onThemePickerEnter() {
  shellModalInteractions?.onThemePickerEnter()
}

function openThemePickerFromOverflow() {
  shellModalInteractions?.openThemePickerFromOverflow()
}

function addPathToConstitutedContext(path: string) {
  const anchorPath = activeFilePath.value.trim() || constitutedContext.anchorPath.value.trim() || path.trim()
  if (!anchorPath || !path.trim()) return
  constitutedContext.add(path, anchorPath, (itemPath) => ({
    path: itemPath,
    title: noteTitleFromPath(itemPath)
  }))
}

function removePathFromConstitutedContext(path: string) {
  constitutedContext.remove(path)
}

function removeLocalPathFromConstitutedContext(path: string) {
  constitutedContext.removeLocal(path)
}

function removePinnedPathFromConstitutedContext(path: string) {
  constitutedContext.removePinned(path)
}

function toggleActiveNoteInConstitutedContext() {
  const path = activeFilePath.value.trim()
  if (!path) return
  if (constitutedContext.contains(path)) {
    constitutedContext.remove(path)
    return
  }
  addPathToConstitutedContext(path)
}

async function openConstitutedContextInSecondBrain(prompt?: string) {
  if (!filesystem.hasWorkspace.value) {
    filesystem.errorMessage.value = 'Open a workspace first.'
    return false
  }

  const normalized = normalizeContextPathsForUpdate(
    filesystem.workingFolderPath.value,
    constitutedContext.paths.value
  )
  const seedPath = normalized[0] || activeFilePath.value
  if (!seedPath) {
    filesystem.errorMessage.value = 'No note context available for Second Brain.'
    return false
  }

  contextActionLoading.value = true
  try {
    const sessionId = await secondBrainBridge.resolveSecondBrainSessionForPath(seedPath)
    await replaceSessionContext(sessionId, normalized)
    setSecondBrainSessionId(sessionId, { bumpNonce: true })
    setSecondBrainPrompt(prompt?.trim() ?? '', { bumpNonce: true })
    await openSecondBrainViewFromPalette()
    return true
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not open Second Brain with this context.'
    return false
  } finally {
    contextActionLoading.value = false
  }
}

async function openConstitutedContextInCosmos() {
  if (!constitutedContext.paths.value.length) return false
  const opened = await openCosmosViewFromPalette()
  if (!opened) return false

  const targetPath = constitutedContext.paths.value[0]
  const targetKey = normalizePathKey(targetPath.trim())
  let match = cosmos.graph.value.nodes.find((node) =>
    normalizePathKey(node.path) === targetKey || normalizePathKey(node.id) === targetKey
  )
  if (!match) {
    await cosmos.refreshGraph()
    match = cosmos.graph.value.nodes.find((node) =>
      normalizePathKey(node.path) === targetKey || normalizePathKey(node.id) === targetKey
    )
  }
  if (!match) {
    if (cosmos.error.value) {
      filesystem.notifyError(cosmos.error.value)
      return false
    }
    filesystem.notifyError('Context anchor is not available in the current graph index.')
    return true
  }

  cosmos.selectNode(match.id)
  scheduleCosmosNodeFocus(match.id)
  recordCosmosHistorySnapshot()
  return true
}

async function openConstitutedContextInPulse() {
  if (!constitutedContext.paths.value.length) return false
  return await openConstitutedContextInSecondBrain(
    'Transform the current constituted context into a useful written output. Use Pulse from the Second Brain context surface.'
  )
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

    // The shell forwards explicit session/prompt requests so the pane reacts
    // through public inputs instead of reaching into bridge internals.
    setSecondBrainSessionId(sessionId, { bumpNonce: true })
    setSecondBrainPrompt(payload.prompt?.trim() ?? '', { bumpNonce: true })
    await openSecondBrainViewFromPalette()
    return true
  } catch (err) {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not open Second Brain with Pulse context.'
    return false
  }
}

async function openAlterInSecondBrain(alterId: string) {
  if (!filesystem.hasWorkspace.value) {
    filesystem.errorMessage.value = 'Open a workspace first.'
    return false
  }
  setSecondBrainAlterId(alterId, { bumpNonce: true })
  await openSecondBrainViewFromPalette()
  return true
}

function onSettingsSaved(result: { path: string; embeddings_changed: boolean }) {
  filesystem.notifySuccess(`Settings saved at ${result.path}.`)
  if ('alters' in result) {
    altersSettings.value = (result as typeof result & { alters: AppSettingsAlters }).alters
  }
  if (result.embeddings_changed) {
    markIndexOutOfSync()
    filesystem.notifyInfo('Embedding settings changed. Rebuild index to resync semantic search.')
  }
  closeSettingsModal()
}

async function syncAlterSettingsFromDisk() {
  try {
    const settings = await readAppSettings()
    altersSettings.value = settings.alters
  } catch {
    altersSettings.value = {
      default_mode: 'neutral',
      show_badge_in_chat: true,
      default_influence_intensity: 'balanced'
    }
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

async function readNoteSnapshot(path: string): Promise<ReadNoteSnapshotResult> {
  if (!filesystem.workingFolderPath.value) {
    throw new Error('Working folder is not set.')
  }
  const virtual = virtualDocs.value[path]
  if (virtual) {
    return {
      path,
      content: virtual.content,
      version: null
    }
  }
  return await readNoteSnapshotIpc(path)
}

function applyImmediatePathMovesLocally(moves: PathMove[], expandedMarkdownMoves: PathMove[]) {
  const normalizedMoves = sortPathMoves(moves)
  if (!normalizedMoves.length) return

  for (const move of expandedMarkdownMoves) {
    multiPane.replacePath(move.from, move.to)
    documentHistory.replacePath(move.from, move.to)
    editorState.movePath(move.from, move.to)
    renameLaunchpadRecentNote(move.from, move.to)

    if (virtualDocs.value[move.from]) {
      const nextVirtual = { ...virtualDocs.value }
      nextVirtual[move.to] = nextVirtual[move.from]
      delete nextVirtual[move.from]
      virtualDocs.value = nextVirtual
    }
  }

  backlinks.value = backlinks.value.map((path) => rewritePathWithMoves(path, normalizedMoves))
}

function applyDeferredPathMovesLocally(moves: PathMove[], expandedMarkdownMoves: PathMove[]) {
  const normalizedMoves = sortPathMoves(moves)
  if (!normalizedMoves.length) return

  for (const move of normalizedMoves) {
    replaceWorkspaceFilePath(move.from, move.to)
  }

  for (const move of expandedMarkdownMoves) {
    multiPane.replacePath(move.from, move.to)
    documentHistory.replacePath(move.from, move.to)
    editorState.movePath(move.from, move.to)
    renameLaunchpadRecentNote(move.from, move.to)

    if (virtualDocs.value[move.from]) {
      const nextVirtual = { ...virtualDocs.value }
      nextVirtual[move.to] = nextVirtual[move.from]
      delete nextVirtual[move.from]
      virtualDocs.value = nextVirtual
    }
  }
}

function onEditorPathRenamed(payload: { from: string; to: string; manual: boolean }) {
  void workspaceMutationEffects.handlePathRenamed(payload).catch((err) => {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
  })
}

function onExplorerPathRenamed(payload: { from: string; to: string }) {
  void workspaceMutationEffects.handlePathRenamed(payload).catch((err) => {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
  })
}

function onExplorerPathsMoved(moves: PathMove[]) {
  void workspaceMutationEffects.handlePathsMoved(moves).catch((err) => {
    filesystem.errorMessage.value = err instanceof Error ? err.message : 'Could not update wikilinks.'
  })
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

async function saveNoteBuffer(path: string, txt: string, options: SaveFileOptions): Promise<SaveFileResult> {
  if (!filesystem.workingFolderPath.value) {
    throw new Error('Working folder is not set.')
  }
  const virtual = virtualDocs.value[path]
  if (virtual && !options.explicit && isTitleOnlyContent(txt, virtual.titleLine)) {
    return {
      ok: true,
      version: options.expectedBaseVersion
    }
  }

  await ensureParentFolders(path)
  const result = await saveNoteBufferIpc({
    path,
    content: txt,
    expectedBaseVersion: options.expectedBaseVersion,
    requestId: crypto.randomUUID(),
    force: options.force
  })

  if (!result.ok) {
    return result
  }

  await refreshActiveFileMetadata(path)

  if (virtual) {
    const nextVirtual = { ...virtualDocs.value }
    delete nextVirtual[path]
    virtualDocs.value = nextVirtual
  }

  const normalizedPathKey = normalizePathKey(path)
  const isNewWorkspacePath = !allWorkspaceFiles.value.some((item) => normalizePathKey(item) === normalizedPathKey)

  upsertWorkspaceFilePath(path)
  enqueueMarkdownReindex(path)

  const shouldRefreshWorkspaceFiles = virtual || isNewWorkspacePath
  if (shouldRefreshWorkspaceFiles) {
    await loadAllFiles()
    workspaceMutationEchoesToken.value += 1
  }
  return result
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
    return
  }

  previousNonCosmosMode.value = target
  workspace.setSidebarMode(target)
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

function runQuickOpenAction(id: string) {
  shellModalInteractions?.runQuickOpenAction(id)
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
  shellModalInteractions?.onQuickOpenEnter()
}

function onQuickOpenInputKeydown(event: KeyboardEvent) {
  shellModalInteractions?.onQuickOpenInputKeydown(event)
}

function onThemePickerInputKeydown(event: KeyboardEvent) {
  shellModalInteractions?.onThemePickerInputKeydown(event)
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

async function saveActiveTab() {
  await editorRef.value?.saveNow()
}

watch(
  () => noteEchoes.items.value.length,
  (count, previousCount = 0) => {
    if (count > 0 && previousCount === 0) {
      noteEchoesDiscoverability.markPackShown()
    }
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

onMounted(() => {
  void appShellRuntimeLifecycle.start()
})

onBeforeUnmount(() => {
  disposeIndexingController()
  disposeNavigationController()
  disposeShellSearch()
  disposeShellLaunchpad()
  disposeHistoryUi()
  appShellRuntimeLifecycle.dispose()
  keyboard.dispose()
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
      :active-theme-label="themePreference === 'system' ? systemThemeLabel : activeTheme.label"
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
      @open-theme-picker="openThemePickerFromOverflow"
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
        @explorer-paths-moved="onExplorerPathsMoved"
        @explorer-paths-deleted="onExplorerPathsDeleted"
        @explorer-request-create="onExplorerRequestCreate"
        @explorer-selection="onExplorerSelection"
        @explorer-error="onExplorerError"
        @favorites-open="openFavoriteFromSidebar"
        @favorites-remove="removeFavoriteFromList"
        @select-working-folder="void workspaceRouting.openWorkspacePicker()"
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
              :readNoteSnapshot="readNoteSnapshot"
              :saveNoteBuffer="saveNoteBuffer"
              :renameFileFromTitle="renameFileFromTitle"
              :loadLinkTargets="loadWikilinkTargets"
              :loadLinkHeadings="loadWikilinkHeadings"
              :loadPropertyTypeSchema="loadPropertyTypeSchema"
              :savePropertyTypeSchema="savePropertyTypeSchema"
              :openLinkTarget="openWikilinkTarget"
              :cosmos="cosmosPaneViewModel"
              :alters="altersPaneViewModel"
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
              @external-reload="filesystem.notifyInfo(`Reloaded ${basenameLabel($event.path)} from disk.`)"
              @second-brain-context-changed="onSecondBrainContextChanged"
              @second-brain-session-changed="onSecondBrainSessionChanged"
              @alter-open-second-brain="void openAlterInSecondBrain($event)"
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
              @cosmos-add-to-context="addPathToConstitutedContext($event)"
              @status="onEditorStatus"
              @path-renamed="onEditorPathRenamed"
              @outline="onEditorOutline"
              @properties="onEditorProperties"
              @launchpad-open-workspace="void workspaceRouting.openWorkspacePicker()"
              @launchpad-open-wizard="void workspaceRouting.openWorkspaceSetupWizard()"
              @launchpad-open-command-palette="void launchpad.openCommandPaletteFromLaunchpad()"
              @launchpad-open-shortcuts="openShortcutsModal"
              @launchpad-open-recent-workspace="void workspaceRouting.openRecentWorkspace($event)"
              @launchpad-open-today="void openTodayNote()"
              @launchpad-open-quick-open="void launchpad.openQuickOpenFromLaunchpad()"
              @launchpad-create-note="void createNewFileFromPalette()"
              @launchpad-open-recent-note="void onExplorerOpen($event)"
              @launchpad-quick-start="void launchpad.launchQuickStart($event)"
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
            :active-note-title="activeNoteTitle"
            :active-state-label="activeStateLabel"
            :backlink-count="backlinkCount"
            :semantic-link-count="semanticLinkCount"
            :active-note-in-context="activeNoteInContext"
            :can-toggle-favorite="Boolean(activeFilePath && isMarkdownPath(activeFilePath))"
            :is-favorite="Boolean(activeFilePath && favorites.isFavorite(activeFilePath))"
            :echoes-items="noteEchoesForPanel"
            :echoes-loading="noteEchoes.loading.value"
            :echoes-error="noteEchoes.error.value"
            :echoes-hint-visible="noteEchoesDiscoverability.hintVisible.value"
            :local-context-items="localContextItems"
            :pinned-context-items="pinnedContextItems"
            :can-reason-on-context="!constitutedContext.isEmpty.value"
            :is-launching-context-action="contextActionLoading"
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
            @active-note-add-to-context="toggleActiveNoteInConstitutedContext()"
            @active-note-remove-from-context="toggleActiveNoteInConstitutedContext()"
            @active-note-open-cosmos="void openNoteInCosmosFromPalette()"
            @echoes-open="void onBacklinkOpen($event)"
            @echoes-add-to-context="addPathToConstitutedContext($event)"
            @echoes-remove-from-context="removePathFromConstitutedContext($event)"
            @outline-click="void onOutlineHeadingClick($event)"
            @backlink-open="void onBacklinkOpen($event)"
            @context-open="void onBacklinkOpen($event)"
            @context-remove-local="removeLocalPathFromConstitutedContext($event)"
            @context-remove-pinned="removePinnedPathFromConstitutedContext($event)"
            @context-pin="constitutedContext.pin()"
            @context-clear-local="constitutedContext.clearLocal()"
            @context-clear-pinned="constitutedContext.clearPinned()"
            @context-open-second-brain="void openConstitutedContextInSecondBrain()"
            @context-open-cosmos="void openConstitutedContextInCosmos()"
            @context-open-pulse="void openConstitutedContextInPulse()"
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
      :current-operation-label="indexCurrentOperationLabel"
      :current-operation-detail="indexCurrentOperationDetail"
      :current-operation-path="indexCurrentOperationPath"
      :current-operation-status-label="indexCurrentOperationStatusLabel"
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
      :has-text-query="quickOpenHasTextQuery"
      :action-groups="quickOpenActionGroups"
      :recent-results="quickOpenBrowseRecentResults"
      :browse-action-results="quickOpenBrowseActionResults"
      :file-results="quickOpenResults"
      :active-index="quickOpenActiveIndex"
      @close="closeQuickOpen()"
      @update:query="quickOpenQuery = $event"
      @keydown="onQuickOpenInputKeydown"
      @select-action="runQuickOpenAction"
      @select-result="openQuickResult"
      @set-active-index="setQuickOpenActiveIndex"
    />

    <ThemePickerModal
      :visible="themePickerVisible"
      :query="themePickerQuery"
      :items="themePickerItems"
      :active-index="themePickerActiveIndex"
      :selected-preference="themePreference"
      @close="closeThemePickerModal"
      @update:query="themePickerQuery = $event"
      @select="selectThemeFromModal"
      @preview="previewThemePickerItem"
      @keydown="onThemePickerInputKeydown"
      @set-active-index="themePickerActiveIndex = $event"
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
      @cancel="workspaceRouting.closeWorkspaceSetupWizard()"
      @submit="void workspaceRouting.applyWorkspaceSetupWizard($event)"
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
  background: var(--shell-chrome-bg);
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
