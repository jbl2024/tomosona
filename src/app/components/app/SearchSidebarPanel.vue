<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../shared/components/ui/UiFilterableDropdown.vue'
import { readPropertyKeys, readPropertyTypeSchema, readPropertyValueSuggestions } from '../../../shared/api/indexApi'
import { applySearchMode, detectSearchMode, stripSearchModePrefix, type SearchMode } from '../../../shared/lib/searchMode'

/**
 * SearchSidebarPanel
 *
 * Purpose:
 * - Render the search sidebar controls and grouped search results.
 * - Surface property-aware search affordances without moving search orchestration
 *   out of the shell.
 */

type SearchHit = { path: string; snippet: string; score: number }
type SearchResultGroup = { path: string; items: SearchHit[] }
type SearchSuggestionKind = 'key' | 'value'
type SearchSuggestionItem = FilterableDropdownItem & {
  kind: SearchSuggestionKind
  fragment: string
  description: string
  group: string
}
type QuickFilter = {
  label: string
  fragment: string
  description: string
}
type AutocompleteContext = {
  token: string
  prefix: string
  key: string
  valuePrefix: string
  mode: 'keys' | 'values'
}

const RESERVED_SEARCH_PREFIX_KEYS = new Set(['semantic', 'lexical', 'hybrid'])
const LISTLIKE_AUTOCOMPLETE_TYPES = new Set(['list', 'tags'])
const LISTLIKE_DEFAULT_KEYS = new Set(['tags', 'aliases', 'cssclasses'])

