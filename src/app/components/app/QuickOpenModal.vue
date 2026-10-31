<script setup lang="ts">
import { computed } from 'vue'
import type {
  PaletteResult,
  PaletteResultCategory,
  PalettePassageMatch,
  PaletteTabActionId,
  QuickOpenActionGroup,
  QuickOpenBrowseAction,
  QuickOpenResult,
  QuickOpenTabMenu,
  QuickOpenTabMenuItem
} from '../../composables/useAppQuickOpen'
import { parseSearchSnippet } from '../../../shared/lib/searchSnippets'

/**
 * QuickOpenModal
 *
 * Purpose:
 * - Render the universal palette: unified categorized results for a query,
 *   grouped commands in `>` mode, and the browse state (recent notes,
 *   favorites, quick actions).
 *
 * Boundaries:
 * - Stateless presentational component.
 * - Parent owns query state, keyboard handling, and command execution.
 */

const props = defineProps<{
  visible: boolean
  query: string
  isActionMode: boolean
  hasTextQuery: boolean
  actionGroups: QuickOpenActionGroup[]
  recentResults: QuickOpenResult[]
  browseActionResults: QuickOpenBrowseAction[]
  /** Context-suggested actions ranked first in the browse state. */
  suggestionResults?: QuickOpenBrowseAction[]
  fileResults: QuickOpenResult[]
  /** Unified categorized results for a universal query. */
  categories?: PaletteResultCategory[]
  /** Favorite notes suggested in the browse state. */
  favoriteResults?: QuickOpenResult[]
  activeIndex: number
  /** Secondary-actions menu opened with Tab on a note result. */
  tabMenu?: QuickOpenTabMenu | null
  /** Rows of the open secondary-actions menu. */
  tabMenuItems?: QuickOpenTabMenuItem[]
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  keydown: [event: KeyboardEvent]
  'select-action': [id: string]
  'select-result': [item: QuickOpenResult]
  'select-palette-result': [result: PaletteResult]
  'set-active-index': [index: number]
  'open-tab-menu': [path: string, title: string]
  'close-tab-menu': []
  'set-tab-menu-item-index': [index: number]
  'run-tab-menu-action': [menu: QuickOpenTabMenu, action: PaletteTabActionId]
}>()

const paletteCategories = computed(() => props.categories ?? [])
const favoriteRows = computed(() => props.favoriteResults ?? [])
const suggestionRows = computed(() => props.suggestionResults ?? [])
const tabMenu = computed(() => props.tabMenu ?? null)
const tabMenuRows = computed(() => props.tabMenuItems ?? [])

function isTabMenuOpenFor(path: string) {
  return tabMenu.value?.path === path
}

function toggleTabMenu(path: string, title: string) {
  if (isTabMenuOpenFor(path)) emit('close-tab-menu')
  else emit('open-tab-menu', path, title)
}

function passageParts(match: PalettePassageMatch) {
  return parseSearchSnippet(match.snippet)
}

/**
 * True when the passage row continues a same-note group: consecutive matches
 * from one note share the group's title, so only the snippet differs.
 */
function isPassageContinuation(category: PaletteResultCategory, index: number): boolean {
  if (index <= 0) return false
  const previous = category.results[index - 1]
  const current = category.results[index]
  return current.kind === 'passage' && previous.kind === 'passage' && previous.path === current.path
}

/** True when the query produced no results beyond the create action. */
const hasNoPaletteResults = computed(() =>
  !props.isActionMode
  && props.hasTextQuery
  && paletteCategories.value.every((category) => category.id === 'create')
)

function isActionAvailable(item: { isEnabled?: () => boolean }): boolean {
  return item.isEnabled?.() ?? true
}

function quickOpenItemKey(item: QuickOpenResult): string {
  if (item.kind === 'daily') return `daily-${item.date}`
  if (item.kind === 'recent') return `recent-${item.path}`
  return item.path
}

