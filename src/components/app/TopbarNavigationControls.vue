<script setup lang="ts">
import { ArrowLeftIcon, ArrowRightIcon, HomeIcon, ShareIcon, SparklesIcon } from '@heroicons/vue/24/outline'
import { ref, type CSSProperties } from 'vue'
import MultiPaneToolbarMenu from '../panes/MultiPaneToolbarMenu.vue'
import WorkspaceOverflowMenu from './WorkspaceOverflowMenu.vue'
import type { ThemePreference } from '../../composables/useAppTheme'

/**
 * Module: TopbarNavigationControls
 *
 * Purpose:
 * - Render the app-shell top bar with history controls, pane actions, and the
 *   workspace overflow menu.
 */

/** Normalized row shape rendered inside back/forward history menus. */
export type HistoryMenuItem = {
  index: number
  key: string
  label: string
}

/** Props required to render topbar controls while keeping state in the parent shell. */
const props = defineProps<{
  canGoBack: boolean
  canGoForward: boolean
  backShortcutLabel: string
  forwardShortcutLabel: string
  homeShortcutLabel: string
  hasWorkspace: boolean
  rightPaneVisible: boolean
  historyMenuOpen: 'back' | 'forward' | null
  historyMenuStyle: CSSProperties | Record<string, string>
  backItems: HistoryMenuItem[]
  forwardItems: HistoryMenuItem[]
  paneCount: number
  overflowMenuOpen: boolean
  indexingState: 'idle' | 'indexing' | 'indexed' | 'out_of_sync'
  zoomPercentLabel: string
  themePreference: ThemePreference
}>()

/** Events emitted for every interaction so the parent remains the single state owner. */
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
  toggleRightPane: []
  toggleOverflow: []
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

const backHistoryMenuRef = ref<HTMLElement | null>(null)
const forwardHistoryMenuRef = ref<HTMLElement | null>(null)
const backHistoryButtonRef = ref<HTMLElement | null>(null)
const forwardHistoryButtonRef = ref<HTMLElement | null>(null)
const overflowRef = ref<InstanceType<typeof WorkspaceOverflowMenu> | null>(null)

/** Returns the history button element used as anchor for menu positioning. */
function getHistoryButtonEl(side: 'back' | 'forward'): HTMLElement | null {
  return side === 'back' ? backHistoryButtonRef.value : forwardHistoryButtonRef.value
}

/** Returns true when the DOM target belongs to the requested history menu wrapper. */
function containsHistoryMenuTarget(side: 'back' | 'forward', target: Node | null): boolean {
  const wrap = side === 'back' ? backHistoryMenuRef.value : forwardHistoryMenuRef.value
  return Boolean(target && wrap?.contains(target))
}

/** Returns true when the DOM target belongs to the overflow trigger or menu. */
function containsOverflowTarget(target: Node | null): boolean {
  return overflowRef.value?.containsTarget(target) ?? false
}

defineExpose({
  getHistoryButtonEl,
  containsHistoryMenuTarget,
  containsOverflowTarget
})
</script>

