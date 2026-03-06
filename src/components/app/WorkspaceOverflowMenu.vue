<script setup lang="ts">
import { Cog8ToothIcon, CommandLineIcon, ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import type { ThemePreference } from '../../composables/useAppTheme'

/**
 * Module: WorkspaceOverflowMenu
 *
 * Purpose:
 * - Render the app-shell overflow menu as a presentational component.
 * - Keep menu content and button wiring out of `App.vue`.
 */

/** Props required to render the workspace overflow menu. */
const props = defineProps<{
  open: boolean
  hasWorkspace: boolean
  indexingState: 'idle' | 'indexing' | 'indexed' | 'out_of_sync'
  zoomPercentLabel: string
  themePreference: ThemePreference
}>()

/** Events emitted for each menu action so the parent can keep state ownership. */
const emit = defineEmits<{
  toggle: []
  openCommandPalette: []
  openShortcuts: []
  openSettings: []
  rebuildIndex: []
  closeWorkspace: []
  zoomIn: []
  zoomOut: []
  resetZoom: []
  setTheme: [value: ThemePreference]
}>()

const wrapRef = ref<HTMLElement | null>(null)
const rebuildDisabled = computed(() => !props.hasWorkspace || props.indexingState === 'indexing')
const closeDisabled = computed(() => !props.hasWorkspace)

/** Returns true when the provided DOM target lives inside the overflow menu wrapper. */
function containsTarget(target: Node | null): boolean {
  return Boolean(target && wrapRef.value?.contains(target))
}

defineExpose({
  containsTarget
})
</script>

<template>
  <div ref="wrapRef" class="overflow-wrap">
    <button
      type="button"
      class="toolbar-icon-btn"
      title="View options"
      aria-label="View options"
      :aria-expanded="open"
      @click="emit('toggle')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>
    <div v-if="open" class="overflow-menu">
      <button type="button" class="overflow-item" @click="emit('openCommandPalette')">
        <CommandLineIcon class="overflow-item-icon" />
        Command palette
      </button>
      <button type="button" class="overflow-item" @click="emit('openShortcuts')">
        <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="10.5" rx="1.6" ry="1.6" />
          <line x1="4" y1="6" x2="12" y2="6" />
          <line x1="4" y1="9" x2="8.5" y2="9" />
        </svg>
        Keyboard shortcuts
      </button>
      <button type="button" class="overflow-item" @click="emit('openSettings')">
        <Cog8ToothIcon class="overflow-item-icon" />
        Open Settings
      </button>
      <button type="button" class="overflow-item" :disabled="rebuildDisabled" @click="emit('rebuildIndex')">
        <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5a5.5 5.5 0 1 1-4.4 2.2" />
          <polyline points="1.8,2.6 4.9,2.6 4.9,5.7" />
        </svg>
        Reindex workspace
      </button>
      <button type="button" class="overflow-item" :disabled="closeDisabled" @click="emit('closeWorkspace')">
        <svg class="overflow-item-icon" viewBox="0 0 16 16" aria-hidden="true">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
        Close workspace
      </button>
      <div class="overflow-divider"></div>
      <div class="overflow-label">Zoom</div>
      <button type="button" class="overflow-item" @click="emit('zoomIn')">
        <span class="overflow-item-icon overflow-glyph">+</span>
        Zoom in
      </button>
      <button type="button" class="overflow-item" @click="emit('zoomOut')">
        <span class="overflow-item-icon overflow-glyph">-</span>
        Zoom out
      </button>
      <button type="button" class="overflow-item" @click="emit('resetZoom')">
        <span class="overflow-item-icon overflow-glyph">100</span>
        Reset zoom
      </button>
      <div class="overflow-zoom-state">Editor zoom: {{ zoomPercentLabel }}</div>
      <div class="overflow-divider"></div>
      <div class="overflow-label">Theme</div>
      <button
        type="button"
        class="overflow-item"
        :class="{ active: themePreference === 'light' }"
        @click="emit('setTheme', 'light')"
      >
        <SunIcon class="overflow-item-icon" />
        Light
      </button>
      <button
        type="button"
        class="overflow-item"
        :class="{ active: themePreference === 'dark' }"
        @click="emit('setTheme', 'dark')"
      >
        <MoonIcon class="overflow-item-icon" />
        Dark
      </button>
      <button
        type="button"
        class="overflow-item"
        :class="{ active: themePreference === 'system' }"
        @click="emit('setTheme', 'system')"
      >
        <ComputerDesktopIcon class="overflow-item-icon" />
        System
      </button>
    </div>
  </div>
</template>
