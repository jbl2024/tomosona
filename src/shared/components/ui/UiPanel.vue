<script setup lang="ts">
withDefaults(defineProps<{
  className?: string
}>(), {
  className: ''
})
</script>

<template>
  <section
    :class="[
      'ui-panel rounded-2xl border p-4 backdrop-blur-sm',
      className
    ]"
  >
    <slot />
  </section>
</template>

<style scoped>
.ui-panel {
  border-color: var(--panel-border);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
}
</style>
