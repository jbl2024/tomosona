<script setup lang="ts">
import { computed, ref } from 'vue'

/** Visual role supported by the shared button primitive. */
export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** Physical size supported by the shared button primitive. */
export type UiButtonSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: UiButtonVariant
  size?: UiButtonSize
  disabled?: boolean
  loading?: boolean
  active?: boolean
  type?: 'button' | 'submit' | 'reset'
  className?: string
}>(), {
  variant: 'secondary',
  size: 'md',
  disabled: false,
  loading: false,
  active: false,
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
  if (props.variant === 'danger') {
    return 'ui-button--danger'
  }
  return 'ui-button--secondary'
})

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'h-8 px-3 text-xs'
  if (props.size === 'lg') return 'h-11 px-4 text-sm'
  return 'h-10 px-4 text-sm'
})

const rootEl = ref<HTMLButtonElement | null>(null)

defineExpose({
  rootEl
})
</script>

<template>
  <button
    ref="rootEl"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
    :class="[
      'ui-button inline-flex items-center justify-center gap-2 border font-medium transition duration-150',
      'disabled:cursor-not-allowed disabled:opacity-45',
      variantClass,
      sizeClass,
      { 'ui-button--active': active },
      className
    ]"
  >
    <span v-if="loading" class="ui-button__spinner" aria-hidden="true"></span>
    <span v-if="$slots.leading" class="ui-button__icon">
      <slot name="leading" />
    </span>
    <slot />
    <span v-if="$slots.trailing" class="ui-button__icon">
      <slot name="trailing" />
    </span>
  </button>
</template>

<style scoped>
.ui-button {
  border-color: var(--button-secondary-border);
  border-radius: var(--radius-md);
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
  border-color: transparent;
  background: transparent;
  color: var(--button-ghost-text);
}

.ui-button--ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--surface-muted) 88%, transparent);
  color: var(--button-ghost-hover-text);
}

.ui-button--danger {
  border-color: var(--button-danger-border);
  background: var(--button-danger-bg);
  color: var(--button-danger-text);
}

.ui-button--danger:hover:not(:disabled) {
  background: var(--button-danger-hover);
}

.ui-button--active {
  border-color: var(--button-active-border);
  background: var(--button-active-bg);
  color: var(--button-active-text);
}

.ui-button__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ui-button__spinner {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  animation: ui-button-spin 0.8s linear infinite;
}

@keyframes ui-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
