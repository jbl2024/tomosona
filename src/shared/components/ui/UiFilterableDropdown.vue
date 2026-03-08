<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import {
  useFilterableListbox,
  type FilterableItemBase
} from '../../composables/useFilterableListbox'

/**
 * Shared filterable dropdown shell used across editor and panel menus.
 *
 * How to use:
 * - Keep your domain model in parent code.
 * - Map domain entries to `{ id, label, ...extra }`.
 * - Use slots to customize trigger and rows while reusing keyboard/open/close behavior.
 */
/**
 * Generic dropdown row payload carried through the shared filterable dropdown.
 *
 * Why:
 * - Consumers often need extra fields such as icons, targets, aliases, or groups.
 * - The component only requires `id` and `label`, but safely preserves
 *   additional item metadata for `select` events and render slots.
 */
export type FilterableDropdownItem = FilterableItemBase & Record<string, unknown>

type GroupedDropdownSection = {
  group: string
  items: Array<{ item: FilterableDropdownItem; index: number }>
}

const props = withDefaults(defineProps<{
  items: FilterableDropdownItem[]
  modelValue: boolean
  query: string
  activeIndex: number
  filterPlaceholder?: string
  showFilter?: boolean
  disabled?: boolean
  maxHeight?: number | string
  closeOnOutside?: boolean
  closeOnSelect?: boolean
  autoFocusOnOpen?: boolean
  menuMode?: 'overlay' | 'inline' | 'portal'
  menuClass?: string
  matcher?: (item: FilterableDropdownItem, query: string) => boolean
}>(), {
  filterPlaceholder: 'Filter...',
  showFilter: true,
  disabled: false,
  maxHeight: 260,
  closeOnOutside: true,
  closeOnSelect: true,
  autoFocusOnOpen: true,
  menuMode: 'overlay'
})

const emit = defineEmits<{
  'open-change': [value: boolean]
  'query-change': [value: string]
  'active-index-change': [value: number]
  select: [item: FilterableDropdownItem]
}>()

const rootRef = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const portalMenuStyle = ref<CSSProperties>({})

const listboxId = `tomosona-filterable-listbox-${Math.random().toString(36).slice(2)}`
const itemsRef = computed(() => props.items)
const maxHeightPx = computed(() =>
  typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight
)
const computedMenuStyle = computed<CSSProperties>(() =>
  props.menuMode === 'portal' ? portalMenuStyle.value : {}
)
const groupedFilteredItems = computed<GroupedDropdownSection[]>(() => {
  const sections: GroupedDropdownSection[] = []
  const byGroup = new Map<string, GroupedDropdownSection>()

  api.filteredItems.value.forEach((item, index) => {
    const rawGroup = typeof item.group === 'string' ? item.group.trim() : ''
    const group = rawGroup || ''
    const existing = byGroup.get(group)
    if (existing) {
      existing.items.push({ item, index })
      return
    }
    const section: GroupedDropdownSection = {
      group,
      items: [{ item, index }]
    }
    byGroup.set(group, section)
    sections.push(section)
  })

  return sections
})

const api = useFilterableListbox({
  items: itemsRef,
  match: props.matcher,
  onSelect: (item) => {
    emit('select', item)
    if (props.closeOnSelect) {
      api.closeMenu()
    }
  }
})

/**
 * Initializes headless state from controlled props.
 *
 * Why:
 * - This component is intentionally controlled by parent state so existing
 *   menu contracts can stay stable during migration.
 */
function syncFromProps() {
  api.open.value = Boolean(props.modelValue)
  api.query.value = String(props.query ?? '')
  api.setActiveIndex(Number(props.activeIndex ?? 0))
}

syncFromProps()

watch(() => props.modelValue, (value) => {
  api.open.value = Boolean(value)
})

watch(() => props.query, (value) => {
  api.query.value = String(value ?? '')
})

watch(() => props.activeIndex, (value) => {
  api.setActiveIndex(Number(value ?? 0))
})

watch(() => api.open.value, (value) => {
  if (value !== props.modelValue) emit('open-change', value)
  if (!value) return
  if (props.menuMode === 'portal') {
    void nextTick(() => updatePortalPosition())
  }
  if (!props.autoFocusOnOpen) return
  void nextTick(() => {
    if (props.showFilter) {
      inputRef.value?.focus()
      inputRef.value?.select()
      return
    }
    menuEl.value?.focus()
  })
})

watch(() => api.query.value, (value) => {
  if (value !== props.query) emit('query-change', value)
})

watch(() => api.activeIndex.value, (value) => {
  if (value !== props.activeIndex) emit('active-index-change', value)
})

