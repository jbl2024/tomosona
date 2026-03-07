<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  className?: string
}>(), {
  variant: 'secondary',
  size: 'md',
  disabled: false,
  type: 'button',
  className: ''
})

const variantClass = computed(() => {
  if (props.variant === 'primary') {
    return 'ui-button--primary'
  }
  if (props.variant === 'ghost') {
    return 'ui-button--ghost'
  }
  return 'ui-button--secondary'
})

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'h-8 px-3 text-xs'
  return 'h-10 px-4 text-sm'
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="[
      'ui-button inline-flex items-center justify-center gap-2 rounded-xl border font-medium transition duration-150',
      'disabled:cursor-not-allowed disabled:opacity-45',
      variantClass,
      sizeClass,
      className
    ]"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  border-color: var(--button-secondary-border);
}

.ui-button--primary {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}

.ui-button--primary:hover:not(:disabled) {
  background: var(--button-primary-hover);
}

.ui-button--secondary {
  border-color: var(--button-secondary-border);
  background: var(--button-secondary-bg);
  color: var(--button-secondary-text);
}

.ui-button--secondary:hover:not(:disabled) {
  background: var(--button-secondary-hover);
}

.ui-button--ghost {
  border-color: var(--button-ghost-border);
  background: transparent;
  color: var(--button-ghost-text);
}

.ui-button--ghost:hover:not(:disabled) {
  border-color: var(--button-ghost-hover-border);
  color: var(--button-ghost-hover-text);
}
</style>
