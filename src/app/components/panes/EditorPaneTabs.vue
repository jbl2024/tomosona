<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeftIcon, ArrowRightIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import { usePageProtectionStates } from '../../../shared/composables/usePageProtectionBadges'
import type { PaneState, PaneTab } from '../../composables/useMultiPaneWorkspaceState'
import { makeDroppable } from '@vue-dnd-kit/core'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'
import EditorPaneTab from './EditorPaneTab.vue'
import EditorPaneTabList from './EditorPaneTabList.vue'
import { hasHomonym, tabFolder, tabLabel, tabPath } from './tabLabels'

/**
 * Module: EditorPaneTabs
 *
 * Purpose:
 * - Render the tab strip for a pane and own the local tab context menu.
 * - Keep pointer gestures and menu positioning close to the tab UI, while the
 *   shell still owns the actual tab state mutations.
 *
 * Presentation rules:
 * - A tab label is the document name without its Markdown extension; the path
 *   stays untouched everywhere else.
 * - At most one transient marker is shown per tab (failed save, then saving,
 *   then unsaved). Protection and pinning are stable, path-derived flags.
 * - The close control always occupies its slot so revealing it never shifts
 *   the title.
 */

export type FileEditorStatus = {
  dirty: boolean
  saving: boolean
  saveError: string
  /** Set when the note could not be read at all. */
  inaccessible?: boolean
}

const props = defineProps<{
  pane: PaneState
  isActivePane: boolean
  getStatus: (path: string) => FileEditorStatus
  /** Total panes in the layout; cross-pane actions need at least two. */
  paneCount?: number
  /** Document paths already open in the other pane, for cross-pane gating. */
  otherPanePaths?: string[]
}>()
const { protectedPaths, lockedPaths } = usePageProtectionStates(
  () => props.pane.openTabs.flatMap((tab) => tab.type === 'document' ? [tab.path] : [])
)

const emit = defineEmits<{
  'pane-focus': [payload: { paneId: string }]
  'tab-click': [payload: { paneId: string; tabId: string }]
  'tab-close': [payload: { paneId: string; tabId: string }]
  'tab-close-others': [payload: { paneId: string; tabId: string }]
  'tab-close-left': [payload: { paneId: string; tabId: string }]
  'tab-close-right': [payload: { paneId: string; tabId: string }]
  'tab-close-all': [payload: { paneId: string }]
  'tab-close-unpinned': [payload: { paneId: string }]
  'tab-pin': [payload: { paneId: string; tabId: string; pinned: boolean }]
  'tab-lock': [payload: { paneId: string; tabId: string }]
  'tab-move-to-other-pane': [payload: { paneId: string; tabId: string }]
  'tab-copy-link': [payload: { paneId: string; tabId: string }]
  'tab-reveal-in-explorer': [payload: { paneId: string; tabId: string }]
  'tab-reorder': [payload: { paneId: string; tabId: string; targetSlot: number }]
  'tab-drop': [payload: { paneId: string; tabId: string }]
  'create-note': [payload: { paneId: string }]
  'request-move-tab': [payload: { paneId: string; direction: 'next' | 'previous' }]
}>()

const EMPTY_STATUS: FileEditorStatus = { dirty: false, saving: false, saveError: '', inaccessible: false }

/** Number of pinned tabs, i.e. the boundary a drag may not cross. */
const pinnedCount = computed(() => props.pane.openTabs.filter((tab) => tab.pinned).length)

const tabs = computed(() => {
  const labels = props.pane.openTabs.map((tab) => tabLabel(tab))
  return props.pane.openTabs.map((tab, index) => {
    const status = tab.type === 'document' ? props.getStatus(tab.path) : EMPTY_STATUS
    const isProtected = tab.type === 'document' && protectedPaths.value.has(tab.path)
    const isLocked = isProtected && lockedPaths.value.has(tab.path)
    const inaccessible = Boolean(status.inaccessible)
    const marker = tabStateMarker(status)
    return {
      ...tab,
      title: labels[index],
      tooltip: tabTooltip(tab, labels[index], labels, {
        status,
        isProtected,
        isLocked,
        inaccessible
      }),
      dirty: status.dirty,
      saving: status.saving,
      saveError: status.saveError,
      inaccessible,
      protected: isProtected,
      locked: isLocked,
      protectionLabel: isProtected ? (isLocked ? 'Locked protected note' : 'Protected note, unlocked for this session') : '',
      stateMarker: marker.glyph,
      stateLabel: marker.label
    }
  })
})