watch(
  [() => api.open.value, () => api.activeIndex.value, () => api.filteredItems.value.length],
  ([open]) => {
    if (!open) return
    void nextTick(() => {
      const active = listRef.value?.querySelector<HTMLElement>('[data-active="true"]')
      if (typeof active?.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' })
      }
    })
  }
)

/**
 * Closes menu when pointer interaction happens outside this dropdown root.
 *
 * Integration note:
 * - Kept configurable because some teleported/anchored menus delegate outside
 *   click handling to parent surfaces.
 */
function closeFromOutside(event: MouseEvent) {
  if (!props.closeOnOutside) return
  if (!api.open.value) return
  const root = rootRef.value
  if (!root) return
  const target = event.target as Node | null
  if (target && root.contains(target)) return
  if (target && menuEl.value?.contains(target)) return
  api.closeMenu()
}

function openMenu() {
  if (props.disabled) return
  api.openMenu()
}

function closeMenu() {
  api.closeMenu()
}

function toggleMenu() {
  if (props.disabled) return
  if (api.open.value) {
    api.closeMenu()
    return
  }
  api.openMenu()
}

function onFilterKeydown(event: KeyboardEvent) {
  api.handleKeydown(event)
}

/**
 * Handles keyboard events when no text filter input is rendered.
 *
 * Why:
 * - Keeps keyboard support available for command-style menus that rely on
 *   external query context (slash/wikilink).
 */
function onMenuKeydown(event: KeyboardEvent) {
  if (props.showFilter) return
  api.handleKeydown(event)
}

function onOptionMouseEnter(index: number) {
  api.setActiveIndex(index)
}

function onOptionClick(index: number) {
  api.selectIndex(index)
}

