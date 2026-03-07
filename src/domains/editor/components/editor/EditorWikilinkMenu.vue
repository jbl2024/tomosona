<script setup lang="ts">
import { computed, onMounted, onUpdated, ref } from 'vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../shared/components/ui/UiFilterableDropdown.vue'

type WikilinkItem = {
  id: string
  label: string
  target: string
  isCreate: boolean
}

const props = defineProps<{
  open: boolean
  index: number
  left: number
  top: number
  results: WikilinkItem[]
}>()

const emit = defineEmits<{
  'update:index': [value: number]
  select: [target: string]
  'menu-el': [value: HTMLDivElement | null]
}>()

const dropdownRef = ref<{ menuEl: HTMLElement | null } | null>(null)
const items = computed<Array<FilterableDropdownItem & { target: string; isCreate: boolean }>>(() =>
  props.results.map((item) => ({
    id: item.id,
    label: item.label,
    target: item.target,
    isCreate: item.isCreate
  }))
)

function syncRootEl() {
  emit('menu-el', (dropdownRef.value?.menuEl as HTMLDivElement | null) ?? null)
}

function onSelect(item: FilterableDropdownItem) {
  const target = String(item.target ?? '')
  if (!target) return
  emit('select', target)
}

onMounted(syncRootEl)
onUpdated(syncRootEl)
</script>

<template>
  <div class="editor-wikilink-dropdown-anchor" :style="{ left: `${props.left}px`, top: `${props.top}px` }">
    <UiFilterableDropdown
      ref="dropdownRef"
      class="editor-wikilink-dropdown"
      :items="items"
      :model-value="props.open"
      query=""
      :active-index="props.index"
      :show-filter="false"
      :auto-focus-on-open="false"
      :close-on-outside="false"
      :close-on-select="false"
      :max-height="320"
      @open-change="() => {}"
      @query-change="() => {}"
      @active-index-change="emit('update:index', $event)"
      @select="onSelect($event)"
    >
      <template #item="{ item, active }">
        <span
          class="block min-w-0 truncate"
          :class="active ? 'editor-wikilink-active' : ''"
          :title="item.label"
        >
          {{ item.label }}
        </span>
      </template>
      <template #empty>
        No matches
      </template>
    </UiFilterableDropdown>
  </div>
</template>

<style scoped>
.editor-wikilink-dropdown-anchor {
  position: absolute;
}

.editor-wikilink-dropdown :deep(.ui-filterable-dropdown-menu) {
  left: 0;
  max-width: calc(100vw - 1rem);
  min-width: 18rem;
  position: absolute;
  top: 0;
  width: 20rem;
  z-index: 20;
}

.editor-wikilink-dropdown :deep(.ui-filterable-dropdown-option) {
  border-radius: 0.25rem;
  color: rgb(51 65 85);
  font-size: 0.875rem;
  padding: 0.375rem 0.75rem;
}

.editor-wikilink-dropdown :deep(.ui-filterable-dropdown-option[data-active='true']) {
  box-shadow: inset 0 0 0 1px rgb(203 213 225);
}

.editor-wikilink-active {
  font-weight: 600;
}
</style>