const props = defineProps<{
  disabled: boolean
  workingFolderPath: string
  query: string
  mode: SearchMode
  modeOptions: Array<{ mode: SearchMode; label: string }>
  showSearchScore: boolean
  hasSearched: boolean
  searchLoading: boolean
  groupedResults: SearchResultGroup[]
  toRelativePath: (path: string) => string
  formatSearchScore: (value: number) => string
  snippetParts: (snippet: string) => Array<{ text: string; highlighted: boolean }>
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  enter: []
  'select-mode': [mode: SearchMode]
  'open-result': [hit: SearchHit]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const dropdownRef = ref<{ menuEl?: HTMLElement | null } | null>(null)
const dropdownOpen = ref(false)
const dropdownActiveIndex = ref(0)
const propertyKeys = ref<string[]>([])
const propertyTypeSchema = ref<Record<string, string>>({})
const propertyKeysLoading = ref(false)
const propertyKeysLoaded = ref(false)
const propertyTypeSchemaLoading = ref(false)
const propertyTypeSchemaLoaded = ref(false)
const propertyValuesByKey = ref<Record<string, string[]>>({})
const propertyValuesLoading = ref<Record<string, boolean>>({})
const propertyValuesLoaded = ref<Record<string, boolean>>({})
let autocompleteRequestToken = 0

const quickFilters: QuickFilter[] = [
  { label: 'Tags', fragment: 'tags:', description: 'Match a tag value.' },
  { label: 'Status', fragment: 'status:', description: 'Match a workflow state.' },
  { label: 'Category', fragment: 'category:', description: 'Match a content category.' },
  { label: 'Deadline', fragment: 'deadline:', description: 'Match a due date.' },
  { label: 'Created', fragment: 'created:', description: 'Match a creation date.' },
  { label: 'Updated', fragment: 'updated:', description: 'Match a last update date.' },
  { label: 'Priority', fragment: 'priority:', description: 'Match a priority value.' },
  { label: 'Has property', fragment: 'has:', description: 'Require a property to exist.' }
]

const baseQuery = computed(() => stripSearchModePrefix(props.query))
const modePrefixOnly = computed(() => {
  const trimmed = props.query.trim()
  return /^(semantic|lexical|hybrid):$/i.test(trimmed)
})

function parseAutocompleteContext(query: string): AutocompleteContext {
  const trimmed = query
  const lastSpace = trimmed.lastIndexOf(' ')
  const prefix = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : ''
  const token = trimmed.slice(lastSpace + 1)
  const colonIndex = token.indexOf(':')
  const key = colonIndex >= 0 ? token.slice(0, colonIndex).trim().toLowerCase() : ''
  const valuePrefix = colonIndex >= 0 ? token.slice(colonIndex + 1) : token
  const mode: AutocompleteContext['mode'] = colonIndex >= 0 && key !== 'has' ? 'values' : 'keys'
  return { token, prefix, key, valuePrefix, mode }
}

const autocompleteContext = computed(() => parseAutocompleteContext(baseQuery.value))
const autocompletePropertyType = computed(() => propertyTypeForAutocompleteKey(autocompleteContext.value.key))
const autocompleteEnabled = computed(() => {
  if (props.disabled) return false
  if (modePrefixOnly.value) return false
  return props.query.trim().length === 0 || autocompleteContext.value.token.includes(':')
})
const autocompleteQuery = computed(() =>
  autocompleteContext.value.mode === 'values'
    ? autocompleteContext.value.valuePrefix
    : autocompleteContext.value.token.includes(':')
      ? autocompleteContext.value.valuePrefix
      : autocompleteContext.value.token
)

const autocompleteItems = computed<SearchSuggestionItem[]>(() => {
  if (props.disabled) return []

  if (autocompleteContext.value.mode === 'values') {
    const key = autocompleteContext.value.key
    if (!autocompletePropertyType.value) return []
    const values = propertyValuesByKey.value[key] ?? []
    return values.map((value) => ({
      id: `search-property-value:${key}:${value}`,
      label: value,
      kind: 'value',
      fragment: `${key}:${value}`,
      description: `Use ${key} = ${value}`,
      group: `Values for ${key}`
    }))
  }

  if (autocompleteContext.value.key === 'has') {
    return propertyKeys.value.filter(canAutocompletePropertyKey).map((key) => ({
      id: `search-property-has:${key}`,
      label: key,
      kind: 'key',
      fragment: `has:${key}`,
      description: 'Require this property to exist.',
      group: 'Property existence'
    }))
  }

  const items: SearchSuggestionItem[] = []
  for (const quickFilter of quickFilters) {
    items.push({
      id: `search-quick-filter:${quickFilter.fragment}`,
      label: quickFilter.label,
      kind: 'key',
      fragment: quickFilter.fragment,
      description: quickFilter.description,
      group: 'Quick filters'
    })
  }
  for (const key of propertyKeys.value.filter(canAutocompletePropertyKey)) {
    items.push({
      id: `search-property-key:${key}`,
      label: key,
      kind: 'key',
      fragment: `${key}:`,
      description: 'Filter by this property.',
      group: 'Properties'
    })
  }
  return items
})

const autocompleteLoading = computed(() => {
  if (props.disabled) return false
  if (!propertyTypeSchemaLoaded.value || propertyTypeSchemaLoading.value || !propertyKeysLoaded.value || propertyKeysLoading.value) {
    return true
  }
  const key = autocompleteContext.value.key
  return Boolean(key && propertyTypeForAutocompleteKey(key) && propertyValuesLoading.value[key])
})

function propertyTypeForAutocompleteKey(key: string): string | null {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return null
  if (LISTLIKE_DEFAULT_KEYS.has(normalized)) {
    return normalized === 'tags' ? 'tags' : 'list'
  }
  const fromSchema = propertyTypeSchema.value[normalized]
  if (!fromSchema || !LISTLIKE_AUTOCOMPLETE_TYPES.has(fromSchema)) return null
  return fromSchema
}

function canAutocompletePropertyKey(key: string): boolean {
  return Boolean(propertyTypeForAutocompleteKey(key))
}

function buildQueryWithReplacement(fragment: string): string {
  const currentMode = detectSearchMode(props.query)
  const { prefix } = autocompleteContext.value
  return applySearchMode(`${prefix}${fragment}`, currentMode).value
}

function buildQueryWithAppend(fragment: string): string {
  const currentMode = detectSearchMode(props.query)
  const currentBase = currentMode === 'hybrid' ? baseQuery.value : stripSearchModePrefix(props.query)
  const trimmed = currentBase.trimEnd()
  const nextBase = trimmed ? `${trimmed} ${fragment}` : fragment
  return applySearchMode(nextBase, currentMode).value
}

async function loadPropertyKeys() {
  if (props.disabled || propertyKeysLoading.value || propertyKeysLoaded.value) return
  const requestToken = autocompleteRequestToken
  propertyKeysLoading.value = true
  try {
    const keys = (await readPropertyKeys(80)).filter((key) => !RESERVED_SEARCH_PREFIX_KEYS.has(key))
    if (requestToken !== autocompleteRequestToken) return
    propertyKeys.value = keys
    propertyKeysLoaded.value = true
  } finally {
    if (requestToken === autocompleteRequestToken) {
      propertyKeysLoading.value = false
    }
  }
}

async function loadPropertyTypeSchema() {
  if (props.disabled || propertyTypeSchemaLoading.value || propertyTypeSchemaLoaded.value) return
  const requestToken = autocompleteRequestToken
  propertyTypeSchemaLoading.value = true
  try {
    const schema = await readPropertyTypeSchema()
    if (requestToken !== autocompleteRequestToken) return
    propertyTypeSchema.value = schema
    propertyTypeSchemaLoaded.value = true
  } finally {
    if (requestToken === autocompleteRequestToken) {
      propertyTypeSchemaLoading.value = false
    }
  }
}

async function loadPropertyValues(key: string) {
  if (props.disabled || !canAutocompletePropertyKey(key)) return
  if (propertyValuesLoaded.value[key] || propertyValuesLoading.value[key]) return
  const requestToken = autocompleteRequestToken
  propertyValuesLoading.value = { ...propertyValuesLoading.value, [key]: true }
  try {
    const values = await readPropertyValueSuggestions(key, '', 100)
    if (requestToken !== autocompleteRequestToken) return
    propertyValuesByKey.value = {
      ...propertyValuesByKey.value,
      [key]: values
    }
    propertyValuesLoaded.value = { ...propertyValuesLoaded.value, [key]: true }
  } finally {
    if (requestToken === autocompleteRequestToken) {
      propertyValuesLoading.value = { ...propertyValuesLoading.value, [key]: false }
    }
  }
}

async function ensureAutocompleteDataLoaded() {
  if (props.disabled) return
  await loadPropertyTypeSchema()
  await loadPropertyKeys()
  if (autocompleteContext.value.mode === 'values' && autocompletePropertyType.value) {
    await loadPropertyValues(autocompleteContext.value.key)
  }
}

function resetAutocompleteCache() {
  autocompleteRequestToken += 1
  propertyKeys.value = []
  propertyKeysLoading.value = false
  propertyKeysLoaded.value = false
  propertyTypeSchema.value = {}
  propertyTypeSchemaLoading.value = false
  propertyTypeSchemaLoaded.value = false
  propertyValuesByKey.value = {}
  propertyValuesLoading.value = {}
  propertyValuesLoaded.value = {}
  closeAutocomplete()
}

function openAutocomplete() {
  if (!autocompleteEnabled.value) return
  dropdownOpen.value = true
  dropdownActiveIndex.value = 0
  void ensureAutocompleteDataLoaded()
}

function closeAutocomplete() {
  dropdownOpen.value = false
  dropdownActiveIndex.value = 0
}

function onInputFocus() {
  if (autocompleteEnabled.value) {
    openAutocomplete()
  }
}

function onInputBlur() {
  window.setTimeout(() => {
    const activeElement = document.activeElement as HTMLElement | null
    const menuEl = dropdownRef.value?.menuEl ?? null
    if (menuEl && activeElement && menuEl.contains(activeElement)) {
      return
    }
    closeAutocomplete()
  }, 0)
}

function onQueryInput(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
  if (autocompleteEnabled.value) {
    openAutocomplete()
    return
  }
  closeAutocomplete()
}

function onSuggestionSelect(item: SearchSuggestionItem) {
  const nextQuery = buildQueryWithReplacement(item.fragment)
  emit('update:query', nextQuery)
  closeAutocomplete()
  void nextTick(() => {
    inputRef.value?.focus()
  })
}

function applyQuickFilter(fragment: string) {
  emit('update:query', buildQueryWithAppend(fragment))
  closeAutocomplete()
  void nextTick(() => {
    inputRef.value?.focus()
  })
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeAutocomplete()
    return
  }

  if (!dropdownOpen.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    openAutocomplete()
  }

  if (!dropdownOpen.value) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const total = autocompleteItems.value.length
    if (!total) return
    dropdownActiveIndex.value = (dropdownActiveIndex.value + 1) % total
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const total = autocompleteItems.value.length
    if (!total) return
    dropdownActiveIndex.value = (dropdownActiveIndex.value - 1 + total) % total
    return
  }

  if (event.key === 'Tab' && autocompleteItems.value.length) {
    event.preventDefault()
    onSuggestionSelect(autocompleteItems.value[dropdownActiveIndex.value] ?? autocompleteItems.value[0])
  }
}

