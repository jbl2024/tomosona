<script setup lang="ts">
import { FolderIcon, MagnifyingGlassIcon, StarIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import SearchSidebarPanel from './SearchSidebarPanel.vue'
import ExplorerTree from '../../../domains/explorer/components/ExplorerTree.vue'
import FavoritesListPanel from '../../../domains/favorites/components/FavoritesListPanel.vue'
import type { SearchMode } from '../../../shared/lib/searchMode'
import type { FavoriteEntry, PathMove } from '../../../shared/api/apiTypes'

/**
 * Module: SidebarSurface
 *
 * Purpose:
 * - Render the app-shell activity bar and left sidebar container.
 * - Keep sidebar markup out of `App.vue` while preserving shell-owned state.
 */

type SearchHit = { path: string; snippet: string; score: number }
type SearchResultGroup = { path: string; items: SearchHit[] }

/** Props required to render the app shell sidebar and its two panel modes. */
const props = defineProps<{
  sidebarVisible: boolean
  sidebarMode: 'explorer' | 'favorites' | 'search'
  workingFolderPath: string
  hasWorkspace: boolean
  leftPaneWidth: number
  activeFilePath: string
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
}>()

/** Events emitted by sidebar controls so the parent shell remains the only state owner. */
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
}>()

const explorerTreeRef = ref<InstanceType<typeof ExplorerTree> | null>(null)
const sidebarTitle = computed(() => props.sidebarMode)

/** Forwards explorer tree path reveal to the parent shell without leaking internals. */
async function revealPathInView(
  path: string,
  options?: { focusTree?: boolean; behavior?: ScrollBehavior }
): Promise<void> {
  await explorerTreeRef.value?.revealPathInView(path, options)
}

defineExpose({
  revealPathInView
})
</script>

<template>
  <aside class="activity-bar">
    <button
      class="activity-btn"
      :class="{ active: sidebarMode === 'explorer' && sidebarVisible }"
      type="button"
      title="Explorer"
      aria-label="Explorer"
      @click="emit('setSidebarMode', 'explorer')"
    >
      <FolderIcon class="activity-btn-icon" />
    </button>
    <button
      class="activity-btn"
      :class="{ active: sidebarMode === 'favorites' && sidebarVisible }"
      type="button"
      title="Favorites"
      aria-label="Favorites"
      @click="emit('setSidebarMode', 'favorites')"
    >
      <StarIcon class="activity-btn-icon" />
    </button>
    <button
      class="activity-btn"
      :class="{ active: sidebarMode === 'search' && sidebarVisible }"
      type="button"
      title="Search"
      aria-label="Search"
      @click="emit('setSidebarMode', 'search')"
    >
      <MagnifyingGlassIcon class="activity-btn-icon" />
    </button>
  </aside>

  <aside
    v-if="sidebarVisible"
    class="left-sidebar"
    :style="{ width: `${leftPaneWidth}px` }"
  >
    <div class="panel-header">
      <h2 class="panel-title">{{ sidebarTitle }}</h2>
    </div>

    <div class="panel-body" :class="{ 'panel-body-explorer': sidebarMode === 'explorer' }">
      <div v-if="sidebarMode === 'explorer'" class="panel-fill">
        <ExplorerTree
          v-if="hasWorkspace"
          ref="explorerTreeRef"
          :folder-path="workingFolderPath"
          :active-path="activeFilePath"
          @open="emit('explorerOpen', $event)"
          @path-renamed="emit('explorerPathRenamed', $event)"
          @paths-moved="emit('explorerPathsMoved', $event)"
          @paths-deleted="emit('explorerPathsDeleted', $event)"
          @request-create="emit('explorerRequestCreate', $event)"
          @select="emit('explorerSelection', $event)"
          @error="emit('explorerError', $event)"
        />
        <div v-else class="placeholder empty-explorer">
          <span>No workspace selected.</span>
          <button type="button" class="inline-link-btn" @click="emit('selectWorkingFolder')">Open folder</button>
        </div>
      </div>

      <FavoritesListPanel
        v-else-if="sidebarMode === 'favorites'"
        :items="favoriteItems"
        :active-path="activeFilePath"
        :loading="favoritesLoading"
        :to-relative-path="toRelativePath"
        @open="emit('favoritesOpen', $event)"
        @remove="emit('favoritesRemove', $event)"
      />

      <SearchSidebarPanel
        v-else-if="sidebarMode === 'search'"
        :disabled="!hasWorkspace"
        :working-folder-path="workingFolderPath"
        :query="searchQuery"
        :mode="globalSearchMode"
        :mode-options="searchModeOptions"
        :show-search-score="showSearchScore"
        :has-searched="hasSearched"
        :search-loading="searchLoading"
        :grouped-results="groupedSearchResults"
        :to-relative-path="toRelativePath"
        :format-search-score="formatSearchScore"
        :snippet-parts="parseSearchSnippet"
        @update:query="emit('updateSearchQuery', $event)"
        @enter="emit('runGlobalSearch')"
        @select-mode="emit('selectGlobalSearchMode', $event)"
        @open-result="emit('openSearchResult', $event)"
      />

      <div v-else class="placeholder">No panel selected</div>
    </div>
  </aside>
</template>

<style scoped>
.activity-bar {
  width: 44px;
  border-right: 1px solid var(--left-rail-border);
  background: var(--left-rail-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  gap: 6px;
}

.activity-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--left-rail-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.activity-btn:hover {
  background: var(--left-rail-hover-bg);
  color: var(--left-rail-text-strong);
}

.activity-btn.active {
  color: var(--left-rail-active-text);
  border-color: var(--left-rail-active-border);
  box-shadow: inset 2px 0 0 var(--left-rail-active-indicator);
  background: var(--left-rail-active-bg);
}

.activity-btn-icon {
  width: 14px;
  height: 14px;
  stroke-width: 1.6;
}

.left-sidebar {
  min-width: 0;
  min-height: 0;
  background: var(--left-sidebar-bg);
  border-right: 1px solid var(--left-sidebar-border);
  display: flex;
  flex-direction: column;
}

.panel-header {
  height: 34px;
  border-bottom: 1px solid var(--left-sidebar-border);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 8px;
}

.panel-title {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--left-sidebar-title);
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
  color: var(--left-sidebar-link);
  font-size: 12px;
  font-weight: 500;
  padding: 0;
  text-decoration: underline;
  cursor: pointer;
}

.inline-link-btn:hover {
  color: var(--left-sidebar-link-hover);
}
</style>
