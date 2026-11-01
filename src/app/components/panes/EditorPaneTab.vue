<script setup lang="ts">
import { computed, ref } from 'vue'
import { makeDraggable } from '@vue-dnd-kit/core'
import {
  BookmarkIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LockClosedIcon,
  LockOpenIcon
} from '@heroicons/vue/24/outline'
import type { PaneTab } from '../../composables/useMultiPaneWorkspaceState'

/**
 * Module: EditorPaneTab
 *
 * Purpose:
 * - Render one tab and own its drag registration.
 *
 * Boundaries:
 * - Presentation and gesture only. Every mutation is emitted to the strip,
 *   which forwards it to the shell.
 * - Drag registration lives here because `makeDraggable` needs one element ref
 *   per component instance. The tab is draggable only: the strip owns the one
 *   drop target, so a drop is resolved in a single place instead of racing two
 *   overlapping droppables.
 */

/** Presentation state resolved by the strip for a single tab. */
export type EditorPaneTabView = PaneTab & {
  title: string
  tooltip: string
  inaccessible: boolean
  protected: boolean
  locked: boolean
  protectionLabel: string
  stateMarker: string
  stateLabel: string
}

const props = defineProps<{
  tab: EditorPaneTabView
  active: boolean
  index: number
  /** Number of pinned tabs, i.e. the boundary a drag may not cross. */
  pinnedCount: number
  /** Tab ids of this pane, published as the drag payload for the strip. */
  paneTabIds: string[]
}>()

const emit = defineEmits<{
  select: []
  close: []
  contextmenu: [event: MouseEvent]
  auxclick: [event: MouseEvent]
}>()

const rootRef = ref<HTMLElement | null>(null)
const dragging = ref(false)

const icon = computed(() => (props.tab.type === 'file-inspector' ? DocumentIcon : null))

// The payload is `[index, items]`, the shape the library needs to resolve both
// the dragged tab and the tab under the cursor when the strip handles the drop.
makeDraggable(rootRef, {
  activation: {
    distance: {
      x: 6,
      y: 6,
      condition: 'both'
    }
  },
  events: {
    onSelfDragStart: () => { dragging.value = true },
    onSelfDragEnd: () => { dragging.value = false }
  }
}, () => [props.index, props.paneTabIds])
</script>

<template>
  <div
    ref="rootRef"
    role="button"
    tabindex="0"
    class="pane-tab-item"
    :class="{ active, dragging }"
    :title="tab.tooltip"
    :aria-label="tab.tooltip"
    :data-tab-id="tab.id"
    @click="emit('select')"
    @contextmenu.prevent="emit('contextmenu', $event)"
    @auxclick.stop="emit('auxclick', $event)"
    @keydown.enter.prevent="emit('select')"
    @keydown.space.prevent="emit('select')"
  >
    <span v-if="tab.type === 'home'" class="pane-tab-icon pane-tab-icon--hero">
      <HomeIcon />
    </span>
    <span v-else-if="icon" class="pane-tab-icon pane-tab-icon--hero">
      <component :is="icon" />
    </span>
    <span v-if="tab.pinned" class="pane-tab-flag pane-tab-pin" title="Pinned" aria-label="Pinned">
      <BookmarkIcon class="h-4 w-4" />
    </span>
    <span class="pane-tab-name">{{ tab.title }}</span>
    <span
      v-if="tab.inaccessible"
      class="pane-tab-flag"
      title="Cannot be read"
      aria-label="Cannot be read"
    >
      <ExclamationTriangleIcon class="h-4 w-4" />
    </span>
    <span
      v-else-if="tab.protected"
      class="pane-tab-flag"
      :title="tab.protectionLabel"
      :aria-label="tab.protectionLabel"
    >
      <LockClosedIcon v-if="tab.locked" class="h-4 w-4" />
      <LockOpenIcon v-else class="h-4 w-4" />
    </span>
    <span v-if="tab.stateMarker" class="pane-tab-state" :title="tab.stateLabel" :aria-label="tab.stateLabel">
      {{ tab.stateMarker }}
    </span>
    <button
      type="button"
      class="pane-tab-close"
      :aria-label="tab.pinned ? 'Pinned tab, unpin from the context menu' : 'Close tab'"
      :data-close-visible="active ? 'true' : 'false'"
      :disabled="tab.pinned"
      @click.stop="emit('close')"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
/* The strip stretches every tab to its own height. The top margin keeps the
   active tab's background block shorter than the bar, so it does not read as
   taller than the inactive tabs, while the bottom edge stays flush with the
   strip border the accent sits on. */
.pane-tab-item {
  min-width: 130px;
  max-width: 240px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 4px;
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
  box-shadow: inset 0 -2px 0 var(--tabbar-tab-active-indicator);
}

.pane-tab-item.dragging {
  opacity: 0.55;
}

.pane-tab-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.pane-tab-item.active .pane-tab-name {
  font-weight: 600;
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

.pane-tab-flag {
  display: inline-flex;
  align-items: center;
  flex: none;
  opacity: 0.8;
}

.pane-tab-pin {
  opacity: 0.9;
}

.pane-tab-state {
  flex: none;
  font-size: 0.7rem;
  opacity: 0.75;
}

/* The slot is always reserved: only its visibility changes, so revealing the
   control never shifts the title. */
.pane-tab-close {
  flex: none;
  width: 1.1rem;
  height: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
}

.pane-tab-item.active .pane-tab-close,
.pane-tab-item:hover .pane-tab-close,
.pane-tab-item:focus-within .pane-tab-close {
  opacity: 0.75;
  pointer-events: auto;
}

.pane-tab-close:hover:not(:disabled) {
  opacity: 1;
  background: color-mix(in srgb, currentColor 14%, transparent);
}

.pane-tab-close:disabled {
  cursor: default;
}
</style>
