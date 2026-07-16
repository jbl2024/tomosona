<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DocumentIcon, HomeIcon } from '@heroicons/vue/24/outline'
import type { PaneState, PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import {
  ALTERS_SURFACE_ICON,
  ALTER_EXPLORATION_SURFACE_ICON,
  COSMOS_SURFACE_ICON,
  SECOND_BRAIN_SURFACE_ICON
} from '../../lib/appShellSurfaceIcons'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'

/**
 * Module: EditorPaneTabs
 *
 * Purpose:
 * - Render the tab strip for a pane and own the local tab context menu.
 * - Keep pointer gestures and menu positioning close to the tab UI, while the
 *   shell still owns the actual tab state mutations.
 */

export type FileEditorStatus = {
  dirty: boolean
  saving: boolean
  saveError: string
}

const props = defineProps<{
  pane: PaneState
  isActivePane: boolean
  getStatus: (path: string) => FileEditorStatus
}>()

const emit = defineEmits<{
  'pane-focus': [payload: { paneId: string }]
  'tab-click': [payload: { paneId: string; tabId: string }]
  'tab-close': [payload: { paneId: string; tabId: string }]
  'tab-close-others': [payload: { paneId: string; tabId: string }]
  'tab-close-left': [payload: { paneId: string; tabId: string }]
  'tab-close-right': [payload: { paneId: string; tabId: string }]
  'tab-close-all': [payload: { paneId: string }]
  'request-move-tab': [payload: { paneId: string; direction: 'next' | 'previous' }]
}>()

const tabs = computed(() => props.pane.openTabs.map((tab) => {
  const status = tab.type === 'document'
    ? props.getStatus(tab.path)
    : { dirty: false, saving: false, saveError: '' }
  return {
    ...tab,
    title: tabTitle(tab),
    icon: tabIcon(tab),
    dirty: status.dirty,
    saving: status.saving
  }
}))

const contextMenuTabId = ref('')
const contextMenuPosition = ref({ x: 0, y: 0 })
const wrapRef = ref<HTMLElement | null>(null)
const tabRefs = new Map<string, HTMLElement>()
const contextMenuItemRefs = ref<Array<HTMLButtonElement | null>>([])
const contextMenuActiveIndex = ref<number | null>(null)

const contextMenuTabIndex = computed(() => tabs.value.findIndex((tab) => tab.id === contextMenuTabId.value))
const contextMenuOpen = computed(() => contextMenuTabId.value !== '')
const canCloseTabsLeft = computed(() => contextMenuTabIndex.value > 0)
const canCloseTabsRight = computed(() => {
  const index = contextMenuTabIndex.value
  return index >= 0 && index < tabs.value.length - 1
})
const contextMenuStyle = computed(() => ({
  position: 'fixed',
  left: `${contextMenuPosition.value.x}px`,
  top: `${contextMenuPosition.value.y}px`,
  zIndex: 60
}))
const contextMenuItems = computed(() => [
  {
    action: 'tab-close' as const,
    label: 'Close',
    disabled: false
  },
  {
    action: 'tab-close-others' as const,
    label: 'Close Others',
    disabled: false
  },
  {
    action: 'tab-close-left' as const,
    label: 'Close Tabs to the Left',
    disabled: !canCloseTabsLeft.value
  },
  {
    action: 'tab-close-right' as const,
    label: 'Close Tabs to the Right',
    disabled: !canCloseTabsRight.value
  }
])

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function tabTitle(tab: PaneTab): string {
  if (tab.type === 'document') return fileName(tab.path)
  if (tab.type === 'file-inspector') return fileName(tab.path)
  if (tab.type === 'home') return 'Home'
  if (tab.type === 'cosmos') return 'Cosmos'
  if (tab.type === 'alter-exploration') return 'Alter Exploration'
  if (tab.type === 'alters') return 'Alters'
  return 'Second Brain'
}

function tabIcon(tab: PaneTab) {
  if (tab.type === 'file-inspector') return DocumentIcon
  if (tab.type === 'cosmos') return COSMOS_SURFACE_ICON
  if (tab.type === 'second-brain-chat') return SECOND_BRAIN_SURFACE_ICON
  if (tab.type === 'alter-exploration') return ALTER_EXPLORATION_SURFACE_ICON
  if (tab.type === 'alters') return ALTERS_SURFACE_ICON
  return null
}

function closeContextMenu() {
  contextMenuTabId.value = ''
  contextMenuItemRefs.value = []
  contextMenuActiveIndex.value = null
}

function openContextMenu(tabId: string, event: MouseEvent) {
  emit('pane-focus', { paneId: props.pane.id })
  contextMenuTabId.value = tabId
  contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  contextMenuActiveIndex.value = null
}

function emitContextMenuAction(action: 'tab-close' | 'tab-close-others' | 'tab-close-left' | 'tab-close-right') {
  const tabId = contextMenuTabId.value
  if (!tabId) return
  closeContextMenu()
  if (action === 'tab-close') {
    emit('tab-close', { paneId: props.pane.id, tabId })
    return
  }
  if (action === 'tab-close-others') {
    emit('tab-close-others', { paneId: props.pane.id, tabId })
    return
  }
  if (action === 'tab-close-left') {
    emit('tab-close-left', { paneId: props.pane.id, tabId })
    return
  }
  emit('tab-close-right', { paneId: props.pane.id, tabId })
}

function selectTab(tabId: string) {
  closeContextMenu()
  emit('tab-click', { paneId: props.pane.id, tabId })
}

function setTabRef(tabId: string, element: HTMLElement | null) {
  if (element) {
    tabRefs.set(tabId, element)
    return
  }
  tabRefs.delete(tabId)
}

async function revealActiveTab() {
  const activeTabId = props.pane.activeTabId
  if (!activeTabId) return

  await nextTick()
  tabRefs.get(activeTabId)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'auto'
  })
}

