<!--
  Compact document overview for the rich-text editor. It mirrors block geometry
  without duplicating editor content and owns scroll navigation within the holder.
-->
<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  editor: Editor | null
  scrollElement: HTMLElement | null
}>()

type MinimapLine = {
  topPercent: number
  width: number
  indent: number
  kind: 'text' | 'heading' | 'list' | 'code' | 'quote'
}

const lines = ref<MinimapLine[]>([])
const scrollTop = ref(0)
const scrollHeight = ref(1)
const clientHeight = ref(1)
let resizeObserver: ResizeObserver | null = null
let boundEditor: Editor | null = null
let boundScrollElement: HTMLElement | null = null

const viewportStyle = computed(() => ({
  top: `${(scrollTop.value / scrollHeight.value) * 100}%`,
  height: `${Math.min(100, (clientHeight.value / scrollHeight.value) * 100)}%`
}))
function syncScrollMetrics() {
  const element = props.scrollElement
  if (!element) return
  scrollTop.value = element.scrollTop
  scrollHeight.value = Math.max(1, element.scrollHeight)
  clientHeight.value = Math.max(1, element.clientHeight)
}

function rebuildLines() {
  const root = props.editor?.view.dom
  const scroller = props.scrollElement
  if (!root || !scroller) {
    lines.value = []
    return
  }

  const scrollerRect = scroller.getBoundingClientRect()
  const nextLines: MinimapLine[] = []
  const blockElements = Array.from(
    root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote')
  ).filter((element) => {
    // A blockquote owns nested paragraphs; rendering both would duplicate its preview.
    return element.tagName === 'BLOCKQUOTE' || !element.closest('blockquote')
  })

  blockElements.forEach((element) => {
    const rect = element.getBoundingClientRect()
    const textLength = (element.textContent ?? '').trim().length
    const documentTop = Math.max(0, rect.top - scrollerRect.top + scroller.scrollTop)
    const tag = element.tagName
    const kind: MinimapLine['kind'] = /^H[1-6]$/.test(tag)
      ? 'heading'
      : tag === 'LI'
        ? 'list'
        : tag === 'PRE'
          ? 'code'
          : tag === 'BLOCKQUOTE'
            ? 'quote'
            : 'text'
    const estimatedRows = Math.max(1, Math.min(8, Math.ceil(textLength / (kind === 'code' ? 54 : 72))))
    const visibleRows = Math.max(1, Math.min(estimatedRows, Math.round(rect.height / 18)))
    const indent = kind === 'list' ? 10 : kind === 'quote' ? 6 : 0

    for (let row = 0; row < visibleRows; row += 1) {
      const remaining = Math.max(8, textLength - row * 72)
      const naturalWidth = Math.min(100, Math.max(24, (Math.min(remaining, 72) / 72) * 100))
      nextLines.push({
        topPercent: ((documentTop + (row / visibleRows) * Math.max(4, rect.height)) / Math.max(1, scroller.scrollHeight)) * 100,
        width: row === visibleRows - 1 ? naturalWidth : Math.max(72, naturalWidth),
        indent,
        kind
      })
    }
  })
  lines.value = nextLines
  syncScrollMetrics()
}

function scrollFromPointer(event: PointerEvent) {
  const scroller = props.scrollElement
  const target = event.currentTarget as HTMLElement
  if (!scroller) return
  const ratio = Math.min(1, Math.max(0, (event.clientY - target.getBoundingClientRect().top) / target.clientHeight))
  scroller.scrollTo({ top: ratio * scroller.scrollHeight - scroller.clientHeight / 2, behavior: event.type === 'click' ? 'smooth' : 'auto' })
}

function onPointerDown(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  scrollFromPointer(event)
}

function onPointerMove(event: PointerEvent) {
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) scrollFromPointer(event)
}

function bind() {
  const editor = props.editor
  const scroller = props.scrollElement
  if (!editor || !scroller) return
  editor.on('update', rebuildLines)
  scroller.addEventListener('scroll', syncScrollMetrics, { passive: true })
  boundEditor = editor
  boundScrollElement = scroller
  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(rebuildLines)
  resizeObserver?.observe(scroller)
  void nextTick(rebuildLines)
}

function unbind() {
  boundEditor?.off('update', rebuildLines)
  boundScrollElement?.removeEventListener('scroll', syncScrollMetrics)
  boundEditor = null
  boundScrollElement = null
  resizeObserver?.disconnect()
  resizeObserver = null
}

watch(() => [props.editor, props.scrollElement], (_value, _oldValue, onCleanup) => {
  bind()
  onCleanup(unbind)
}, { immediate: true, flush: 'post' })

onBeforeUnmount(unbind)
</script>

<template>
  <div
    v-if="lines.length"
    class="editor-minimap"
    aria-label="Document minimap"
    role="scrollbar"
    aria-orientation="vertical"
    :aria-valuenow="Math.round(scrollTop)"
    :aria-valuemax="Math.max(0, Math.round(scrollHeight - clientHeight))"
    tabindex="0"
    @click="scrollFromPointer"
    @pointerdown.prevent="onPointerDown"
    @pointermove.prevent="onPointerMove"
  >
    <div class="editor-minimap-lines">
      <span
        v-for="(line, index) in lines"
        :key="index"
        class="editor-minimap-line"
        :class="`editor-minimap-line--${line.kind}`"
        :style="{ top: `${line.topPercent}%`, right: `${line.indent}px`, width: `calc(${line.width}% - ${line.indent}px)` }"
      />
    </div>
    <span class="editor-minimap-viewport" :style="viewportStyle" />
  </div>
</template>

<style scoped>
.editor-minimap {
  position: absolute;
  z-index: 8;
  top: 8px;
  right: 4px;
  bottom: 8px;
  width: 112px;
  overflow: hidden;
  border-left: 1px solid color-mix(in srgb, var(--border-subtle) 65%, transparent);
  background: color-mix(in srgb, var(--surface-bg) 94%, var(--surface-muted));
  cursor: pointer;
  user-select: none;
}

.editor-minimap-lines {
  position: absolute;
  inset: 3px 8px;
}

.editor-minimap-line {
  position: absolute;
  right: 0;
  height: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--text-main) 52%, transparent);
}

.editor-minimap-line--heading {
  height: 4px;
  background: color-mix(in srgb, var(--accent) 78%, var(--text-main));
}

.editor-minimap-line--list::before {
  position: absolute;
  left: -6px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  content: '';
}

.editor-minimap-line--code {
  background: color-mix(in srgb, var(--accent) 52%, var(--text-dim));
}

.editor-minimap-line--quote {
  border-left: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
}

.editor-minimap-viewport {
  position: absolute;
  right: 0;
  left: 0;
  min-height: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 48%, transparent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  pointer-events: none;
}
</style>
