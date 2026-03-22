<script setup lang="ts">
import { ref, type CSSProperties } from 'vue'
import TopbarNavigationControls from './TopbarNavigationControls.vue'

/**
 * Module: AppShellChromeSurface
 *
 * Purpose:
 * - Own the shell chrome composition for the top navigation bar so `App.vue`
 *   stays focused on orchestration.
 *
 * Boundary:
 * - The parent still owns shell state and command handlers.
 * - This component only assembles the top chrome surface and forwards its
 *   interactions.
 */

export type AppShellChromeSurfaceExposed = {
  getHistoryButtonEl: (side: 'back' | 'forward') => HTMLElement | null
  containsOverflowTarget: (target: Node | null) => boolean
  containsHistoryMenuTarget: (side: 'back' | 'forward', target: Node | null) => boolean
}

const props = defineProps<{
  canGoBack: boolean
  canGoForward: boolean
  backShortcutLabel: string
  forwardShortcutLabel: string
  homeShortcutLabel: string
  commandPaletteShortcutLabel: string
  hasWorkspace: boolean
  sidebarVisible: boolean
  rightPaneVisible: boolean
  historyMenuOpen: 'back' | 'forward' | null
  historyMenuStyle: CSSProperties | Record<string, string>
  backItems: Array<{ index: number; key: string; label: string }>
  forwardItems: Array<{ index: number; key: string; label: string }>
  paneCount: number
  overflowMenuOpen: boolean
  indexingState: 'idle' | 'indexing' | 'indexed' | 'out_of_sync'
  zoomPercentLabel: string
  activeThemeLabel: string
  showDebugTools?: boolean
}>()

const emit = defineEmits<{
  historyButtonClick: [side: 'back' | 'forward']
  historyButtonContextMenu: [side: 'back' | 'forward', event: MouseEvent]
  historyButtonPointerDown: [side: 'back' | 'forward', event: PointerEvent]
  historyLongPressCancel: []
  historyTargetClick: [targetIndex: number]
  openToday: []
  openCosmos: []
  openSecondBrain: []
  splitRight: []
  splitDown: []
  focusPane: [index: number]
  focusNext: []
  moveTabNext: []
  closePane: []
  joinPanes: []
  resetLayout: []
  toggleSidebar: []
  toggleRightPane: []
  toggleOverflow: []
  openCommandPalette: []
  openShortcuts: []
  openAbout: []
  openSettings: []
  openDesignSystemDebug: []
  rebuildIndex: []
  closeWorkspace: []
  zoomIn: []
  zoomOut: []
  resetZoom: []
  openThemePicker: []
}>()

const topbarRef = ref<InstanceType<typeof TopbarNavigationControls> | null>(null)

function getHistoryButtonEl(side: 'back' | 'forward'): HTMLElement | null {
  return topbarRef.value?.getHistoryButtonEl(side) ?? null
}

function containsHistoryMenuTarget(side: 'back' | 'forward', target: Node | null): boolean {
  return topbarRef.value?.containsHistoryMenuTarget(side, target) ?? false
}

function containsOverflowTarget(target: Node | null): boolean {
  return topbarRef.value?.containsOverflowTarget(target) ?? false
}

defineExpose<AppShellChromeSurfaceExposed>({
  getHistoryButtonEl,
  containsOverflowTarget,
  containsHistoryMenuTarget
})
</script>

<template>
  <div class="app-shell-chrome">
    <TopbarNavigationControls
      ref="topbarRef"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :back-shortcut-label="backShortcutLabel"
      :forward-shortcut-label="forwardShortcutLabel"
      :home-shortcut-label="homeShortcutLabel"
      :command-palette-shortcut-label="commandPaletteShortcutLabel"
      :has-workspace="hasWorkspace"
      :sidebar-visible="sidebarVisible"
      :right-pane-visible="rightPaneVisible"
      :history-menu-open="historyMenuOpen"
      :history-menu-style="historyMenuStyle"
      :back-items="backItems"
      :forward-items="forwardItems"
      :pane-count="paneCount"
      :overflow-menu-open="overflowMenuOpen"
      :indexing-state="indexingState"
      :zoom-percent-label="zoomPercentLabel"
      :active-theme-label="activeThemeLabel"
      :show-debug-tools="showDebugTools"
      @history-button-click="emit('historyButtonClick', $event)"
      @history-button-context-menu="(side, event) => emit('historyButtonContextMenu', side, event)"
      @history-button-pointer-down="(side, event) => emit('historyButtonPointerDown', side, event)"
      @history-long-press-cancel="emit('historyLongPressCancel')"
      @history-target-click="emit('historyTargetClick', $event)"
      @open-today="emit('openToday')"
      @open-cosmos="emit('openCosmos')"
      @open-second-brain="emit('openSecondBrain')"
      @split-right="emit('splitRight')"
      @split-down="emit('splitDown')"
      @focus-pane="emit('focusPane', $event)"
      @focus-next="emit('focusNext')"
      @move-tab-next="emit('moveTabNext')"
      @close-pane="emit('closePane')"
      @join-panes="emit('joinPanes')"
      @reset-layout="emit('resetLayout')"
      @toggle-sidebar="emit('toggleSidebar')"
      @toggle-right-pane="emit('toggleRightPane')"
      @toggle-overflow="emit('toggleOverflow')"
      @open-command-palette="emit('openCommandPalette')"
      @open-shortcuts="emit('openShortcuts')"
      @open-about="emit('openAbout')"
      @open-settings="emit('openSettings')"
      @open-design-system-debug="emit('openDesignSystemDebug')"
      @rebuild-index="emit('rebuildIndex')"
      @close-workspace="emit('closeWorkspace')"
      @zoom-in="emit('zoomIn')"
      @zoom-out="emit('zoomOut')"
      @reset-zoom="emit('resetZoom')"
      @open-theme-picker="emit('openThemePicker')"
    />
  </div>
</template>