watch(baseQuery, () => {
  if (props.disabled) {
    closeAutocomplete()
    return
  }
  if (!autocompleteEnabled.value) {
    closeAutocomplete()
    return
  }
  dropdownActiveIndex.value = 0
  void ensureAutocompleteDataLoaded()
})

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      closeAutocomplete()
      return
    }
    void ensureAutocompleteDataLoaded()
  }
)

watch(
  () => props.workingFolderPath,
  () => {
    resetAutocompleteCache()
    if (!props.disabled) {
      void ensureAutocompleteDataLoaded()
    }
  },
  { immediate: true }
)

</script>

<template>
  <div class="panel-fill search-panel">
    <UiFilterableDropdown
      ref="dropdownRef"
      class="search-autocomplete"
      :items="autocompleteItems"
      :model-value="dropdownOpen"
      :query="autocompleteQuery"
      :active-index="dropdownActiveIndex"
      :show-filter="false"
      :disabled="disabled"
      :close-on-outside="true"
      :close-on-select="false"
      :auto-focus-on-open="false"
      :menu-mode="'portal'"
      :max-height="320"
      menu-class="search-autocomplete-menu"
      :matcher="(item, query) => item.label.toLowerCase().startsWith(query)"
      @open-change="dropdownOpen = $event"
      @active-index-change="dropdownActiveIndex = $event"
      @select="onSuggestionSelect($event as SearchSuggestionItem)"
    >
      <template #trigger>
        <div class="search-controls">
          <input
            ref="inputRef"
            :value="query"
            data-search-input="true"
            :disabled="disabled"
            class="tool-input search-input"
            placeholder="Search content (e.g. tags:dev has:deadline deadline>=2026-03-01)"
            @focus="onInputFocus"
            @blur="onInputBlur"
            @input="onQueryInput"
            @keydown.enter.prevent="emit('enter')"
            @keydown="onInputKeydown"
          />
        </div>
      </template>

      <template #item="{ item, active }">
        <span class="search-suggestion" :class="{ 'search-suggestion--active': active }">
          <span class="search-suggestion-main">{{ item.label }}</span>
          <span v-if="item.description" class="search-suggestion-description">{{ item.description }}</span>
        </span>
      </template>

      <template #empty>
        <span v-if="autocompleteLoading">Loading suggestions...</span>
        <span v-else>No property suggestions.</span>
      </template>
    </UiFilterableDropdown>

    <div class="search-quick-filters">
      <p class="search-quick-label">Quick filters</p>
      <button
        v-for="filter in quickFilters"
        :key="filter.fragment"
        type="button"
        class="search-quick-filter"
        :disabled="disabled"
        @click="applyQuickFilter(filter.fragment)"
      >
        {{ filter.label }}
      </button>
    </div>

    <div class="search-mode-controls">
      <button
        v-for="option in modeOptions"
        :key="option.mode"
        type="button"
        class="search-mode-chip"
        :class="{ active: mode === option.mode }"
        :disabled="disabled"
        @click="emit('select-mode', option.mode)"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="search-mode-hint">Hint: <code>semantic:</code> concept | <code>lexical:</code> exact term</p>

    <div class="results-list">
      <div v-if="hasSearched && !searchLoading && !groupedResults.length" class="placeholder">No results</div>
      <section v-for="group in groupedResults" :key="group.path" class="result-group">
        <h3 class="result-file">{{ toRelativePath(group.path) }}</h3>
        <button
          v-for="item in group.items"
          :key="`${group.path}-${item.score}-${item.snippet}`"
          type="button"
          class="result-item"
          @click="emit('open-result', item)"
        >
          <p v-if="showSearchScore" class="result-score">score: {{ formatSearchScore(item.score) }}</p>
          <div class="result-snippet">
            <template v-for="(part, idx) in snippetParts(item.snippet)" :key="`${idx}-${part.text}`">
              <strong v-if="part.highlighted">{{ part.text }}</strong>
              <span v-else>{{ part.text }}</span>
            </template>
          </div>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-controls {
  display: flex;
  gap: 6px;
}

