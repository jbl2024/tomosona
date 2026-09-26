<script setup lang="ts">
import { ref } from 'vue'
import SidebarSurface from './SidebarSurface.vue'
import EditorRightPane from '../../../domains/editor/components/EditorRightPane.vue'
import type { SearchMode } from '../../../shared/lib/searchMode'
import type { FavoriteEntry } from '../../../shared/api/apiTypes'
import type { PathMove } from '../../../shared/api/apiTypes'

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
type HeadingNode = { level: 1 | 2 | 3; text: string }
type PropertyPreviewRow = { key: string; value: string }
type MetadataRow = { label: string; value: string }

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
  activeNoteSourceToggleLabel?: string
  backlinkCount: number
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
  outline: HeadingNode[]
  backlinks: string[]
  backlinksLoading: boolean
  backlinksError: string
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
  explorerConvertToWord: [path: string]
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
  launchpadQuickStart: [kind: 'today' | 'second-brain' | 'command-palette']
  toggleFavorite: []
  activeNoteOpenHistory: []
  activeNoteToggleSourceMode: []
  outlineClick: [payload: { index: number; heading: HeadingNode }]
  backlinkOpen: [path: string]
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
      @explorer-convert-to-word="emit('explorerConvertToWord', $event)"
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
          :active-note-source-toggle-label="activeNoteSourceToggleLabel"
          :backlink-count="backlinkCount"
          :indexing-state="indexingState"
          :can-toggle-favorite="canToggleFavorite"
          :is-favorite="isFavorite"
          :outline="outline"
          :backlinks="backlinks"
          :backlinks-loading="backlinksLoading"
          :backlinks-error="backlinksError"
          :metadata-rows="metadataRows"
          :properties-preview="propertiesPreview"
          :property-parse-error-count="propertyParseErrorCount"
          :to-relative-path="toRelativePath"
          @toggle-favorite="emit('toggleFavorite')"
          @open-note-history="emit('activeNoteOpenHistory')"
          @active-note-toggle-source-mode="emit('activeNoteToggleSourceMode')"
          @outline-click="emit('outlineClick', $event)"
          @backlink-open="emit('backlinkOpen', $event)"
        />
      </div>
      <slot name="terminal" />
    </section>
  </div>
</template>
