<script setup lang="ts">
/** Physical size supported by the shared text input primitive. */
export type UiInputSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  size?: UiInputSize
  invalid?: boolean
  className?: string
}>(), {
  placeholder: '',
  size: 'md',
  invalid: false,
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
    :aria-invalid="invalid ? 'true' : undefined"
    :class="[
      'ui-input w-full border px-3 outline-none transition',
      {
        'h-8 text-xs': size === 'sm',
        'h-10 text-sm': size === 'md',
        'h-11 text-sm': size === 'lg',
        'ui-input--invalid': invalid
      },
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
  border-radius: var(--radius-md);
}

.ui-input::placeholder {
  color: var(--input-placeholder);
}

.ui-input:focus {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 2px var(--input-focus-ring);
}

.ui-input--invalid {
  border-color: var(--field-error-border);
}
</style>
