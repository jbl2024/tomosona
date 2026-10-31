<script setup lang="ts">
import { computed } from 'vue'
import type {
  PaletteResult,
  PaletteResultCategory,
  QuickOpenActionGroup,
  QuickOpenBrowseAction,
  QuickOpenResult
} from '../../composables/useAppQuickOpen'

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
  fileResults: QuickOpenResult[]
  /** Unified categorized results for a universal query. */
  categories?: PaletteResultCategory[]
  /** Favorite notes suggested in the browse state. */
  favoriteResults?: QuickOpenResult[]
  activeIndex: number
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  keydown: [event: KeyboardEvent]
  'select-action': [id: string]
  'select-result': [item: QuickOpenResult]
  'select-palette-result': [result: PaletteResult]
  'set-active-index': [index: number]
}>()

const paletteCategories = computed(() => props.categories ?? [])
const favoriteRows = computed(() => props.favoriteResults ?? [])

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
  if (result.kind === 'passage') return `passage-${result.path}-${index}`
  return `create-${index}`
}

function paletteResultTitle(result: PaletteResult): string {
  if (result.kind === 'note' || result.kind === 'passage') return result.title
  if (result.kind === 'command') return result.label
  if (result.kind === 'daily') return result.exists ? `Open daily note ${result.date}` : `Create daily note ${result.date}`
  return `Create "${result.title}"`
}

function paletteResultMeta(result: PaletteResult): string {
  if (result.kind === 'note') return result.folder
  if (result.kind === 'passage') return result.folder
  return ''
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
            <button
              v-for="(result, index) in category.results"
              :key="paletteResultKey(result, index)"
              type="button"
              class="palette-row palette-row-main"
              :class="{ active: activeIndex === category.startIndex + index }"
              @click="emit('select-palette-result', result)"
              @mousemove="emit('set-active-index', category.startIndex + index)"
            >
              <span class="palette-row-title">{{ paletteResultTitle(result) }}</span>
              <span v-if="paletteResultMeta(result)" class="palette-row-meta">{{ paletteResultMeta(result) }}</span>
            </button>
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
          <section v-if="recentResults.length" class="modal-section">
            <p class="modal-section-title">Recent notes</p>
            <button
              v-for="(item, index) in recentResults"
              :key="quickOpenItemKey(item)"
              type="button"
              class="modal-item modal-item-browse"
              :class="{ active: activeIndex === index }"
              @click="emit('select-result', item)"
              @mousemove="emit('set-active-index', index)"
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
              :class="{ active: activeIndex === recentResults.length + index }"
              @click="emit('select-result', item)"
              @mousemove="emit('set-active-index', recentResults.length + index)"
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
              :class="{ active: activeIndex === recentResults.length + favoriteRows.length + index }"
              @click="emit('select-action', item.id)"
              @mousemove="emit('set-active-index', recentResults.length + favoriteRows.length + index)"
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