function paletteResultKey(result: PaletteResult, index: number): string {
  if (result.kind === 'note') return `note-${result.path}`
  if (result.kind === 'command') return `command-${result.actionId}`
  if (result.kind === 'daily') return `daily-${result.date}`
  if (result.kind === 'help') return `help-${result.id}`
  if (result.kind === 'passage') return `passage-${result.path}-${index}`
  return `create-${index}`
}

function paletteResultTitle(result: PaletteResult): string {
  if (result.kind === 'note' || result.kind === 'passage') return result.title
  if (result.kind === 'command') return result.label
  if (result.kind === 'daily') return result.exists ? `Open daily note ${result.date}` : `Create daily note ${result.date}`
  if (result.kind === 'help') return result.label
  return `Create "${result.title}"`
}

function paletteResultMeta(result: PaletteResult): string {
  if (result.kind === 'note') return result.folder
  if (result.kind === 'passage') return result.folder
  if (result.kind === 'help') return result.description
  return ''
}

function firstPassageMatch(result: PaletteResult): PalettePassageMatch | null {
  return result.kind === 'passage' && result.matches.length ? result.matches[0] : null
}

function switchToCommandSearch() {
  emit('update:query', `>${props.query}`)
}

const actionSections = computed(() => {
  let startIndex = 0
  return props.actionGroups.map((group) => {
    const nextGroup = {
      ...group,
      startIndex
    }
    startIndex += group.items.length
    return nextGroup
  })
})

function onQuickOpenInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:query', value)
}