<template>
  <header class="topbar">
    <div class="global-actions">
      <div class="nav-actions">
        <div ref="backHistoryMenuRef" class="history-nav-wrap">
          <button
            ref="backHistoryButtonRef"
            type="button"
            class="toolbar-icon-btn"
            :disabled="!canGoBack"
            :title="`Back (${backShortcutLabel})`"
            :aria-label="`Back (${backShortcutLabel})`"
            @click="emit('historyButtonClick', 'back')"
            @contextmenu.prevent="emit('historyButtonContextMenu', 'back', $event)"
            @pointerdown="emit('historyButtonPointerDown', 'back', $event)"
            @pointerup="emit('historyLongPressCancel')"
            @pointerleave="emit('historyLongPressCancel')"
            @pointercancel="emit('historyLongPressCancel')"
          >
            <ArrowLeftIcon />
          </button>
          <div v-if="historyMenuOpen === 'back'" class="history-menu" :style="historyMenuStyle">
            <button
              v-for="target in backItems"
              :key="target.key"
              type="button"
              class="history-menu-item"
              @click="emit('historyTargetClick', target.index)"
            >
              {{ target.label }}
            </button>
            <div v-if="!backItems.length" class="history-menu-empty">No back history</div>
          </div>
        </div>
        <button
          type="button"
          class="toolbar-icon-btn"
          :disabled="!hasWorkspace"
          :title="`Home: today note (${homeShortcutLabel})`"
          :aria-label="`Home: today note (${homeShortcutLabel})`"
          @click="emit('openToday')"
        >
          <HomeIcon />
        </button>
        <button
          type="button"
          class="toolbar-icon-btn"
          :disabled="!hasWorkspace"
          title="Cosmos view"
          aria-label="Cosmos view"
          @click="emit('openCosmos')"
        >
          <ShareIcon />
        </button>
        <button
          type="button"
          class="toolbar-icon-btn"
          :disabled="!hasWorkspace"
          title="Second Brain"
          aria-label="Second Brain"
          @click="emit('openSecondBrain')"
        >
          <SparklesIcon />
        </button>
        <div ref="forwardHistoryMenuRef" class="history-nav-wrap">
          <button
            ref="forwardHistoryButtonRef"
            type="button"
            class="toolbar-icon-btn"
            :disabled="!canGoForward"
            :title="`Forward (${forwardShortcutLabel})`"
            :aria-label="`Forward (${forwardShortcutLabel})`"
            @click="emit('historyButtonClick', 'forward')"
            @contextmenu.prevent="emit('historyButtonContextMenu', 'forward', $event)"
            @pointerdown="emit('historyButtonPointerDown', 'forward', $event)"
            @pointerup="emit('historyLongPressCancel')"
            @pointerleave="emit('historyLongPressCancel')"
            @pointercancel="emit('historyLongPressCancel')"
          >
            <ArrowRightIcon />
          </button>
          <div
            v-if="historyMenuOpen === 'forward'"
            class="history-menu history-menu-forward"
            :style="historyMenuStyle"
          >
            <button
              v-for="target in forwardItems"
              :key="target.key"
              type="button"
              class="history-menu-item"
              @click="emit('historyTargetClick', target.index)"
            >
              {{ target.label }}
            </button>
            <div v-if="!forwardItems.length" class="history-menu-empty">No forward history</div>
          </div>
        </div>
        <MultiPaneToolbarMenu
          :can-split="paneCount < 4"
          :pane-count="paneCount"
          @split-right="emit('splitRight')"
          @split-down="emit('splitDown')"
          @focus-pane="emit('focusPane', $event.index)"
          @focus-next="emit('focusNext')"
          @move-tab-next="emit('moveTabNext')"
          @close-pane="emit('closePane')"
          @join-panes="emit('joinPanes')"
          @reset-layout="emit('resetLayout')"
        />
      </div>
      <button
        type="button"
        class="toolbar-icon-btn"
        :class="{ active: rightPaneVisible }"
        :title="rightPaneVisible ? 'Hide right pane' : 'Show right pane'"
        :aria-label="rightPaneVisible ? 'Hide right pane' : 'Show right pane'"
        @click="emit('toggleRightPane')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" ry="1.5" />
          <line x1="10" y1="2.5" x2="10" y2="13.5" />
        </svg>
      </button>
      <WorkspaceOverflowMenu
        ref="overflowRef"
        :open="overflowMenuOpen"
        :has-workspace="hasWorkspace"
        :indexing-state="indexingState"
        :zoom-percent-label="zoomPercentLabel"
        :theme-preference="themePreference"
        @toggle="emit('toggleOverflow')"
        @open-command-palette="emit('openCommandPalette')"
        @open-shortcuts="emit('openShortcuts')"
        @open-settings="emit('openSettings')"
        @rebuild-index="emit('rebuildIndex')"
        @close-workspace="emit('closeWorkspace')"
        @zoom-in="emit('zoomIn')"
        @zoom-out="emit('zoomOut')"
        @reset-zoom="emit('resetZoom')"
        @set-theme="emit('setTheme', $event)"
      />
    </div>
  </header>
</template>