const scrollRef = ref<HTMLElement | null>(null)
const hasOverflow = ref(false)
const canScrollBack = ref(false)
const canScrollForward = ref(false)
const tabListOpen = ref(false)

const paneTabIds = computed(() => props.pane.openTabs.map((tab) => tab.id))

/**
 * The single drop target for the strip.
 *
 * Tabs are draggable only. Two overlapping droppables (strip plus tab) raced
 * for the same drop, and the strip won: a same-pane reorder fell through to the
 * early return below and did nothing. One zone resolves both cases from the
 * hovered tab, which carries its own index and left/right placement.
 *
 * A drop on empty strip space is a no-op, so a tab dragged back onto itself
 * never jumps to the end of the strip.
 */
const stripDrop = makeDroppable(scrollRef, {
  events: {
    onDrop: (event) => {
      const draggedId = event.draggedItems?.[0]?.item
      if (typeof draggedId !== 'string') return
      if (!paneTabIds.value.includes(draggedId)) {
        emit('tab-drop', { paneId: props.pane.id, tabId: draggedId })
        return
      }
      const hovered = event.hoveredDraggable
      if (!hovered || hovered.index < 0) return
      const targetSlot = hovered.placement?.right ? hovered.index + 1 : hovered.index
      emit('tab-reorder', { paneId: props.pane.id, tabId: draggedId, targetSlot })
    }
  }
}, () => paneTabIds.value)

/**
 * Recomputes the overflow flags from the live scroll box.
 *
 * Only writes when a flag actually changes, so a `ResizeObserver` firing on
 * every frame cannot cause a render loop.
 */
function measureOverflow() {
  const element = scrollRef.value
  if (!element) return
  const overflow = element.scrollWidth > element.clientWidth + 1
  if (overflow !== hasOverflow.value) hasOverflow.value = overflow
  const back = overflow && element.scrollLeft > 1
  if (back !== canScrollBack.value) canScrollBack.value = back
  const forward = overflow && element.scrollLeft + element.clientWidth < element.scrollWidth - 1
  if (forward !== canScrollForward.value) canScrollForward.value = forward
}