function onQuickOpenKeydown(event: KeyboardEvent) {
  emit('keydown', event)
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
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
      <p id="quick-open-description" class="sr-only">
        Search notes, content, and commands. Start with greater-than for commands, hash for content, or question mark for help.
      </p>
      <input
        :value="query"
        data-quick-open-input="true"
        class="tool-input"
        placeholder="Search a note, content, or action..."
        @input="onQuickOpenInput"
        @keydown="onQuickOpenKeydown"
      />
      <div class="modal-list">
        <template v-if="isActionMode">
          <section v-for="group in actionSections" :key="group.family" class="modal-section">
            <p class="modal-section-title">{{ group.label }}</p>
            <div
              v-for="(item, index) in group.items"
              :key="item.id"
              class="palette-row"
              :class="{ active: activeIndex === group.startIndex + index, unavailable: !isActionAvailable(item) }"
              @mousemove="emit('set-active-index', group.startIndex + index)"
            >
              <button
                type="button"
                class="palette-row-main"
                :disabled="!isActionAvailable(item)"
                @click="isActionAvailable(item) && emit('select-action', item.id)"
              >
                <span class="palette-row-title">{{ item.label }}</span>
                <span v-if="item.description" class="palette-row-meta">{{ item.description }}</span>
                <span v-if="!isActionAvailable(item) && item.unavailableReason" class="palette-row-meta">{{ item.unavailableReason }}</span>
              </button>
              <span v-if="!isActionAvailable(item)" class="palette-badge">Unavailable</span>
              <span v-else-if="item.shortcutLabel" class="palette-shortcut">{{ item.shortcutLabel }}</span>
            </div>
          </section>
        </template>
        <template v-else-if="hasTextQuery && paletteCategories.length">
          <p v-if="hasNoPaletteResults" class="placeholder">No results for "{{ query }}"</p>
          <p v-if="hasNoPaletteResults" class="palette-hint">
            <button type="button" class="palette-hint-button" @click="switchToCommandSearch">Search in commands</button>
          </p>
          <section v-for="category in paletteCategories" :key="category.id" class="modal-section">
            <p class="modal-section-title">{{ category.label }}</p>
            <template v-for="(result, index) in category.results" :key="paletteResultKey(result, index)">
              <div
                v-if="result.kind === 'note'"
                class="palette-row"
                :class="{ active: activeIndex === category.startIndex + index }"
                @mousemove="emit('set-active-index', category.startIndex + index)"
              >
                <button
                  type="button"
                  class="palette-row-main"
                  @click="emit('select-palette-result', result)"
                >
                  <span class="palette-row-title">{{ result.title }}</span>
                  <span v-if="result.folder" class="palette-row-meta">{{ result.folder }}</span>
                </button>
                <button
                  type="button"
                  class="palette-more"
                  title="More actions (Tab)"
                  :aria-expanded="isTabMenuOpenFor(result.path)"
                  @click.stop="toggleTabMenu(result.path, result.title)"
                >
                  More
                </button>
              </div>
              <button
                v-else-if="result.kind !== 'passage'"
                type="button"
                class="palette-row palette-row-main"
                :class="{ active: activeIndex === category.startIndex + index }"
                @click="emit('select-palette-result', result)"
                @mousemove="emit('set-active-index', category.startIndex + index)"
              >
                <span class="palette-row-title">{{ paletteResultTitle(result) }}</span>
                <span v-if="paletteResultMeta(result)" class="palette-row-meta">{{ paletteResultMeta(result) }}</span>
              </button>
              <div v-if="result.kind === 'note' && isTabMenuOpenFor(result.path)" class="palette-tab-menu" data-quick-open-tab-menu="true">
                <button
                  v-for="(item, itemIndex) in tabMenuRows"
                  :key="item.id"
                  type="button"
                  class="palette-tab-menu-item"
                  :class="{ active: tabMenu && tabMenu.itemIndex === itemIndex }"
                  @click="tabMenu && emit('run-tab-menu-action', tabMenu, item.id)"
                  @mousemove="emit('set-tab-menu-item-index', itemIndex)"
                >
                  {{ item.label }}
                </button>
              </div>
              <div
                v-if="result.kind === 'passage'"
                class="palette-row"
                :class="{ active: activeIndex === category.startIndex + index, grouped: isPassageContinuation(category, index) }"
                @mousemove="emit('set-active-index', category.startIndex + index)"
              >
                <button
                  type="button"
                  class="palette-row-main"
                  @click="emit('select-palette-result', result)"
                >
                  <template v-if="!isPassageContinuation(category, index)">
                    <span class="palette-row-title">{{ result.title }}</span>
                    <span v-if="result.folder" class="palette-row-meta">{{ result.folder }}</span>
                  </template>
                  <span v-if="firstPassageMatch(result)" class="palette-row-snippet">
                    <template v-for="(part, partIndex) in passageParts(firstPassageMatch(result)!)" :key="partIndex">
                      <mark v-if="part.highlighted" class="palette-snippet-mark">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </button>
              </div>
            </template>
          </section>
        </template>
        <template v-else-if="hasTextQuery">
          <button
            v-for="(item, index) in fileResults"
            :key="quickOpenItemKey(item)"
            type="button"
            class="modal-item"
            :class="{ active: activeIndex === index }"
            @click="emit('select-result', item)"
            @mousemove="emit('set-active-index', index)"
          >
            {{ item.label }}
          </button>
        </template>
        <template v-else>
          <section v-if="suggestionRows.length" class="modal-section">
            <p class="modal-section-title">Suggested</p>
            <button
              v-for="(item, index) in suggestionRows"
              :key="item.id"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === index }"
              @click="emit('select-action', item.id)"
              @mousemove="emit('set-active-index', index)"
            >
              <span class="modal-item-main">{{ item.label }}</span>
            </button>
          </section>
          <section v-if="recentResults.length" class="modal-section">
            <p class="modal-section-title">Recent notes</p>
            <button
              v-for="(item, index) in recentResults"
              :key="quickOpenItemKey(item)"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === suggestionRows.length + index }"
              @click="emit('select-result', item)"
              @mousemove="emit('set-active-index', suggestionRows.length + index)"
            >
              <span class="modal-item-main">{{ item.label }}</span>
              <span v-if="item.kind === 'recent'" class="modal-item-meta">{{ item.recencyLabel }}</span>
            </button>
          </section>
          <section v-if="favoriteRows.length" class="modal-section">
            <p class="modal-section-title">Favorites</p>
            <button
              v-for="(item, index) in favoriteRows"
              :key="quickOpenItemKey(item)"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === suggestionRows.length + recentResults.length + index }"
              @click="emit('select-result', item)"
              @mousemove="emit('set-active-index', suggestionRows.length + recentResults.length + index)"
            >
              <span class="modal-item-main">{{ item.label }}</span>
            </button>
          </section>
          <section v-if="browseActionResults.length" class="modal-section">
            <p class="modal-section-title">Quick actions</p>
            <button
              v-for="(item, index) in browseActionResults"
              :key="item.id"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === suggestionRows.length + recentResults.length + favoriteRows.length + index }"
              @click="emit('select-action', item.id)"
              @mousemove="emit('set-active-index', suggestionRows.length + recentResults.length + favoriteRows.length + index)"
            >
              <span class="modal-item-main">{{ item.label }}</span>
            </button>
          </section>
        </template>
        <div v-if="isActionMode && !actionSections.length" class="placeholder">No matching actions</div>
        <div v-else-if="hasTextQuery && !paletteCategories.length && !fileResults.length" class="placeholder">No matching files</div>
        <div v-else-if="!isActionMode && !hasTextQuery && !recentResults.length && !favoriteRows.length && !browseActionResults.length" class="placeholder">
          No recent notes yet
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
.quick-open {
  border-color: var(--command-palette-border);
  background: var(--command-palette-bg);
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
  border: 1px solid var(--command-palette-item-border);
  background: var(--command-palette-item-bg);
  border-radius: 4px;
  padding: 6px;
  text-align: left;
  font-size: 12px;
  color: var(--command-palette-item-text);
}

