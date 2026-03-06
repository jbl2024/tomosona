<script setup lang="ts">
import type { SecondBrainModeSpec } from '../../lib/secondBrainModes'

const props = defineProps<{
  modes: SecondBrainModeSpec[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <label class="sb-mode-select-wrap">
    <span class="sb-label">Mode</span>
    <select
      class="sb-mode-select"
      :value="props.modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="mode in props.modes" :key="mode.id" :value="mode.id">
        {{ mode.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.sb-mode-select-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-label {
  font-size: 12px;
  color: var(--sb-text-dim);
}
.sb-mode-select {
  height: 32px;
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  font-size: 12px;
  padding: 0 8px;
}
</style>
