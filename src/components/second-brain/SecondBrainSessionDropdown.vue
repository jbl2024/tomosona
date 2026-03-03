<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../ui/UiFilterableDropdown.vue'
import type { SecondBrainSessionSummary } from '../../lib/api'

type SessionDropdownItem = FilterableDropdownItem & {
  sessionId: string
  title: string
  updatedAtMs: number
}

const props = defineProps<{
  sessions: SecondBrainSessionSummary[]
  activeSessionId: string
  loading: boolean
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  delete: [sessionId: string]
}>()

const open = ref(false)
const query = ref('')
const activeIndex = ref(0)

const items = computed<SessionDropdownItem[]>(() =>
  [...props.sessions]
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms)
    .map((session) => ({
      id: session.session_id,
      label: `${session.title || 'Session'} ${session.session_id}`,
      sessionId: session.session_id,
      title: session.title || 'Session',
      updatedAtMs: session.updated_at_ms
    }))
)

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleString()
}

function onSelect(item: SessionDropdownItem) {
  emit('select', item.sessionId)
}

function onDelete(sessionId: string) {
  emit('delete', sessionId)
}

function asSessionItem(item: unknown): SessionDropdownItem | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Partial<SessionDropdownItem>
  if (typeof row.sessionId !== 'string') return null
  if (typeof row.title !== 'string') return null
  if (typeof row.updatedAtMs !== 'number') return null
  return row as SessionDropdownItem
}

function itemSessionId(item: unknown): string {
  return asSessionItem(item)?.sessionId ?? ''
}

function itemTitle(item: unknown): string {
  return asSessionItem(item)?.title ?? 'Session'
}

function itemUpdatedAtLabel(item: unknown): string {
  const value = asSessionItem(item)?.updatedAtMs
  if (typeof value !== 'number') return ''
  return dateLabel(value)
}

</script>

<template>
  <div class="sb-session-dropdown">
    <UiFilterableDropdown
      :items="items"
      :model-value="open"
      :query="query"
      :active-index="activeIndex"
      filter-placeholder="Search sessions..."
      :show-filter="true"
      :max-height="280"
      @open-change="open = $event"
      @query-change="query = $event"
      @active-index-change="activeIndex = $event"
      @select="onSelect($event as SessionDropdownItem)"
    >
      <template #trigger="{ toggleMenu }">
        <button
          type="button"
          class="sb-session-gear-btn"
          title="Manage sessions"
          aria-label="Manage sessions"
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
            <span>{{ itemUpdatedAtLabel(item) }}</span>
          </div>
          <span
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
        <span>{{ loading ? 'Loading sessions...' : 'No session found' }}</span>
      </template>
    </UiFilterableDropdown>
  </div>
</template>

<style>
.sb-session-dropdown {
  position: relative;
}

:deep(.ui-filterable-dropdown-menu) {
  right: 0;
  left: auto;
  width: min(520px, calc(100vw - 36px));
  max-width: min(520px, calc(100vw - 36px));
}

.sb-session-gear-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  color: #0f172a;
}

.sb-session-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sb-session-option[data-active='true'] strong {
  color: #1d4ed8;
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
  color: #64748b;
}

.sb-session-option .delete {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #b91c1c;
  background: #fff1f2;
  border: 1px solid #fecaca;
}

.ide-root.dark .sb-session-gear-btn {
  border-color: #334155;
  background: #0f172a;
  color: #e2e8f0;
}

.ide-root.dark .sb-session-option .meta span {
  color: #94a3b8;
}

.ide-root.dark .sb-session-option[data-active='true'] strong {
  color: #93c5fd;
}

.ide-root.dark .sb-session-option .delete {
  color: #fca5a5;
  background: #3f1d24;
  border-color: #7f1d1d;
}
</style>
