<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  className?: string
}>(), {
  placeholder: '',
  className: ''
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <input
    :value="props.modelValue"
    :placeholder="placeholder"
    :class="[
      'ui-input h-10 w-full rounded-xl border px-3 text-sm outline-none transition',
      className
    ]"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.ui-input {
  border-color: var(--input-border);
  background: var(--input-bg);
  color: var(--input-text);
}

.ui-input::placeholder {
  color: var(--input-placeholder);
}

.ui-input:focus {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 2px var(--input-focus-ring);
}
</style>
