<script setup lang="ts">
/** Semantic tone supported by the shared badge primitive. */
export type UiBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

withDefaults(defineProps<{
  tone?: UiBadgeTone
  className?: string
}>(), {
  tone: 'neutral',
  className: ''
})
</script>

<template>
  <span :class="['ui-badge inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', `ui-badge--${tone}`, className]">
    <slot />
  </span>
</template>

<style scoped>
.ui-badge--neutral {
  background: var(--badge-neutral-bg);
  color: var(--badge-neutral-text);
}

.ui-badge--accent {
  background: var(--badge-accent-bg);
  color: var(--badge-accent-text);
}

.ui-badge--success {
  background: var(--badge-success-bg);
  color: var(--badge-success-text);
}

.ui-badge--warning {
  background: var(--badge-warning-bg);
  color: var(--badge-warning-text);
}

.ui-badge--danger {
  background: var(--badge-danger-bg);
  color: var(--badge-danger-text);
}
</style>
