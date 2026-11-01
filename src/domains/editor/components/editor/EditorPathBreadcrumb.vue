<script setup lang="ts">
/**
 * EditorPathBreadcrumb
 *
 * Purpose:
 * - Present the active document's location as navigable segments above the
 *   editor, so reaching the note's folder or its actions does not require
 *   hunting through the explorer.
 *
 * Boundaries:
 * - Never edits the path: renaming keeps its dedicated action so internal
 *   links stay safe.
 * - Owns no explorer or clipboard access. Navigation is delegated through
 *   `segment-action`, which the shell routes to its ports.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { toWorkspaceRelativePath } from '../../../explorer/lib/workspacePaths'
import {
  buildBreadcrumbSegments,
  condenseBreadcrumbSegments,
  type BreadcrumbSegment
} from '../../lib/breadcrumbSegments'

/**
 * `reveal-in-explorer` is navigation: it expands the tree to the segment.
 * `reveal-in-file-manager` is the native reveal, matching the explorer's own
 * context menu entry of the same name.
 */
export type BreadcrumbAction = 'reveal-in-explorer' | 'reveal-in-file-manager' | 'copy-link'

type MenuItem = { id: string; label: string; run: () => void }
type OpenMenu = { x: number; y: number; items: MenuItem[] }

const props = defineProps<{ path: string; workspacePath: string }>()
const emit = defineEmits<{
  'segment-action': [payload: { kind: 'folder' | 'document'; path: string; action: BreadcrumbAction }]
}>()

const rootRef = ref<HTMLElement | null>(null)
const overflow = ref(false)
const menu = ref<OpenMenu | null>(null)

const segments = computed(() => buildBreadcrumbSegments(props.workspacePath, props.path))
const relativePath = computed(
  () => toWorkspaceRelativePath(props.workspacePath, props.path) || props.path
)
const layout = computed(() =>
  overflow.value ? condenseBreadcrumbSegments(segments.value) : { visible: segments.value, hidden: [] }
)

let observer: ResizeObserver | null = null

/** Writes the overflow flag only when it flips, so the observer cannot loop. */
function measure() {
  const element = rootRef.value
  if (!element) return
  const next = element.scrollWidth > element.clientWidth + 1
  if (next !== overflow.value) overflow.value = next
}

function closeMenu() {
  menu.value = null
}

function openMenu(event: MouseEvent, items: MenuItem[]) {
  event.preventDefault()
  event.stopPropagation()
  menu.value = { x: event.clientX, y: event.clientY, items }
}

function runMenuItem(item: MenuItem) {
  menu.value = null
  item.run()
}

function revealInExplorer(segment: BreadcrumbSegment) {
  emit('segment-action', { kind: segment.kind, path: segment.path, action: 'reveal-in-explorer' })
}

function revealInFileManager(segment: BreadcrumbSegment): MenuItem {
  return {
    id: 'reveal-in-file-manager',
    label: 'Reveal in file manager',
    run: () => emit('segment-action', {
      kind: segment.kind,
      path: segment.path,
      action: 'reveal-in-file-manager'
    })
  }
}

function documentActions(segment: BreadcrumbSegment): MenuItem[] {
  return [
    revealInFileManager(segment),
    {
      id: 'copy-link',
      label: 'Copy note link',
      run: () => emit('segment-action', { kind: 'document', path: segment.path, action: 'copy-link' })
    }
  ]
}

/** A folder segment navigates straight away; the document segment offers its actions. */
function onSegmentClick(event: MouseEvent, segment: BreadcrumbSegment) {
  if (segment.kind === 'folder') {
    revealInExplorer(segment)
    return
  }
  openMenu(event, documentActions(segment))
}

function onSegmentContextMenu(event: MouseEvent, segment: BreadcrumbSegment) {
  openMenu(
    event,
    segment.kind === 'folder' ? [revealInFileManager(segment)] : documentActions(segment)
  )
}

/** Hidden segments are always folders: the document segment is never condensed. */
function onEllipsisClick(event: MouseEvent) {
  openMenu(
    event,
    layout.value.hidden.map((segment) => ({
      id: `hidden:${segment.path}`,
      label: segment.label,
      run: () => revealInExplorer(segment)
    }))
  )
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'function' && rootRef.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(rootRef.value)
  }
  window.addEventListener('click', closeMenu)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => props.path,
  async () => {
    closeMenu()
    await nextTick()
    measure()
  }
)
</script>

<template>
  <div
    v-if="path"
    ref="rootRef"
    class="editor-path"
    :title="relativePath"
    :aria-label="`File location: ${relativePath}`"
  >
    <template v-for="(segment, index) in layout.visible" :key="`${segment.kind}:${segment.path}`">
      <span v-if="index > 0" class="editor-path-separator" aria-hidden="true">›</span>
      <button
        type="button"
        class="editor-path-segment"
        :class="`editor-path-segment--${segment.kind}`"
        :data-segment-kind="segment.kind"
        :title="relativePath"
        @click="onSegmentClick($event, segment)"
        @contextmenu="onSegmentContextMenu($event, segment)"
      >{{ segment.label }}</button>
      <template v-if="overflow && layout.hidden.length && index === 0">
        <span class="editor-path-separator" aria-hidden="true">›</span>
        <button
          type="button"
          class="editor-path-segment editor-path-ellipsis"
          aria-label="Show hidden folders"
          title="Show hidden folders"
          @click="onEllipsisClick"
        >…</button>
      </template>
    </template>

    <ul
      v-if="menu"
      class="editor-path-menu"
      role="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
    >
      <li v-for="item in menu.items" :key="item.id" role="none">
        <button type="button" role="menuitem" class="editor-path-menu-item" @click="runMenuItem(item)">
          {{ item.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.editor-path {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  padding: .45rem 1rem;
  border-bottom: 1px solid var(--border-strong);
  color: var(--text-dim);
  font-size: .7rem;
  line-height: 1.35;
  white-space: nowrap;
}

.editor-path-segment {
  flex: 0 0 auto;
  max-width: 18ch;
  overflow: hidden;
  padding: 0 .15rem;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.editor-path-segment:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: var(--text);
}

.editor-path-segment:focus-visible {
  outline: 2px solid var(--input-focus-border);
  outline-offset: -2px;
}

.editor-path-segment--document {
  color: var(--text);
}

.editor-path-separator {
  flex: 0 0 auto;
  padding: 0 .25rem;
  color: var(--text-faint);
}

.editor-path-ellipsis {
  padding: 0 .3rem;
}

.editor-path-menu {
  position: fixed;
  z-index: 60;
  min-width: 12rem;
  margin: 0;
  padding: .25rem;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface-bg);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  list-style: none;
}

.editor-path-menu-item {
  display: block;
  width: 100%;
  padding: .3rem .5rem;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.editor-path-menu-item:hover {
  background: var(--surface-muted);
}
</style>
