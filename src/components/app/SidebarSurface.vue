<script setup lang="ts">
import { FolderIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import SearchSidebarPanel from './SearchSidebarPanel.vue'
import ExplorerTree from '../explorer/ExplorerTree.vue'
import type { SearchMode } from '../../lib/searchMode'

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
  sidebarMode: 'explorer' | 'search'
  workingFolderPath: string
  hasWorkspace: boolean
  leftPaneWidth: number
  activeFilePath: string
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
  setSidebarMode: [mode: 'explorer' | 'search']
  explorerOpen: [path: string]
  explorerPathRenamed: [payload: { from: string; to: string }]
  explorerRequestCreate: [payload: { parentPath: string; entryKind: 'file' | 'folder' }]
  explorerSelection: [paths: string[]]
  explorerError: [message: string]
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
          @request-create="emit('explorerRequestCreate', $event)"
          @select="emit('explorerSelection', $event)"
          @error="emit('explorerError', $event)"
        />
        <div v-else class="placeholder empty-explorer">
          <span>No workspace selected.</span>
          <button type="button" class="inline-link-btn" @click="emit('selectWorkingFolder')">Open folder</button>
        </div>
      </div>

      <SearchSidebarPanel
        v-else-if="sidebarMode === 'search'"
        :disabled="!hasWorkspace"
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
  border-right: 1px solid #e5e7eb;
  background: #f2f4f8;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  gap: 6px;
}

:global(.ide-root.dark) .activity-bar {
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

:global(.ide-root.dark) .activity-btn {
  color: #8b93a3;
}

:global(.ide-root.dark) .activity-btn.active {
  color: #d7dce5;
  border-color: #3e4451;
  background: #282c34;
}

:global(.ide-root.dark) .activity-btn:hover {
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

:global(.ide-root.dark) .left-sidebar {
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

:global(.ide-root.dark) .panel-header {
  border-bottom-color: #3e4451;
}

.panel-title {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4b5563;
}

:global(.ide-root.dark) .panel-title {
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

:global(.ide-root.dark) .inline-link-btn {
  color: #61afef;
}

:global(.ide-root.dark) .inline-link-btn:hover {
  color: #7ec5ff;
}
</style>