.search-input {
  flex: 1;
}

.search-quick-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.search-quick-label {
  margin: 0 4px 0 0;
  font-size: var(--font-size-xs);
  color: var(--text-dim);
}

.search-quick-filter {
  border: 1px solid var(--search-chip-border);
  border-radius: 999px;
  background: var(--search-chip-bg);
  color: var(--search-chip-text);
  padding: 2px 9px;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.search-mode-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.search-mode-chip {
  border: 1px solid var(--search-chip-border);
  border-radius: 999px;
  background: var(--search-chip-bg);
  color: var(--search-chip-text);
  padding: 2px 9px;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.search-mode-chip.active {
  border-color: var(--search-chip-active-border);
  color: var(--search-chip-active-text);
  background: var(--search-chip-active-bg);
}

.search-mode-chip:disabled,
.search-quick-filter:disabled {
  opacity: 0.5;
}

.search-mode-hint {
  margin: -2px 0 0;
  font-size: var(--font-size-xs);
  color: var(--text-dim);
}

.search-mode-hint code {
  font-family: var(--font-code);
  font-size: inherit;
}

.search-autocomplete :deep(.ui-filterable-dropdown-menu) {
  width: min(32rem, calc(100vw - 96px));
}

.search-autocomplete :deep(.ui-filterable-dropdown-option) {
  align-items: flex-start;
}

.search-suggestion {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}

.search-suggestion-main {
  font-size: var(--font-size-md);
}

.search-suggestion-description {
  font-size: var(--font-size-xs);
  color: var(--text-dim);
}

.search-suggestion--active .search-suggestion-description {
  color: color-mix(in srgb, currentColor 72%, white 28%);
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
  font-size: var(--font-size-sm);
  color: var(--search-result-title);
}

.result-item {
  width: 100%;
  text-align: left;
  border: 1px solid var(--search-result-border);
  background: var(--search-result-bg);
  border-radius: 4px;
  padding: 6px;
  margin-bottom: 6px;
  font-size: var(--font-size-md);
  color: var(--text-main);
}

.result-score {
  margin: 0 0 4px;
  font-size: var(--font-size-xs);
  color: var(--search-result-score);
  font-family: var(--font-code);
}

.result-snippet :deep(strong) {
  font-weight: 700;
}
</style>
