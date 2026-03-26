<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

/**
 * Shared modal shell for standard application dialogs.
 *
 * Responsibilities:
 * - render semantic dialog chrome and backdrop
 * - wire title/description accessibility attributes
 * - expose a predictable header/body/footer layout
 * - keep the body scrollable while header and footer remain fixed
 *
 * Non-responsibilities:
 * - focus trapping
 * - escape-key ownership
 * - domain-specific content and actions
 */
const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  description?: string
  labelledby?: string
  describedby?: string
  width?: 'sm' | 'md' | 'lg' | 'xl'
  panelClass?: string
}>(), {
  description: '',
  labelledby: '',
  describedby: '',
  width: 'md',
  panelClass: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

/**
 * Closes the modal through the controlled component contract.
 *
 * Why:
 * - parent state remains the single source of truth
 * - callers can react to both the model update and the explicit close event
 */
function close() {
  emit('update:modelValue', false)
  emit('close')
}

/**
 * Owns Escape handling for the shared modal shell so content-specific focus
 * behavior does not decide whether dialogs can be dismissed.
 */
function onDocumentKeydown(event: KeyboardEvent) {
  if (!props.modelValue) return
  if (event.key !== 'Escape') return
  event.preventDefault()
  close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onDocumentKeydown)
      return
    }
    document.removeEventListener('keydown', onDocumentKeydown)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div v-if="modelValue" class="ui-modal-shell" @click.self="close">
    <div
      class="ui-modal-shell__panel"
      :class="[`ui-modal-shell__panel--${width}`, panelClass]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledby || 'ui-modal-shell-title'"
      :aria-describedby="describedby || (description ? 'ui-modal-shell-description' : undefined)"
      tabindex="-1"
    >
      <header class="ui-modal-shell__header">
        <div class="flex min-w-0 flex-col gap-1">
          <h3 :id="labelledby || 'ui-modal-shell-title'" class="ui-modal-shell__title">{{ title }}</h3>
          <p v-if="description" :id="describedby || 'ui-modal-shell-description'" class="ui-modal-shell__description">{{ description }}</p>
        </div>
        <slot name="header" />
      </header>
      <div class="ui-modal-shell__body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="ui-modal-shell__footer">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ui-modal-shell {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 5rem 1rem 1rem;
  background: var(--modal-backdrop);
}

.ui-modal-shell__panel {
  width: min(100%, calc(100vw - 2rem));
  max-height: calc(100vh - 6rem);
  border: 1px solid var(--modal-border);
  border-radius: var(--modal-radius);
  background: var(--modal-bg);
  box-shadow: var(--modal-shadow);
  color: var(--modal-title);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ui-modal-shell__panel--sm {
  max-width: 32rem;
}

.ui-modal-shell__panel--md {
  max-width: 38rem;
}

.ui-modal-shell__panel--lg {
  max-width: 64rem;
}

.ui-modal-shell__panel--xl {
  max-width: 75rem;
}

.ui-modal-shell__header,
.ui-modal-shell__body,
.ui-modal-shell__footer {
  padding: 1rem;
}

.ui-modal-shell__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.ui-modal-shell__body {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.ui-modal-shell__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  border-top: 1px solid var(--modal-panel-border);
}

.ui-modal-shell__title {
  font-size: 1rem;
  font-weight: 600;
}

.ui-modal-shell__description {
  color: var(--modal-copy);
  font-size: 0.84rem;
}
</style>
