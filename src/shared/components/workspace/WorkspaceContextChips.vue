<script setup lang="ts">
/**
 * Shared horizontal chip row for workspace context notes.
 *
 * This component owns the repeated "main chip + Open + Remove" affordance
 * used by Second Brain and Alter Exploration. The parent keeps the data and
 * selection state; this component only renders the row and emits actions.
 */
export type WorkspaceContextChipItem = {
  path: string
  name: string
  parent: string
}

const props = withDefaults(defineProps<{
  chips: WorkspaceContextChipItem[]
  activePath: string
  activeLabel?: string
}>(), {
  activeLabel: 'Use this note for Echoes suggestions'
})

const emit = defineEmits<{
  toggle: [path: string]
  open: [path: string]
  remove: [path: string]
}>()
</script>

<template>
  <div v-if="chips.length" class="workspace-context-chips sb-chip-row">
    <article v-for="chip in chips" :key="chip.path" class="workspace-context-chip sb-chip">
      <button
        type="button"
        class="workspace-context-chip__main sb-chip-main"
        :class="{ active: activePath === chip.path }"
        :title="activeLabel"
        :aria-pressed="activePath === chip.path"
        @click="emit('toggle', chip.path)"
      >
        <strong>{{ chip.name }}</strong>
        <span>{{ chip.parent }}</span>
      </button>
      <button
        type="button"
        class="workspace-context-chip__open sb-chip-open"
        :title="`Open ${chip.name}`"
        :aria-label="`Open ${chip.name}`"
        @click="emit('open', chip.path)"
      >
        Open
      </button>
      <button type="button" class="workspace-context-chip__remove sb-chip-remove" @click="emit('remove', chip.path)">×</button>
    </article>
  </div>
</template>

<style scoped>
.workspace-context-chips {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
  gap: 5px;
  padding-bottom: 2px;
}

.workspace-context-chip {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  border-radius: 8px;
  padding: 3px 5px;
}

.workspace-context-chip__main {
  border: 0;
  background: transparent;
  min-width: 0;
  display: flex;
  flex-direction: column;
  text-align: left;
  padding: 0;
}

.workspace-context-chip__main.active strong,
.workspace-context-chip__main.active span {
  color: var(--sb-active-text, currentColor);
}

.workspace-context-chip__main strong,
.workspace-context-chip__main span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-context-chip__main strong {
  font-size: 11px;
}

.workspace-context-chip__main span {
  color: color-mix(in srgb, currentColor 66%, transparent);
  font-size: 10px;
}

.workspace-context-chip__open {
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  background: color-mix(in srgb, currentColor 8%, transparent);
  color: inherit;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  padding: 4px 8px;
}

.workspace-context-chip__remove {
  border: 0;
  background: transparent;
  font-size: 14px;
  line-height: 1;
  color: color-mix(in srgb, currentColor 66%, transparent);
}
</style>
