<script setup lang="ts">
import { computed, ref } from 'vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../shared/components/ui/UiFilterableDropdown.vue'

type PropertyOption = {
  key: string
  label?: string
  description?: string
}

const props = withDefaults(defineProps<{
  options: PropertyOption[]
  existingKeys: string[]
}>(), {
  options: () => [],
  existingKeys: () => []
})

const emit = defineEmits<{
  (event: 'select', key: string): void
}>()

const open = ref(false)
const query = ref('')
const activeIndex = ref(0)
const customKey = ref('')

const existingSet = computed(() => new Set(props.existingKeys.map((key) => key.trim().toLowerCase())))
const availableOptions = computed<Array<FilterableDropdownItem & { key: string; description: string }>>(() =>
  props.options
    .filter((option) => !existingSet.value.has(option.key.trim().toLowerCase()))
    .map((option) => ({
      id: `property:${option.key}`,
      label: option.label || option.key,
      key: option.key,
      description: option.description ?? ''
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
)

function close() {
  open.value = false
  query.value = ''
  activeIndex.value = 0
}

function selectOption(key: string) {
  emit('select', key)
  customKey.value = ''
  close()
}

function submitCustomKey() {
  const next = customKey.value.trim()
  if (!next) return
  if (existingSet.value.has(next.toLowerCase())) return
  selectOption(next)
}
</script>

<template>
  <div class="property-add-dropdown">
    <UiFilterableDropdown
      :items="availableOptions"
      :model-value="open"
      :query="query"
      :active-index="activeIndex"
      menu-mode="portal"
      menu-class="property-add-dropdown-menu"
      filter-placeholder="Search properties..."
      :show-filter="true"
      :max-height="220"
      @open-change="open = $event"
      @query-change="query = $event"
      @active-index-change="activeIndex = $event"
      @select="selectOption(String($event.key ?? ''))"
    >
      <template #trigger="{ toggleMenu }">
        <button
          type="button"
          class="property-add-trigger"
          @click="toggleMenu"
        >
          Add property
        </button>
      </template>
      <template #item="{ item }">
        <div class="dropdown-item">
          <span>{{ item.label }}</span>
          <small v-if="item.description">{{ item.description }}</small>
        </div>
      </template>
      <template #footer>
        <div class="dropdown-custom-row">
          <input
            v-model="customKey"
            type="text"
            placeholder="custom key"
            class="dropdown-custom-input"
            @keydown.enter.prevent="submitCustomKey"
          />
          <button
            type="button"
            class="dropdown-custom-btn"
            @click="submitCustomKey"
          >
            Add
          </button>
        </div>
      </template>
    </UiFilterableDropdown>
  </div>
</template>

<style>
.property-add-dropdown {
  display: inline-flex;
}

.property-add-dropdown :deep(.ui-filterable-dropdown) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.property-add-dropdown-menu {
  width: 16rem;
  border: 1px solid var(--menu-border);
  border-radius: var(--radius-md);
  background: var(--menu-bg);
  padding: 0.375rem;
  box-shadow: var(--menu-shadow);
}

.property-add-dropdown .property-add-trigger {
  border: 1px solid var(--button-secondary-border);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.5rem;
  font-size: var(--font-size-sm);
  background: var(--button-secondary-bg);
  color: var(--button-secondary-text);
}

.property-add-dropdown-menu .dropdown-item {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 0.375rem 0.5rem;
  background: transparent;
  text-align: left;
  color: var(--menu-text-strong);
}

.property-add-dropdown-menu .dropdown-item small {
  font-size: var(--font-size-xs);
  color: var(--text-dim);
}

.property-add-dropdown-menu .dropdown-custom-row {
  display: flex;
  gap: 0.375rem;
}

.property-add-dropdown-menu .dropdown-custom-input {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.5rem;
  font-size: var(--font-size-sm);
  line-height: 1rem;
  background: var(--input-bg);
  color: var(--input-text);
}

.property-add-dropdown-menu .dropdown-custom-btn {
  border: 1px solid var(--button-secondary-border);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.5rem;
  font-size: var(--font-size-sm);
  line-height: 1rem;
  background: var(--button-secondary-bg);
  color: var(--button-secondary-text);
  cursor: pointer;
}
</style>