function scrollStrip(direction: 'back' | 'forward') {
  const element = scrollRef.value
  if (!element) return
  const step = Math.max(120, Math.round(element.clientWidth * 0.7))
  element.scrollLeft += direction === 'forward' ? step : -step
  measureOverflow()
}

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
const contextMenuTab = computed(() => tabs.value[contextMenuTabIndex.value] ?? null)
const contextMenuTabPath = computed(() => {
  const tab = contextMenuTab.value
  return tab && (tab.type === 'document' || tab.type === 'file-inspector') ? tab.path : ''
})
const hasOtherPane = computed(() => (props.paneCount ?? 1) > 1)
const contextMenuPathInOtherPane = computed(() => {
  const path = contextMenuTabPath.value
  return Boolean(path) && (props.otherPanePaths ?? []).includes(path)
})
const contextMenuItems = computed(() => [
  {
    action: 'tab-pin' as const,
    label: contextMenuTab.value?.pinned ? 'Unpin Tab' : 'Pin Tab',
    disabled: false
  },
  {
    action: 'tab-move-to-other-pane' as const,
    label: 'Move to Other Pane',
    disabled: !hasOtherPane.value || contextMenuPathInOtherPane.value
  },
  {
    action: 'tab-copy-link' as const,
    label: 'Copy Note Link',
    disabled: !contextMenuTabPath.value
  },
  {
    action: 'tab-reveal-in-explorer' as const,
    label: 'Reveal in Explorer',
    disabled: !contextMenuTabPath.value
  },
  {
    action: 'tab-close' as const,
    label: 'Close',
    disabled: Boolean(contextMenuTab.value?.pinned)
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

/**
 * Picks the single transient marker a tab may show.
 *
 * Priority is failed save, then saving, then unsaved: a failed save is the only
 * one the user must not miss, and stacking markers makes the strip unreadable.
 */
function tabStateMarker(status: FileEditorStatus): { glyph: string; label: string } {
  if (status.saveError) return { glyph: '!', label: `Save failed: ${status.saveError}` }
  if (status.saving) return { glyph: '~', label: 'Saving' }
  if (status.dirty) return { glyph: '●', label: 'Unsaved changes' }
  return { glyph: '', label: '' }
}

/**
 * Builds the hover and focus tooltip: name, full path, then only the details
 * that the strip cannot show inline.
 */
function tabTooltip(
  tab: PaneTab,
  label: string,
  labels: string[],
  state: { status: FileEditorStatus; isProtected: boolean; isLocked: boolean; inaccessible: boolean }
): string {
  const lines = [label]
  const path = tabPath(tab)
  if (path) {
    lines.push(path.replace(/\\/g, '/').split('/').filter(Boolean).join(' / '))
  }
  if (hasHomonym(label, labels)) {
    lines.push(`Another open tab has the same name — this one is in ${tabFolder(tab) || 'the workspace root'}`)
  }
  if (tab.pinned) lines.push('Pinned')
  if (state.inaccessible) {
    lines.push('Cannot be read')
  } else if (state.isProtected) {
    lines.push(state.isLocked ? 'Locked protected note' : 'Protected note, unlocked for this session')
  }
  const marker = tabStateMarker(state.status)
  if (marker.label) lines.push(marker.label)
  return lines.join('\n')
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

type ContextMenuAction =
  | 'tab-pin'
  | 'tab-move-to-other-pane'
  | 'tab-copy-link'
  | 'tab-reveal-in-explorer'
  | 'tab-close'
  | 'tab-close-others'
  | 'tab-close-left'
  | 'tab-close-right'

function emitContextMenuAction(action: ContextMenuAction) {
  const tabId = contextMenuTabId.value
  if (!tabId) return
  const pinned = Boolean(contextMenuTab.value?.pinned)
  closeContextMenu()
  if (action === 'tab-pin') {
    emit('tab-pin', { paneId: props.pane.id, tabId, pinned: !pinned })
    return
  }
  if (action === 'tab-move-to-other-pane') {
    emit('tab-move-to-other-pane', { paneId: props.pane.id, tabId })
    return
  }
  if (action === 'tab-copy-link') {
    emit('tab-copy-link', { paneId: props.pane.id, tabId })
    return
  }
  if (action === 'tab-reveal-in-explorer') {
    emit('tab-reveal-in-explorer', { paneId: props.pane.id, tabId })
    return
  }
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

/** Stores the tab's root element so the active tab can be scrolled into view. */
function setTabRef(tabId: string, instance: unknown) {
  const element = (instance as { $el?: HTMLElement } | null)?.$el
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
  measureOverflow()
}

function toggleTabList() {
  tabListOpen.value = !tabListOpen.value
}

function closeTabList() {
  tabListOpen.value = false
}

function onTabListTabClick(payload: { tabId: string }) {
  closeTabList()
  selectTab(payload.tabId)
}

function onTabListCloseOthers(payload: { tabId: string }) {
  closeTabList()
  emit('tab-close-others', { paneId: props.pane.id, tabId: payload.tabId })
}

function onTabListCloseRight(payload: { tabId: string }) {
  closeTabList()
  emit('tab-close-right', { paneId: props.pane.id, tabId: payload.tabId })
}

function onTabListCloseUnpinned() {
  closeTabList()
  emit('tab-close-unpinned', { paneId: props.pane.id })
}

function onTabListCloseAll() {
  closeTabList()
  emit('tab-close-all', { paneId: props.pane.id })
}

/**
 * Closes a tab unless it is pinned.
 *
 * A pinned tab is only unpinned from its context menu, so neither the close
 * control nor a middle click can drop it by accident.
 */
function requestClose(tab: { id: string; pinned: boolean }) {
  if (tab.pinned) return
  emit('tab-close', { paneId: props.pane.id, tabId: tab.id })
}

function onTabAuxClick(tab: { id: string; pinned: boolean }, event: MouseEvent) {
  if (event.button !== 1) return
  event.preventDefault()
  closeContextMenu()
  requestClose(tab)
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

watch(() => props.pane.openTabs.length, () => { void nextTick(measureOverflow) })

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown, true)
  scrollRef.value?.addEventListener('scroll', measureOverflow, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && scrollRef.value) {
    resizeObserver = new ResizeObserver(measureOverflow)
    resizeObserver.observe(scrollRef.value)
  }
  void nextTick(measureOverflow)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  scrollRef.value?.removeEventListener('scroll', measureOverflow)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div
    ref="wrapRef"
    class="pane-tabs"
    :class="{ 'is-active-pane': isActivePane }"
    @mousedown="emit('pane-focus', { paneId: pane.id })"
  >
    <button
      v-if="hasOverflow"
      type="button"
      class="pane-tab-scroll"
      aria-label="Scroll tabs left"
      title="Scroll tabs left"
      :disabled="!canScrollBack"
      @click="scrollStrip('back')"
    >
      ‹
    </button>
    <div
      ref="scrollRef"
      class="pane-tabs-scroll"
      :class="{ 'is-drop-target': stripDrop.isDragOver.value }"
      @dblclick.self="emit('create-note', { paneId: pane.id })"
    >
      <EditorPaneTab
        v-for="(tab, index) in tabs"
        :key="tab.id"
        :ref="(element) => setTabRef(tab.id, element)"
        :tab="tab"
        :active="pane.activeTabId === tab.id"
        :index="index"
        :pinned-count="pinnedCount"
        :pane-tab-ids="paneTabIds"
        @select="selectTab(tab.id)"
        @close="requestClose(tab)"
        @lock="emit('tab-lock', { paneId: pane.id, tabId: tab.id })"
        @contextmenu="openContextMenu(tab.id, $event)"
        @auxclick="onTabAuxClick(tab, $event)"
      />
    </div>
    <button
      v-if="hasOverflow"
      type="button"
      class="pane-tab-scroll"
      aria-label="Scroll tabs right"
      title="Scroll tabs right"
      :disabled="!canScrollForward"
      @click="scrollStrip('forward')"
    >
      ›
    </button>
    <div class="pane-tabs-actions">
      <button
        type="button"
        class="pane-tab-action"
        aria-label="All open tabs"
        title="All open tabs"
        :aria-expanded="tabListOpen ? 'true' : 'false'"
        @click="toggleTabList"
      >
        <ChevronDownIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        class="pane-tab-action"
        aria-label="Move active tab to the previous pane"
        title="Move active tab to the previous pane"
        :disabled="!pane.activeTabId"
        @click="emit('request-move-tab', { paneId: pane.id, direction: 'previous' })"
      >
        <ArrowLeftIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        class="pane-tab-action"
        aria-label="Move active tab to the next pane"
        title="Move active tab to the next pane"
        :disabled="!pane.activeTabId"
        @click="emit('request-move-tab', { paneId: pane.id, direction: 'next' })"
      >
        <ArrowRightIcon aria-hidden="true" />
      </button>
    </div>
    <UiMenu v-if="tabListOpen" class-name="pane-tab-list-menu">
      <EditorPaneTabList
        :pane="pane"
        @tab-click="onTabListTabClick"
        @close-others="onTabListCloseOthers"
        @close-right="onTabListCloseRight"
        @close-unpinned="onTabListCloseUnpinned"
        @close-all="onTabListCloseAll"
        @dismiss="closeTabList"
      />
    </UiMenu>
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
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: 38px;
  border-bottom: 1px solid var(--tabbar-border);
  background: var(--tabbar-bg);
  font-size: 0.84rem;
  user-select: none;
  -webkit-user-select: none;
}

.pane-tab-scroll {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--tabbar-tab-text);
  padding: 0 0.2rem;
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}

.pane-tab-scroll:disabled {
  opacity: 0.35;
  cursor: default;
}

.pane-tab-list-menu {
  position: absolute;
  top: 100%;
  right: 0.3rem;
  z-index: 60;
}

/* The active pane is signalled on the strip, not on the active tab, so the two
   affordances never compete for the same pixels. The tint carries the light
   theme, the top accent carries the dark one. */
.pane-tabs.is-active-pane {
  background: var(--tabbar-tab-active-pane-bg);
  box-shadow: inset 0 2px 0 var(--tabbar-tab-active-indicator);
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

/* A tab dragged from another pane needs a visible landing zone. */
.pane-tabs-scroll.is-drop-target {
  box-shadow: inset 0 0 0 2px var(--tabbar-tab-active-indicator);
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

.pane-tab-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.pane-tab-action :deep(svg) {
  width: 0.85rem;
  height: 0.85rem;
}

.pane-tab-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


.pane-tab-menu {
  min-width: 220px;
}

.pane-tab-menu-item {
  justify-content: flex-start;
}
</style>
