<script setup lang="ts">
import { Bars3Icon, SwatchIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'
import UiSeparator from '../../../shared/components/ui/UiSeparator.vue'

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
  activeThemeLabel: string
  showDebugTools?: boolean
}>()

/** Events emitted for each menu action so the parent can keep state ownership. */
const emit = defineEmits<{
  toggle: []
  openCommandPalette: []
  openShortcuts: []
  openAbout: []
  openDesignSystemDebug: []
  rebuildIndex: []
  closeWorkspace: []
  zoomIn: []
  zoomOut: []
  resetZoom: []
  openThemePicker: []
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
    <UiIconButton
      class-name="toolbar-icon-btn"
      aria-label="View options"
      title="View options"
      :aria-expanded="open"
      :active="open"
      @click="emit('toggle')"
    >
      <Bars3Icon />
    </UiIconButton>
    <UiMenu v-if="open" class-name="overflow-menu">
      <UiMenuList>
      <button type="button" class="ui-menu-item overflow-item" @click="emit('openCommandPalette')">
        <span class="ui-menu-item-icon-spacer" aria-hidden="true"></span>
        Command palette
      </button>
      <button type="button" class="ui-menu-item overflow-item" @click="emit('openShortcuts')">
        <span class="ui-menu-item-icon-spacer" aria-hidden="true"></span>
        Keyboard shortcuts
      </button>
      <button type="button" class="ui-menu-item overflow-item" @click="emit('openAbout')">
        <span class="ui-menu-item-icon-spacer" aria-hidden="true"></span>
        About
      </button>
      <button v-if="showDebugTools" type="button" class="ui-menu-item overflow-item" @click="emit('openDesignSystemDebug')">
        <span class="ui-menu-item-icon-spacer" aria-hidden="true"></span>
        Design system debug
      </button>
      <button type="button" class="ui-menu-item overflow-item" :disabled="rebuildDisabled" @click="emit('rebuildIndex')">
        <span class="ui-menu-item-icon overflow-item-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.5a5.5 5.5 0 1 1-4.4 2.2" />
            <polyline points="1.8,2.6 4.9,2.6 4.9,5.7" />
          </svg>
        </span>
        Reindex workspace
      </button>
      <button
        type="button"
        class="ui-menu-item overflow-item"
        data-tone="danger"
        :disabled="closeDisabled"
        @click="emit('closeWorkspace')"
      >
        <span class="ui-menu-item-icon overflow-item-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </span>
        Close workspace
      </button>
      </UiMenuList>
      <UiSeparator class="overflow-divider" />
      <div class="overflow-label">Zoom</div>
      <UiMenuList>
      <button type="button" class="ui-menu-item overflow-item" @click="emit('zoomIn')">
        <span class="ui-menu-item-icon overflow-item-icon overflow-glyph" aria-hidden="true">+</span>
        Zoom in
      </button>
      <button type="button" class="ui-menu-item overflow-item" @click="emit('zoomOut')">
        <span class="ui-menu-item-icon overflow-item-icon overflow-glyph" aria-hidden="true">-</span>
        Zoom out
      </button>
      <button type="button" class="ui-menu-item overflow-item" @click="emit('resetZoom')">
        <span class="ui-menu-item-icon overflow-item-icon overflow-glyph" aria-hidden="true">100</span>
        Reset zoom
      </button>
      </UiMenuList>
      <div class="overflow-zoom-state">Editor zoom: {{ zoomPercentLabel }}</div>
      <UiSeparator class="overflow-divider" />
      <div class="overflow-label">Theme</div>
      <UiMenuList>
      <button
        type="button"
        class="ui-menu-item overflow-item"
        data-tone="accent"
        @click="emit('openThemePicker')"
      >
        <span class="ui-menu-item-icon overflow-item-icon" aria-hidden="true">
          <SwatchIcon />
        </span>
        Theme picker
      </button>
      </UiMenuList>
      <div class="overflow-zoom-state">Current theme: {{ activeThemeLabel }}</div>
    </UiMenu>
  </div>
</template>

<style scoped>
.overflow-wrap {
  position: relative;
}

.overflow-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 220px;
}

.overflow-item {
  justify-content: flex-start;
}

.overflow-item-icon {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  flex: 0 0 auto;
}

.overflow-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  border: 1px solid currentColor;
  border-radius: 3px;
}

.overflow-zoom-state {
  padding: 2px 10px 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.overflow-divider {
  margin: 4px 0;
}

.overflow-label {
  padding: 2px 10px 4px;
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
</style>