function onTabAuxClick(tabId: string, event: MouseEvent) {
  if (event.button !== 1) return
  event.preventDefault()
  closeContextMenu()
  emit('tab-close', { paneId: props.pane.id, tabId })
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!contextMenuOpen.value) return
  const target = event.target as Node | null
  if (target && wrapRef.value?.contains(target)) return
  closeContextMenu()
}

function setContextMenuItemRef(el: HTMLButtonElement | null, index: number) {
  contextMenuItemRefs.value[index] = el
}

function enabledContextMenuIndices(): number[] {
  return contextMenuItems.value.flatMap((item, index) => item.disabled ? [] : [index])
}

function setActiveContextMenuIndex(index: number | null) {
  contextMenuActiveIndex.value = index
  if (index === null) return
  contextMenuItemRefs.value[index]?.focus()
}

function moveContextMenuFocus(direction: 'next' | 'previous') {
  const enabledIndices = enabledContextMenuIndices()
  if (!enabledIndices.length) return

  if (contextMenuActiveIndex.value === null || !enabledIndices.includes(contextMenuActiveIndex.value)) {
    setActiveContextMenuIndex(direction === 'next' ? enabledIndices[0] : enabledIndices[enabledIndices.length - 1])
    return
  }

  const currentEnabledIndex = enabledIndices.indexOf(contextMenuActiveIndex.value)
  const step = direction === 'next' ? 1 : -1
  const nextEnabledIndex = (currentEnabledIndex + step + enabledIndices.length) % enabledIndices.length
  setActiveContextMenuIndex(enabledIndices[nextEnabledIndex] ?? null)
}

function activateActiveContextMenuItem() {
  const activeIndex = contextMenuActiveIndex.value
  if (activeIndex === null) return
  const activeItem = contextMenuItems.value[activeIndex]
  if (!activeItem || activeItem.disabled) return
  emitContextMenuAction(activeItem.action)
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!contextMenuOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeContextMenu()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    moveContextMenuFocus('next')
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    moveContextMenuFocus('previous')
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    activateActiveContextMenuItem()
  }
}

watch(() => props.pane.activeTabId, revealActiveTab, {
  immediate: true,
  flush: 'post'
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown, true)
})
</script>

