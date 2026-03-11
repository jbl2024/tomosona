<script setup lang="ts">
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CommandLineIcon,
  HomeIcon,
  ShareIcon,
  SparklesIcon
} from '@heroicons/vue/24/outline'
import { ref, type CSSProperties } from 'vue'
import MultiPaneToolbarMenu from '../panes/MultiPaneToolbarMenu.vue'
import WorkspaceOverflowMenu from './WorkspaceOverflowMenu.vue'
import type { ThemePreference } from '../../composables/useAppTheme'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'

/**
 * Module: TopbarNavigationControls
 *
 * Purpose:
 * - Render the app-shell top bar with grouped navigation, a command trigger,
 *   pane actions, and the workspace overflow menu.
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
  commandPaletteShortcutLabel: string
  hasWorkspace: boolean
  sidebarVisible: boolean
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
  showDebugTools?: boolean
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
  toggleSidebar: []
  toggleRightPane: []
  toggleOverflow: []
  openCommandPalette: []
  openShortcuts: []
  openSettings: []
  openDesignSystemDebug: []
  rebuildIndex: []
  closeWorkspace: []
  zoomIn: []
  zoomOut: []
  resetZoom: []
  setTheme: [value: ThemePreference]
}>()

const backHistoryMenuRef = ref<HTMLElement | null>(null)
const forwardHistoryMenuRef = ref<HTMLElement | null>(null)
const backHistoryButtonRef = ref<InstanceType<typeof UiIconButton> | null>(null)
const forwardHistoryButtonRef = ref<InstanceType<typeof UiIconButton> | null>(null)
const overflowRef = ref<InstanceType<typeof WorkspaceOverflowMenu> | null>(null)

/** Returns the history button element used as anchor for menu positioning. */
function getHistoryButtonEl(side: 'back' | 'forward'): HTMLElement | null {
  return side === 'back'
    ? backHistoryButtonRef.value?.getRootEl() ?? null
    : forwardHistoryButtonRef.value?.getRootEl() ?? null
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
    <div class="topbar-content">
      <div class="topbar-side topbar-side-left">
        <div class="toolbar-group toolbar-group-window">
          <UiIconButton
            class-name="toolbar-icon-btn"
            :active="sidebarVisible"
            :title="sidebarVisible ? 'Hide sidebar' : 'Show sidebar'"
            :aria-label="sidebarVisible ? 'Hide sidebar' : 'Show sidebar'"
            @click="emit('toggleSidebar')"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" ry="1.5" />
              <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
            </svg>
          </UiIconButton>
        </div>

        <div class="toolbar-group">
          <div ref="backHistoryMenuRef" class="history-nav-wrap">
            <UiIconButton
              ref="backHistoryButtonRef"
              class-name="toolbar-icon-btn"
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
            </UiIconButton>
            <UiMenu v-if="historyMenuOpen === 'back'" class-name="history-menu" :style="historyMenuStyle">
              <UiMenuList>
              <button
                v-for="target in backItems"
                :key="target.key"
                type="button"
                class="ui-menu-item history-menu-item"
                @click="emit('historyTargetClick', target.index)"
              >
                {{ target.label }}
              </button>
              </UiMenuList>
              <div v-if="!backItems.length" class="history-menu-empty">No back history</div>
            </UiMenu>
          </div>

          <div ref="forwardHistoryMenuRef" class="history-nav-wrap">
            <UiIconButton
              ref="forwardHistoryButtonRef"
              class-name="toolbar-icon-btn"
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
            </UiIconButton>
            <UiMenu
              v-if="historyMenuOpen === 'forward'"
              class-name="history-menu history-menu-forward"
              :style="historyMenuStyle"
            >
              <UiMenuList>
              <button
                v-for="target in forwardItems"
                :key="target.key"
                type="button"
                class="ui-menu-item history-menu-item"
                @click="emit('historyTargetClick', target.index)"
              >
                {{ target.label }}
              </button>
              </UiMenuList>
              <div v-if="!forwardItems.length" class="history-menu-empty">No forward history</div>
            </UiMenu>
          </div>
        </div>

        <div class="toolbar-group toolbar-group-nav-tail">
          <UiIconButton
            class-name="toolbar-icon-btn"
            :disabled="!hasWorkspace"
            :title="`Home (${homeShortcutLabel})`"
            :aria-label="`Home (${homeShortcutLabel})`"
            @click="emit('openToday')"
          >
            <HomeIcon />
          </UiIconButton>
        </div>
      </div>

      <button
        type="button"
        class="command-trigger"
        :disabled="!hasWorkspace"
        :title="`Search or type a command (${commandPaletteShortcutLabel})`"
        :aria-label="`Search or type a command (${commandPaletteShortcutLabel})`"
        @click="emit('openCommandPalette')"
      >
        <span class="command-trigger-copy">
          <CommandLineIcon class="command-trigger-icon" />
          <span class="command-trigger-label">Search or type a command...</span>
        </span>
        <span class="command-trigger-shortcut">{{ commandPaletteShortcutLabel }}</span>
      </button>

      <div class="topbar-side topbar-side-right">
        <div class="toolbar-group">
          <UiIconButton
            class-name="toolbar-icon-btn"
            :disabled="!hasWorkspace"
            title="Cosmos view"
            aria-label="Cosmos view"
            @click="emit('openCosmos')"
          >
            <ShareIcon />
          </UiIconButton>
          <UiIconButton
            class-name="toolbar-icon-btn"
            :disabled="!hasWorkspace"
            title="Second Brain"
            aria-label="Second Brain"
            @click="emit('openSecondBrain')"
          >
            <SparklesIcon />
          </UiIconButton>
        </div>

        <div class="toolbar-group">
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
        </div>

        <div class="toolbar-group toolbar-group-overflow">
          <WorkspaceOverflowMenu
            ref="overflowRef"
            :open="overflowMenuOpen"
            :has-workspace="hasWorkspace"
            :indexing-state="indexingState"
            :zoom-percent-label="zoomPercentLabel"
            :theme-preference="themePreference"
            :show-debug-tools="showDebugTools"
            @toggle="emit('toggleOverflow')"
            @open-command-palette="emit('openCommandPalette')"
            @open-shortcuts="emit('openShortcuts')"
            @open-settings="emit('openSettings')"
            @open-design-system-debug="emit('openDesignSystemDebug')"
            @rebuild-index="emit('rebuildIndex')"
            @close-workspace="emit('closeWorkspace')"
            @zoom-in="emit('zoomIn')"
            @zoom-out="emit('zoomOut')"
            @reset-zoom="emit('resetZoom')"
            @set-theme="emit('setTheme', $event)"
          />
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: 42px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--topbar-border);
  background: var(--topbar-bg);
  flex: 0 0 auto;
}