function updatePortalPosition() {
  if (props.menuMode !== 'portal') return
  const root = rootRef.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const gutter = 12
  const verticalGap = 6
  const menuWidth = Math.min(Math.max(rect.width, menuEl.value?.offsetWidth ?? 240, 240), viewportWidth - gutter * 2)
  const menuHeight = menuEl.value?.offsetHeight ?? 320
  const availableBelow = viewportHeight - rect.bottom - gutter
  const availableAbove = rect.top - gutter
  const openAbove = availableBelow < menuHeight && availableAbove > availableBelow
  const left = Math.min(Math.max(gutter, rect.left), viewportWidth - menuWidth - gutter)
  const top = openAbove
    ? Math.max(gutter, rect.top - menuHeight - verticalGap)
    : Math.min(viewportHeight - menuHeight - gutter, rect.bottom + verticalGap)
  portalMenuStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${menuWidth}px`,
    minWidth: `${menuWidth}px`,
    maxWidth: `${menuWidth}px`
  }
}

function onViewportChange() {
  if (!api.open.value) return
  updatePortalPosition()
}

onMounted(() => {
  document.addEventListener('mousedown', closeFromOutside)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  if (api.open.value) {
    void nextTick(() => updatePortalPosition())
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeFromOutside)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})

defineExpose({
  // Used by menu wrappers that need direct access for positioning/hit testing.
  menuEl
})
</script>

<template>
  <div ref="rootRef" class="ui-filterable-dropdown">
    <slot
      name="trigger"
      :open="api.open.value"
      :open-menu="openMenu"
      :close-menu="closeMenu"
      :toggle-menu="toggleMenu"
      :active-item="api.activeItem.value"
      :query="api.query.value"
      :filtered-items="api.filteredItems.value"
    />

    <Teleport to="body" :disabled="props.menuMode !== 'portal'">
      <div
        v-if="api.open.value"
        ref="menuEl"
        class="ui-filterable-dropdown-menu"
        :class="[
          props.menuClass,
          {
          'ui-filterable-dropdown-menu--overlay': props.menuMode === 'overlay',
          'ui-filterable-dropdown-menu--inline': props.menuMode === 'inline',
          'ui-filterable-dropdown-menu--portal': props.menuMode === 'portal'
          }
        ]"
        :style="computedMenuStyle"
        tabindex="-1"
        @keydown="onMenuKeydown"
      >
        <div v-if="props.showFilter" class="ui-filterable-dropdown-filter">
          <input
            ref="inputRef"
            :value="api.query.value"
            type="text"
            class="ui-filterable-dropdown-filter-input"
            :placeholder="props.filterPlaceholder"
            role="combobox"
            :aria-expanded="api.open.value ? 'true' : 'false'"
            :aria-controls="listboxId"
            :aria-activedescendant="api.activeItemId.value ?? undefined"
            @input="api.query.value = ($event.target as HTMLInputElement | null)?.value ?? ''"
            @keydown="onFilterKeydown"
          />
        </div>

        <div
          :id="listboxId"
          ref="listRef"
          class="ui-filterable-dropdown-list"
          role="listbox"
          :style="{ maxHeight: maxHeightPx }"
        >
          <template v-if="api.filteredItems.value.length">
            <template v-for="section in groupedFilteredItems" :key="section.group || '__ungrouped__'">
              <div v-if="section.group" class="ui-filterable-dropdown-group">
                {{ section.group }}
              </div>
              <button
                v-for="entry in section.items"
                :id="entry.item.id"
                :key="entry.item.id"
                type="button"
                class="ui-filterable-dropdown-option"
                role="option"
                :aria-selected="api.activeIndex.value === entry.index ? 'true' : 'false'"
                :data-active="api.activeIndex.value === entry.index ? 'true' : 'false'"
                @mouseenter="onOptionMouseEnter(entry.index)"
                @mousedown.prevent
                @click.stop.prevent="onOptionClick(entry.index)"
              >
                <slot
                  name="item"
                  :item="entry.item"
                  :index="entry.index"
                  :active="api.activeIndex.value === entry.index"
                  :select="() => onOptionClick(entry.index)"
                >
                  <span>{{ entry.item.label }}</span>
                </slot>
              </button>
            </template>
          </template>
          <div v-else class="ui-filterable-dropdown-empty">
            <slot name="empty" :query="api.query.value">
              No matches
            </slot>
          </div>
        </div>

        <div v-if="$slots.footer" class="ui-filterable-dropdown-footer">
          <slot name="footer" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ui-filterable-dropdown {
  position: relative;
  --ui-dropdown-bg: var(--surface-bg);
  --ui-dropdown-border: var(--border-control);
  --ui-dropdown-text: var(--text-main);
  --ui-dropdown-muted: var(--text-dim);
  --ui-dropdown-hover: var(--accent-soft);
}

.ui-filterable-dropdown-menu {
  --ui-dropdown-bg: var(--surface-bg);
  --ui-dropdown-border: var(--border-control);
  --ui-dropdown-text: var(--text-main);
  --ui-dropdown-muted: var(--text-dim);
  --ui-dropdown-hover: var(--accent-soft);
  z-index: 60;
  min-width: 240px;
  max-width: min(420px, calc(100vw - 24px));
  background: var(--ui-dropdown-bg, var(--surface-bg));
  border: 1px solid var(--ui-dropdown-border, var(--border-control));
  border-radius: 10px;
  box-shadow: var(--shadow-dropdown);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ui-filterable-dropdown-menu--overlay {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
}

.ui-filterable-dropdown-menu--inline {
  position: static;
  margin-top: 6px;
}

.ui-filterable-dropdown-menu--portal {
  z-index: 80;
}

.ui-filterable-dropdown-filter {
  border-bottom: 1px solid var(--ui-dropdown-border);
  padding: 8px;
}

.ui-filterable-dropdown-filter-input {
  width: 100%;
  background: var(--ui-dropdown-bg, var(--surface-bg));
  border: 1px solid var(--ui-dropdown-border, var(--border-control));
  border-radius: 8px;
  color: var(--ui-dropdown-text, var(--text-main));
  font-size: 12px;
  line-height: 1.2;
  padding: 7px 10px;
}

.ui-filterable-dropdown-filter-input:focus {
  outline: none;
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 2px var(--input-focus-ring);
}

.ui-filterable-dropdown-list {
  overflow-y: auto;
}

.ui-filterable-dropdown-option {
  background: transparent;
  border: none;
  color: var(--ui-dropdown-text, var(--text-main));
  cursor: pointer;
  display: block;
  font-size: 12px;
  line-height: 1.25;
  padding: 8px 12px;
  text-align: left;
  white-space: nowrap;
  width: 100%;
}

.ui-filterable-dropdown-option:hover,
.ui-filterable-dropdown-option[data-active='true'] {
  background: var(--ui-dropdown-hover, var(--accent-soft));
}

.ui-filterable-dropdown-group {
  color: var(--ui-dropdown-muted, var(--text-dim));
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 8px 12px 4px;
  text-transform: uppercase;
}

.ui-filterable-dropdown-empty {
  color: var(--ui-dropdown-muted, var(--text-dim));
  font-size: 12px;
  padding: 10px 12px;
}

.ui-filterable-dropdown-footer {
  border-top: 1px solid var(--ui-dropdown-border, var(--border-control));
  padding: 8px;
}
</style>
