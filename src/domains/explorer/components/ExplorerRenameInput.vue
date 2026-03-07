<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'confirm'): void
  (event: 'cancel'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})
</script>

<template>
  <input
    ref="inputRef"
    class="explorer-rename-input h-7 w-full rounded-lg border px-2 text-xs outline-none transition"
    :value="props.modelValue"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @keydown.enter.stop.prevent="emit('confirm')"
    @keydown.esc.stop.prevent="emit('cancel')"
    @blur="emit('confirm')"
  />
</template>

<style scoped>
.explorer-rename-input {
  border-color: var(--input-border);
  background: var(--input-bg);
  color: var(--input-text);
}

.explorer-rename-input:focus {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 2px var(--input-focus-ring);
}
</style>
