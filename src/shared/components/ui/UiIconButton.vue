<script setup lang="ts">
import { computed, ref } from 'vue'
import UiButton, { type UiButtonSize, type UiButtonVariant } from './UiButton.vue'

/**
 * Icon-only button wrapper built on top of `UiButton`.
 *
 * Why this exists:
 * - keeps icon hit-target sizing consistent across toolbars and menus
 * - preserves the same variant/size/loading contract as `UiButton`
 * - exposes the underlying button element for anchor positioning use cases
 */
const props = withDefaults(defineProps<{
  variant?: UiButtonVariant
  size?: UiButtonSize
  disabled?: boolean
  loading?: boolean
  active?: boolean
  type?: 'button' | 'submit' | 'reset'
  title?: string
  ariaLabel?: string
  className?: string
}>(), {
  variant: 'ghost',
  size: 'sm',
  disabled: false,
  loading: false,
  active: false,
  type: 'button',
  title: '',
  ariaLabel: '',
  className: ''
})

const buttonRef = ref<InstanceType<typeof UiButton> | null>(null)
/** Underlying button element exposed for positioning and hit testing. */
const rootEl = computed(() => buttonRef.value?.rootEl ?? null)
/** Fallback accessible name resolution for icon-only controls. */
const resolvedAriaLabel = computed(() => props.ariaLabel || props.title || '')

defineExpose({
  rootEl,
  getRootEl: () => rootEl.value
})
</script>

<template>
  <UiButton
    ref="buttonRef"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :loading="loading"
    :active="active"
    :type="type"
    :title="title || resolvedAriaLabel"
    :aria-label="resolvedAriaLabel || undefined"
    :class-name="['ui-icon-button px-0', className].filter(Boolean).join(' ')"
  >
    <slot />
  </UiButton>
</template>

<style scoped>
.ui-icon-button {
  width: 2rem;
  min-width: 2rem;
}

.ui-icon-button:deep(svg) {
  width: 1rem;
  height: 1rem;
  flex: 0 0 auto;
}
</style>