<template>
  <div ref="wrapRef" class="pane-tabs" @mousedown="emit('pane-focus', { paneId: pane.id })">
    <div class="pane-tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        :ref="(element) => setTabRef(tab.id, element as HTMLElement | null)"
        role="button"
        tabindex="0"
        class="pane-tab-item"
        :class="{
          active: pane.activeTabId === tab.id,
          'active-pane': pane.activeTabId === tab.id && isActivePane
        }"
        @click="selectTab(tab.id)"
        @contextmenu.prevent="openContextMenu(tab.id, $event)"
        @auxclick.stop="onTabAuxClick(tab.id, $event)"
        @keydown.enter.prevent="selectTab(tab.id)"
        @keydown.space.prevent="selectTab(tab.id)"
      >
        <span v-if="tab.type === 'home'" class="pane-tab-icon pane-tab-icon--hero">
          <HomeIcon />
        </span>
        <span v-else-if="tabIcon(tab)" class="pane-tab-icon pane-tab-icon--hero">
          <component :is="tabIcon(tab)" />
        </span>
        <span v-else-if="tab.icon" class="pane-tab-icon">{{ tab.icon }}</span>
        <span class="pane-tab-name">{{ tab.title }}</span>
        <span v-if="tab.saving" class="pane-tab-state" title="Saving">~</span>
        <span v-else-if="tab.dirty" class="pane-tab-state" title="Unsaved">•</span>
        <button
          type="button"
          class="pane-tab-close"
          aria-label="Close tab"
          @click.stop="emit('tab-close', { paneId: pane.id, tabId: tab.id })"
        >
          x
        </button>
      </div>
      <div v-if="!tabs.length" class="pane-tab-empty">No open files</div>
    </div>
    <div class="pane-tabs-actions">
      <button type="button" class="pane-tab-action" @click="emit('request-move-tab', { paneId: pane.id, direction: 'previous' })" title="Move active tab to previous pane">←</button>
      <button type="button" class="pane-tab-action" @click="emit('request-move-tab', { paneId: pane.id, direction: 'next' })" title="Move active tab to next pane">→</button>
      <button
        type="button"
        class="pane-tab-action"
        :disabled="!pane.activeTabId"
        @click="emit('tab-close-others', { paneId: pane.id, tabId: pane.activeTabId })"
        title="Close other tabs"
      >
        O
      </button>
      <button
        type="button"
        class="pane-tab-action"
        @click="emit('tab-close-all', { paneId: pane.id })"
        title="Close all tabs"
      >
        A
      </button>
    </div>
    <UiMenu v-if="contextMenuOpen" class-name="pane-tab-menu" :style="contextMenuStyle">
      <UiMenuList>
        <button
          v-for="(item, index) in contextMenuItems"
          :key="item.action"
          type="button"
          class="ui-menu-item pane-tab-menu-item"
          :ref="(el) => setContextMenuItemRef(el as HTMLButtonElement | null, index)"
          :disabled="item.disabled"
          :data-active="contextMenuActiveIndex === index ? 'true' : undefined"
          @mouseenter="setActiveContextMenuIndex(item.disabled ? null : index)"
          @click="emitContextMenuAction(item.action)"
        >
          {{ item.label }}
        </button>
      </UiMenuList>
    </UiMenu>
  </div>
</template>

<style scoped>
.pane-tabs {
  display: flex;
  align-items: stretch;
  min-height: 32px;
  border-bottom: 1px solid var(--tabbar-border);
  background: var(--tabbar-bg);
  font-size: 0.84rem;
  user-select: none;
  -webkit-user-select: none;
}

.pane-tabs-scroll {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.pane-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.pane-tab-item {
  max-width: 220px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.52rem;
  border: 0;
  background: transparent;
  color: var(--tabbar-tab-text);
  cursor: pointer;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
}

.pane-tab-item::after {
  content: '';
  position: absolute;
  right: 0;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: var(--tabbar-tab-separator);
}

.pane-tab-item.active {
  background: var(--tabbar-tab-active-bg);
  color: var(--tabbar-tab-text-active);
}

.pane-tab-item.active-pane {
  background: var(--tabbar-tab-active-pane-bg);
  box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--tabbar-tab-active-indicator) 70%, transparent);
}

.pane-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.pane-tab-icon {
  font-size: 0.7rem;
  opacity: 0.78;
}

.pane-tab-icon--hero {
  width: 0.95rem;
  height: 0.95rem;
  opacity: 0.9;
}

.pane-tab-state {
  font-size: 0.7rem;
  opacity: 0.75;
}

.pane-tab-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  line-height: 1;
}

.pane-tabs-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0 0.3rem;
  border-left: 1px solid var(--tabbar-border);
}

.pane-tab-action {
  border: 1px solid var(--tabbar-action-border);
  background: var(--tabbar-action-bg);
  color: var(--tabbar-action-text);
  padding: 0.12rem 0.32rem;
  border-radius: 4px;
  font-size: 0.68rem;
  cursor: pointer;
}

.pane-tab-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pane-tab-empty {
  display: inline-flex;
  align-items: center;
  color: var(--tabbar-empty);
  padding: 0.32rem 0.56rem;
  font-size: 0.76rem;
}

.pane-tab-menu {
  min-width: 220px;
}

.pane-tab-menu-item {
  justify-content: flex-start;
}

</style>
