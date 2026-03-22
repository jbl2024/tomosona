<script setup lang="ts">
import { ref } from 'vue'
import SidebarSurface from './SidebarSurface.vue'
import EditorRightPane from '../../../domains/editor/components/EditorRightPane.vue'
import type { SearchMode } from '../../../shared/lib/searchMode'
import type { FavoriteEntry } from '../../../shared/api/apiTypes'
import type { PathMove } from '../../../shared/api/apiTypes'
import type { ConstitutedContextItem } from '../../../domains/editor/composables/useConstitutedContext'
import type { EchoesItem } from '../../../domains/echoes/lib/echoes'

/**
 * Module: AppShellWorkspaceSurface
 *
 * Purpose:
 * - Own the shell workspace layout so `App.vue` only wires data and actions.
 *
 * Boundary:
 * - The parent owns editor state and shell orchestration.
 * - This surface only assembles the sidebar, editor column, splitters, and
 *   right pane.
 */

type SearchHit = { path: string; snippet: string; score: number }
type SearchResultGroup = { path: string; items: SearchHit[] }
type ContextEchoesItem = EchoesItem & { isInContext: boolean }
type HeadingNode = { level: 1 | 2 | 3; text: string }
type PropertyPreviewRow = { key: string; value: string }
type MetadataRow = { label: string; value: string }
type SemanticLinkRow = { path: string; score: number | null; direction: 'incoming' | 'outgoing' }

export type AppShellWorkspaceSurfaceExposed = {
  revealPathInView: (
    path: string,
    options?: { focusTree?: boolean; behavior?: ScrollBehavior }
  ) => Promise<void>
}

defineProps<{
  sidebarVisible: boolean
  sidebarMode: 'explorer' | 'favorites' | 'search'
  workingFolderPath: string
  hasWorkspace: boolean
  leftPaneWidth: number
  rightPaneVisible: boolean
  rightPaneWidth: number
  activeFilePath: string
  activeNoteTitle: string
  activeStateLabel: string
  backlinkCount: number
  semanticLinkCount: number
  activeNoteInContext: boolean
  indexingState: 'indexed' | 'indexing' | 'out_of_sync'
  favoriteItems: FavoriteEntry[]
  favoritesLoading: boolean
  searchQuery: string
  globalSearchMode: SearchMode
  searchModeOptions: Array<{ mode: SearchMode; label: string }>
  showSearchScore: boolean
  hasSearched: boolean
  searchLoading: boolean
  groupedSearchResults: SearchResultGroup[]
  toRelativePath: (path: string) => string
  formatSearchScore: (value: number) => string
  parseSearchSnippet: (snippet: string) => Array<{ text: string; highlighted: boolean }>
  canToggleFavorite: boolean
  isFavorite: boolean
  echoesItems: ContextEchoesItem[]
  echoesLoading: boolean
  echoesError: string
  echoesHintVisible: boolean
  localContextItems: ConstitutedContextItem[]
  pinnedContextItems: ConstitutedContextItem[]
  canReasonOnContext: boolean
  isLaunchingContextAction: boolean
  outline: HeadingNode[]
  semanticLinks: SemanticLinkRow[]
  semanticLinksLoading: boolean
  backlinks: string[]
  backlinksLoading: boolean
  metadataRows: MetadataRow[]
  propertiesPreview: PropertyPreviewRow[]
  propertyParseErrorCount: number
}>()

