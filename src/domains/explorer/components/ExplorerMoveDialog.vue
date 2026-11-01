<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import { filterMoveDestinations, listMoveDestinations, type MoveDestination } from '../lib/moveDestinationPicker'

const props = defineProps<{
  root: string
  folders: string[]
  sources: string[]
  recentDestinations?: string[]
  parentOf: (path: string) => string
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [destinationPath: string]
}>()

const query = ref('')
const activePath = ref('')

const destinations = computed<MoveDestination[]>(() =>
  listMoveDestinations({
    root: props.root,
    folders: props.folders,
    sources: props.sources,
    recentDestinations: props.recentDestinations,
    parentOf: props.parentOf
  })
)

const visibleDestinations = computed(() => filterMoveDestinations(destinations.value, query.value))
const selectedDestination = computed(() => destinations.value.find((destination) => destination.path === activePath.value && !destination.disabled) ?? null)

function confirm() {
  if (selectedDestination.value) {
    emit('confirm', selectedDestination.value.path)
  }
}

onMounted(() => {
  const firstEnabled = destinations.value.find((destination) => !destination.disabled)
  activePath.value = firstEnabled?.path ?? ''
})

// Keep the active row on a valid visible destination when the query changes.
watch(visibleDestinations, (visible) => {
  const current = visible.find((destination) => destination.path === activePath.value && !destination.disabled)
  if (!current) {
    activePath.value = visible.find((destination) => !destination.disabled)?.path ?? ''
  }
})
</script>

<template>
  <div class="explorer-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
    <div class="explorer-modal w-full max-w-sm rounded-2xl border p-4">
      <h3 class="explorer-modal-title text-sm font-semibold">Move {{ sources.length === 1 ? '“' + sources[0].split('/').pop() + '”' : sources.length + ' items' }} to…</h3>
      <UiInput v-model="query" class="mt-3" size="sm" placeholder="Search destinations…" aria-label="Search destinations" />
      <ul class="explorer-move-list mt-2 max-h-56 overflow-y-auto rounded-lg border" role="listbox" aria-label="Destinations">
        <li v-for="destination in visibleDestinations" :key="destination.path">
          <button
            type="button"
            class="explorer-move-option flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
            :class="{ 'explorer-move-option--active': destination.path === activePath }"
            :disabled="destination.disabled"
            role="option"
            :aria-selected="destination.path === activePath"
            :aria-disabled="destination.disabled"
            @click="activePath = destination.path"
            @dblclick="confirm"
          >
            <span class="truncate">{{ destination.label }}</span>
            <span v-if="destination.disabled && destination.reason" class="explorer-move-reason shrink-0 text-[10px]">{{ destination.reason }}</span>
          </button>
        </li>
        <li v-if="!visibleDestinations.length" class="px-2 py-2 text-xs explorer-move-reason">No matching folder.</li>
      </ul>
      <div class="mt-4 flex justify-end gap-2">
        <UiButton size="sm" variant="ghost" @click="emit('cancel')">Cancel</UiButton>
        <UiButton size="sm" variant="primary" :disabled="!selectedDestination" @click="confirm">Move</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.explorer-modal-backdrop {
  background: var(--menu-backdrop);
}

.explorer-modal {
  border-color: var(--panel-border);
  background: var(--surface-bg);
  box-shadow: var(--menu-shadow);
}

.explorer-modal-title {
  color: var(--text-main);
}

.explorer-move-list {
  border-color: var(--panel-border);
}

.explorer-move-option {
  color: var(--text-main);
}

.explorer-move-option:hover:not(:disabled),
.explorer-move-option--active {
  background: var(--menu-item-hover-bg);
}

.explorer-move-option:disabled {
  opacity: 0.55;
}

.explorer-move-reason {
  color: var(--text-dim);
}
</style>
