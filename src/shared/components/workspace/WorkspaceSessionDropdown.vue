<script setup lang="ts">
/**
 * Shared session switcher used by Second Brain-style workspace surfaces.
 *
 * The parent owns session loading and selection. This component only provides
 * a compact filterable dropdown with an optional delete action.
 */
import { computed, ref } from 'vue'
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../ui/UiFilterableDropdown.vue'

export type WorkspaceSessionDropdownItem = FilterableDropdownItem & {
  sessionId: string
  title: string
  updatedAtMs: number
  details: string
}

const props = withDefaults(defineProps<{
  sessions: WorkspaceSessionDropdownItem[]
  activeSessionId: string
  loading: boolean
  buttonTitle?: string
  buttonAriaLabel?: string
  filterPlaceholder?: string
  emptyLabel?: string
  showDelete?: boolean
}>(), {
  buttonTitle: 'Manage sessions',
  buttonAriaLabel: 'Manage sessions',
  filterPlaceholder: 'Search sessions...',
  emptyLabel: 'No session found',
  showDelete: false
})

const emit = defineEmits<{
  select: [sessionId: string]
  delete: [sessionId: string]
}>()

const open = ref(false)
const query = ref('')
const activeIndex = ref(0)

const items = computed<WorkspaceSessionDropdownItem[]>(() =>
  [...props.sessions].sort((left, right) => right.updatedAtMs - left.updatedAtMs)
)

function onSelect(item: WorkspaceSessionDropdownItem) {
  emit('select', item.sessionId)
}

function onDelete(sessionId: string) {
  emit('delete', sessionId)
}

function asSessionItem(item: unknown): WorkspaceSessionDropdownItem | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Partial<WorkspaceSessionDropdownItem>
  if (typeof row.sessionId !== 'string') return null
  if (typeof row.title !== 'string') return null
  if (typeof row.updatedAtMs !== 'number') return null
  return row as WorkspaceSessionDropdownItem
}

function itemSessionId(item: unknown): string {
  return asSessionItem(item)?.sessionId ?? ''
}

function itemTitle(item: unknown): string {
  return asSessionItem(item)?.title ?? 'Session'
}

function itemDetails(item: unknown): string {
  return asSessionItem(item)?.details ?? ''
}

function itemUpdatedAtLabel(item: unknown): string {
  const value = asSessionItem(item)?.updatedAtMs
  if (typeof value !== 'number') return ''
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div class="sb-session-dropdown">
    <UiFilterableDropdown
      :items="items"
      :model-value="open"
      :query="query"
      :active-index="activeIndex"
      :filter-placeholder="filterPlaceholder"
      :show-filter="true"
      :max-height="280"
      @open-change="open = $event"
      @query-change="query = $event"
      @active-index-change="activeIndex = $event"
      @select="onSelect($event as WorkspaceSessionDropdownItem)"
    >
      <template #trigger="{ toggleMenu }">
        <button
          type="button"
          class="sb-session-gear-btn"
          :title="buttonTitle"
          :aria-label="buttonAriaLabel"
          :disabled="loading"
          @click="toggleMenu"
        >
          <Cog6ToothIcon class="h-4 w-4" />
        </button>
      </template>

      <template #item="{ item }">
        <div class="sb-session-option" :data-active="itemSessionId(item) === activeSessionId ? 'true' : 'false'">
          <div class="meta">
            <strong>{{ itemTitle(item) }}</strong>
            <span>{{ itemDetails(item) || itemUpdatedAtLabel(item) }}</span>
          </div>
          <span
            v-if="showDelete"
            class="delete"
            role="button"
            tabindex="0"
            title="Delete session"
            @mousedown.stop
            @click.stop.prevent="onDelete(itemSessionId(item))"
            @keydown.enter.prevent.stop="onDelete(itemSessionId(item))"
          >×</span>
        </div>
      </template>

      <template #empty>
        <span>{{ loading ? 'Loading sessions...' : emptyLabel }}</span>
      </template>
    </UiFilterableDropdown>
  </div>
</template>

<style scoped>
.sb-session-dropdown {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.sb-session-dropdown :deep(.ui-filterable-dropdown) {
  position: relative;
}

.sb-session-dropdown :deep(.ui-filterable-dropdown-menu) {
  position: absolute !important;
  top: calc(100% + 6px);
  right: 0;
  left: auto;
  width: min(520px, calc(100vw - 36px));
  max-width: min(520px, calc(100vw - 36px));
  z-index: 70;
}

.sb-session-gear-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--sb-button-border);
  border-radius: 10px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
}

.sb-session-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sb-session-option[data-active='true'] strong {
  color: var(--sb-active-text);
}

.sb-session-option .meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb-session-option .meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-session-option .meta span {
  font-size: 11px;
  color: var(--sb-text-dim);
}

.sb-session-option .delete {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--sb-danger-text);
  background: var(--sb-danger-bg);
  border: 1px solid var(--sb-danger-border);
}
</style>