:global(.ide-root.macos-overlay .topbar) {
  box-sizing: border-box;
  min-height: 52px;
}

.topbar-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 0 12px;
}

.topbar-side {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.topbar-side-left {
  flex: 1 1 0;
}

.topbar-side-right {
  flex: 1 1 0;
  justify-content: flex-end;
}

.toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid var(--topbar-divider);
}

.toolbar-group:last-child {
  padding-right: 0;
  border-right: 0;
}

.history-nav-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 28px;
}

.command-trigger {
  flex: 0 1 440px;
  min-width: 220px;
  max-width: 520px;
  height: 30px;
  border: 1px solid var(--topbar-command-border);
  border-radius: 10px;
  background: var(--topbar-command-bg);
  color: var(--topbar-text);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  box-shadow: var(--topbar-command-shadow);
  backdrop-filter: blur(10px);
}

.command-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--topbar-command-hover-bg);
  color: var(--topbar-text-strong);
}

.command-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.command-trigger-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.command-trigger-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.command-trigger-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.command-trigger-shortcut {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--topbar-command-shortcut);
}

.history-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 90;
  min-width: 220px;
  max-width: 320px;
  border: 1px solid var(--menu-border);
  border-radius: 10px;
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.history-menu-item {
  border: 0;
  background: transparent;
  color: var(--menu-text);
  border-radius: 8px;
  text-align: left;
  padding: 7px 8px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-menu-item:hover {
  background: var(--menu-hover-bg);
  color: var(--menu-text-strong);
}

.history-menu-empty {
  padding: 7px 8px;
  font-size: 12px;
  color: var(--text-dim);
}

@media (min-width: 981px) {
  :global(.ide-root.macos-overlay .topbar-content) {
    padding-left: 84px;
  }
}

@media (max-width: 980px) {
  .topbar-content {
    gap: 4px;
    padding: 0 8px;
  }

  .command-trigger {
    flex-basis: 280px;
  }
}

@media (max-width: 760px) {
  .command-trigger {
    min-width: 0;
    flex: 1 1 auto;
  }

  .command-trigger-shortcut,
  .toolbar-group-window,
  .toolbar-group-nav-tail {
    display: none;
  }
}
</style>