const emit = defineEmits<{
  setSidebarMode: [mode: 'explorer' | 'favorites' | 'search']
  explorerOpen: [path: string]
  explorerPathRenamed: [payload: { from: string; to: string }]
  explorerPathsMoved: [moves: PathMove[]]
  explorerPathsDeleted: [paths: string[]]
  explorerRequestCreate: [payload: { parentPath: string; entryKind: 'file' | 'folder' }]
  explorerSelection: [paths: string[]]
  explorerError: [message: string]
  favoritesOpen: [path: string]
  favoritesRemove: [path: string]
  selectWorkingFolder: []
  updateSearchQuery: [value: string]
  runGlobalSearch: []
  selectGlobalSearchMode: [mode: SearchMode]
  openSearchResult: [hit: SearchHit]
  resizeStart: [side: 'left' | 'right', event: MouseEvent]
  paneTabClick: [payload: { paneId: string; tabId: string }]
  paneTabClose: [payload: { paneId: string; tabId: string }]
  paneTabCloseOthers: [payload: { paneId: string; tabId: string }]
  paneTabCloseAll: [payload: { paneId: string }]
  paneFocus: [payload: { paneId: string }]
  paneRequestMoveTab: [payload: { paneId: string; direction: 'next' | 'previous' }]
  status: [payload: { path: string; dirty: boolean; saving: boolean; saveError: string }]
  pathRenamed: [payload: { from: string; to: string; manual: boolean }]
  outline: [payload: HeadingNode[]]
  properties: [payload: { path: string; items: Array<{ key: string; value: string }>; parseErrorCount: number }]
  pulseOpenSecondBrain: [payload: { contextPaths: string[]; prompt?: string }]
  externalReload: [payload: { path: string }]
  secondBrainContextChanged: [paths: string[]]
  secondBrainSessionChanged: [sessionId: string]
  alterOpenSecondBrain: [alterId: string]
  cosmosQueryUpdate: [value: string]
  cosmosSearchEnter: []
  cosmosSelectMatch: [nodeId: string]
  cosmosToggleFocusMode: [value: boolean]
  cosmosToggleSemanticEdges: [value: boolean]
  cosmosExpandNeighborhood: []
  cosmosJumpRelated: [nodeId: string]
  cosmosOpenSelected: []
  cosmosLocateSelected: []
  cosmosResetView: []
  cosmosSelectNode: [nodeId: string]
  cosmosAddToContext: [path: string]
  openNote: [path: string]
  launchpadOpenWorkspace: []
  launchpadOpenWizard: []
  launchpadOpenCommandPalette: []
  launchpadOpenShortcuts: []
  launchpadOpenRecentWorkspace: [path: string]
  launchpadOpenToday: []
  launchpadOpenQuickOpen: []
  launchpadCreateNote: []
  launchpadOpenRecentNote: [path: string]
  launchpadQuickStart: [kind: 'today' | 'second-brain' | 'cosmos' | 'command-palette' | 'alters']
  toggleFavorite: []
  activeNoteAddToContext: []
  activeNoteRemoveFromContext: []
  activeNoteOpenCosmos: []
  echoesOpen: [path: string]
  echoesAddToContext: [path: string]
  echoesRemoveFromContext: [path: string]
  echoesReindex: []
  outlineClick: [payload: { index: number; heading: HeadingNode }]
  backlinkOpen: [path: string]
  contextOpen: [path: string]
  contextRemoveLocal: [path: string]
  contextRemovePinned: [path: string]
  contextPin: []
  contextClearLocal: []
  contextClearPinned: []
  contextOpenSecondBrain: []
  contextOpenCosmos: []
  contextOpenPulse: []
}>()

const sidebarRef = ref<InstanceType<typeof SidebarSurface> | null>(null)

function revealPathInView(
  path: string,
  options?: { focusTree?: boolean; behavior?: ScrollBehavior }
): Promise<void> {
  return sidebarRef.value?.revealPathInView(path, options) ?? Promise.resolve()
}

defineExpose<AppShellWorkspaceSurfaceExposed>({
  revealPathInView
})
</script>