.modal-item-browse {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.modal-item.active {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}

.modal-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-section + .modal-section {
  margin-top: 8px;
}

.modal-section-title {
  margin: 4px 2px 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.modal-item-main {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-item-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-dim);
}

/* Unified palette rows: two-line layout with title, meta, and side hints. */
.palette-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--command-palette-item-border);
  background: var(--command-palette-item-bg);
  border-radius: 4px;
  padding: 6px 8px;
  text-align: left;
  font-size: 12px;
  color: var(--command-palette-item-text);
}

.palette-row-main {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
}

.palette-row-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.palette-row-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-dim);
}

.palette-row.active {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}

.palette-row.unavailable {
  opacity: 0.6;
}

.palette-badge {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.palette-shortcut {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-dim);
}

/* Content passage rows: snippet line with highlighted match marks. */
.palette-row-snippet {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-dim);
}

.palette-snippet-mark {
  background: transparent;
  color: inherit;
  font-weight: 700;
}

/* Same-note passage continuation rows share the group title; indent the
   snippet so the visual group stays readable. */
.palette-row.grouped .palette-row-main {
  padding-left: 12px;
}

/* Secondary-actions toggle on note rows; stays visually quiet so the main
   open path dominates. */
.palette-more {
  flex: 0 0 auto;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}

.palette-more:hover,
.palette-more[aria-expanded='true'] {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}

/* Secondary-actions menu rendered under its note row. */
.palette-tab-menu {
  margin: 1px 0 2px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-tab-menu-item {
  border: 1px solid var(--command-palette-item-border);
  background: var(--command-palette-item-bg);
  border-radius: 4px;
  padding: 4px 8px;
  text-align: left;
  font-size: 12px;
  color: var(--command-palette-item-text);
}

.palette-tab-menu-item.active {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}

.palette-hint {
  margin: 2px;
}

.palette-hint-button {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
}

/* Narrow surfaces abbreviate secondary lines; the title stays readable and
   the keyboard behavior is unchanged. */
@media (max-width: 560px) {
  .palette-row-meta,
  .palette-shortcut {
    display: none;
  }
}
</style>