<template>
  <div class="body-row">
    <SidebarSurface
      ref="sidebarRef"
      :sidebar-visible="sidebarVisible"
      :sidebar-mode="sidebarMode"
      :working-folder-path="workingFolderPath"
      :has-workspace="hasWorkspace"
      :left-pane-width="leftPaneWidth"
      :active-file-path="activeFilePath"
      :favorite-items="favoriteItems"
      :favorites-loading="favoritesLoading"
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
      @set-sidebar-mode="emit('setSidebarMode', $event)"
      @explorer-open="emit('explorerOpen', $event)"
      @explorer-path-renamed="emit('explorerPathRenamed', $event)"
      @explorer-paths-moved="emit('explorerPathsMoved', $event)"
      @explorer-paths-deleted="emit('explorerPathsDeleted', $event)"
      @explorer-request-create="emit('explorerRequestCreate', $event)"
      @explorer-selection="emit('explorerSelection', $event)"
      @explorer-error="emit('explorerError', $event)"
      @favorites-open="emit('favoritesOpen', $event)"
      @favorites-remove="emit('favoritesRemove', $event)"
      @select-working-folder="emit('selectWorkingFolder')"
      @update-search-query="emit('updateSearchQuery', $event)"
      @run-global-search="emit('runGlobalSearch')"
      @select-global-search-mode="emit('selectGlobalSearchMode', $event)"
      @open-search-result="emit('openSearchResult', $event)"
    />

    <section class="workspace-column">
      <div class="workspace-row">
        <div
          v-if="sidebarVisible"
          class="splitter"
          @mousedown="emit('resizeStart', 'left', $event)"
        ></div>

        <main class="center-area">
          <slot name="center" />
        </main>

        <div
          v-if="rightPaneVisible"
          class="splitter"
          @mousedown="emit('resizeStart', 'right', $event)"
        ></div>

        <EditorRightPane
          v-if="rightPaneVisible"
          :width="rightPaneWidth"
          :active-note-path="activeFilePath"
          :active-note-title="activeNoteTitle"
          :active-state-label="activeStateLabel"
          :backlink-count="backlinkCount"
          :semantic-link-count="semanticLinkCount"
          :active-note-in-context="activeNoteInContext"
          :indexing-state="indexingState"
          :can-toggle-favorite="canToggleFavorite"
          :is-favorite="isFavorite"
          :echoes-items="echoesItems"
          :echoes-loading="echoesLoading"
          :echoes-error="echoesError"
          :echoes-hint-visible="echoesHintVisible"
          :local-context-items="localContextItems"
          :pinned-context-items="pinnedContextItems"
          :can-reason-on-context="canReasonOnContext"
          :is-launching-context-action="isLaunchingContextAction"
          :outline="outline"
          :semantic-links="semanticLinks"
          :semantic-links-loading="semanticLinksLoading"
          :backlinks="backlinks"
          :backlinks-loading="backlinksLoading"
          :metadata-rows="metadataRows"
          :properties-preview="propertiesPreview"
          :property-parse-error-count="propertyParseErrorCount"
          :to-relative-path="toRelativePath"
          @toggle-favorite="emit('toggleFavorite')"
          @active-note-add-to-context="emit('activeNoteAddToContext')"
          @active-note-remove-from-context="emit('activeNoteRemoveFromContext')"
          @active-note-open-cosmos="emit('activeNoteOpenCosmos')"
          @echoes-open="emit('echoesOpen', $event)"
          @echoes-add-to-context="emit('echoesAddToContext', $event)"
          @echoes-remove-from-context="emit('echoesRemoveFromContext', $event)"
          @echoes-reindex="emit('echoesReindex')"
          @outline-click="emit('outlineClick', $event)"
          @backlink-open="emit('backlinkOpen', $event)"
          @context-open="emit('contextOpen', $event)"
          @context-remove-local="emit('contextRemoveLocal', $event)"
          @context-remove-pinned="emit('contextRemovePinned', $event)"
          @context-pin="emit('contextPin')"
          @context-clear-local="emit('contextClearLocal')"
          @context-clear-pinned="emit('contextClearPinned')"
          @context-open-second-brain="emit('contextOpenSecondBrain')"
          @context-open-cosmos="emit('contextOpenCosmos')"
          @context-open-pulse="emit('contextOpenPulse')"
        />
      </div>
    </section>
  </div>
</template>
