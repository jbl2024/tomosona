<!--
  Document ruler for structural and editorial navigation. It owns viewport
  mapping and pointer navigation, but leaves signal extraction in editorSignals.
-->
<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  assignEditorSignalLanes,
  buildEditorSignalSummary,
  collectEditorHeadingRanges,
  collectEditorSignalRanges,
  type EditorHeadingRange,
  type EditorSignalDirection,
  type EditorSignalKind,
  type EditorSignalRange,
  type PositionedEditorSignal
} from '../../lib/editorSignals'
import {
  getEditorFindState,
  setEditorFindActiveMatch,
  stepEditorFindMatch
} from '../../lib/tiptap/extensions/EditorFind'

const props = defineProps<{
  editor: Editor | null
  path: string
  scrollElement: HTMLElement | null
  visible: boolean
  spellcheckEnabled: boolean
}>()

const emit = defineEmits<{
  'signal-summary': [summary: ReturnType<typeof buildEditorSignalSummary>]
}>()

type PositionedHeading = EditorHeadingRange & { topPercent: number }

const headings = ref<PositionedHeading[]>([])
const signals = ref<PositionedEditorSignal[]>([])
const scrollTop = ref(0)
const scrollHeight = ref(1)
const clientHeight = ref(1)
let resizeObserver: ResizeObserver | null = null
let boundEditor: Editor | null = null
let boundScrollElement: HTMLElement | null = null
let rebuildFrame = 0
let dragPointerId: number | null = null
let dragOffset = 0

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

function positionPercent(from: number): number {
  const editor = props.editor
  const scroller = props.scrollElement
  if (!editor || !scroller) return 0
  try {
    const coordinates = editor.view.coordsAtPos(Math.max(0, Math.min(from, editor.state.doc.content.size)))
    const scrollerRect = scroller.getBoundingClientRect()
    const documentTop = coordinates.top - scrollerRect.top + scroller.scrollTop
    return Math.min(100, Math.max(0, (documentTop / Math.max(1, scroller.scrollHeight)) * 100))
  } catch {
    return 0
  }
}

function rebuildMarkers() {
  const editor = props.editor
  if (!editor) {
    headings.value = []
    signals.value = []
    emit('signal-summary', buildEditorSignalSummary(props.path, [], {
      spellcheckEnabled: props.spellcheckEnabled,
      findActive: false
    }))
    return
  }

  const nextSignals = collectEditorSignalRanges(editor)
  headings.value = collectEditorHeadingRanges(editor).map((heading) => ({
    ...heading,
    topPercent: positionPercent(heading.from)
  }))
  signals.value = assignEditorSignalLanes(nextSignals.map((signal) => ({
    ...signal,
    topPercent: positionPercent(signal.from)
  })))
  syncScrollMetrics()
  emit('signal-summary', buildEditorSignalSummary(props.path, nextSignals, {
    spellcheckEnabled: props.spellcheckEnabled,
    findActive: Boolean(getEditorFindState(editor).query)
  }))
}

function scheduleRebuild() {
  if (typeof window === 'undefined') {
    rebuildMarkers()
    return
  }
  window.cancelAnimationFrame(rebuildFrame)
  rebuildFrame = window.requestAnimationFrame(rebuildMarkers)
}

function scrollToTop(top: number) {
  props.scrollElement?.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
}

function scrollFromPointer(event: PointerEvent, offset = 0) {
  const scroller = props.scrollElement
  const target = event.currentTarget as HTMLElement
  if (!scroller || !target.clientHeight) return
  const ratio = Math.min(1, Math.max(0, (event.clientY - target.getBoundingClientRect().top - offset) / target.clientHeight))
  scrollToTop(ratio * scroller.scrollHeight - scroller.clientHeight / 2)
}

function onPointerDown(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragPointerId = event.pointerId
  const viewport = (event.target as HTMLElement).closest<HTMLElement>('.editor-ruler-viewport')
  if (viewport) {
    dragOffset = event.clientY - viewport.getBoundingClientRect().top - viewport.clientHeight / 2
    return
  }
  dragOffset = 0
  scrollFromPointer(event)
}

function onPointerMove(event: PointerEvent) {
  if (dragPointerId !== event.pointerId) return
  scrollFromPointer(event, dragOffset)
}

function onPointerEnd(event: PointerEvent) {
  if (dragPointerId !== event.pointerId) return
  dragPointerId = null
  dragOffset = 0
}

function scrollRangeIntoView(range: Pick<EditorSignalRange, 'from' | 'to'>, options?: { focus?: boolean }) {
  const editor = props.editor
  const scroller = props.scrollElement
  if (!editor || !scroller) return
  try {
    const start = editor.view.coordsAtPos(range.from)
    const end = editor.view.coordsAtPos(range.to)
    const scrollerRect = scroller.getBoundingClientRect()
    const documentTop = Math.min(start.top, end.top) - scrollerRect.top + scroller.scrollTop
    scrollToTop(documentTop - scroller.clientHeight / 2)
    if (options?.focus) editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).run()
  } catch {
    // Stale marker positions are rebuilt on the next editor transaction.
  }
}

function activateSignal(signal: PositionedEditorSignal) {
  if (signal.kind === 'find') {
    const matchIndex = getEditorFindState(props.editor).matches.findIndex((match) => match.from === signal.from && match.to === signal.to)
    if (matchIndex >= 0) setEditorFindActiveMatch(props.editor, matchIndex)
  }
  scrollRangeIntoView(signal, { focus: signal.kind !== 'find' })
}

function activateHeading(heading: PositionedHeading) {
  scrollRangeIntoView(heading)
}

function navigateSignal(kind: EditorSignalKind, direction: EditorSignalDirection) {
  const editor = props.editor
  const available = signals.value.filter((signal) => signal.kind === kind).sort((left, right) => left.from - right.from)
  if (!editor || !available.length) return

  if (kind === 'find') {
    const findState = stepEditorFindMatch(editor, direction)
    const match = findState.activeIndex >= 0 ? findState.matches[findState.activeIndex] : null
    if (match) scrollRangeIntoView(match)
    return
  }

  const cursor = editor.state.selection.from
  const target = direction > 0
    ? available.find((signal) => signal.from > cursor) ?? available[0]
    : [...available].reverse().find((signal) => signal.from < cursor) ?? available[available.length - 1]
  activateSignal(target)
}

function onKeydown(event: KeyboardEvent) {
  const scroller = props.scrollElement
  if (!scroller) return
  const steps: Partial<Record<string, number>> = {
    ArrowUp: -Math.max(24, scroller.clientHeight * 0.08),
    ArrowDown: Math.max(24, scroller.clientHeight * 0.08),
    PageUp: -scroller.clientHeight,
    PageDown: scroller.clientHeight
  }
  if (event.key === 'Home') scrollToTop(0)
  else if (event.key === 'End') scrollToTop(scroller.scrollHeight)
  else if (steps[event.key] !== undefined) scrollToTop(scroller.scrollTop + (steps[event.key] ?? 0))
  else return
  event.preventDefault()
}

function bind() {
  const editor = props.editor
  const scroller = props.scrollElement
  if (!editor || !scroller) return
  editor.on('transaction', scheduleRebuild)
  scroller.addEventListener('scroll', syncScrollMetrics, { passive: true })
  boundEditor = editor
  boundScrollElement = scroller
  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleRebuild)
  resizeObserver?.observe(scroller)
  void nextTick(scheduleRebuild)
}

function unbind() {
  boundEditor?.off('transaction', scheduleRebuild)
  boundScrollElement?.removeEventListener('scroll', syncScrollMetrics)
  boundEditor = null
  boundScrollElement = null
  resizeObserver?.disconnect()
  resizeObserver = null
  if (typeof window !== 'undefined') window.cancelAnimationFrame(rebuildFrame)
}

watch(() => [props.editor, props.scrollElement], (_value, _oldValue, onCleanup) => {
  bind()
  onCleanup(unbind)
}, { immediate: true, flush: 'post' })

watch(() => [props.path, props.spellcheckEnabled], scheduleRebuild)

onBeforeUnmount(unbind)

defineExpose({ navigateSignal })
</script>

<template>
  <div
    v-show="visible"
    class="editor-ruler"
    aria-label="Document navigation ruler"
    role="scrollbar"
    aria-orientation="vertical"
    :aria-valuenow="Math.round(scrollTop)"
    :aria-valuemax="Math.max(0, Math.round(scrollHeight - clientHeight))"
    tabindex="0"
    @pointerdown.prevent="onPointerDown"
    @pointermove.prevent="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @keydown="onKeydown"
  >
    <button
      v-for="(heading, index) in headings"
      :key="`heading:${heading.from}:${index}`"
      type="button"
      class="editor-ruler-heading"
      :class="`editor-ruler-heading--h${heading.level}`"
      :style="{ top: `${heading.topPercent}%` }"
      :title="heading.text || `Heading level ${heading.level}`"
      :aria-label="`Go to heading: ${heading.text || `level ${heading.level}`}`"
      @pointerdown.stop
      @click.stop="activateHeading(heading)"
    />
    <button
      v-for="(signal, index) in signals"
      :key="`${signal.kind}:${signal.from}:${signal.to}:${index}`"
      type="button"
      class="editor-ruler-signal"
      :class="`editor-ruler-signal--${signal.kind}`"
      :style="{
        top: `calc(${signal.topPercent}% + ${signal.overflowOffset}px)`,
        right: `${2 + signal.lane * 3}px`
      }"
      :title="signal.kind === 'spellcheck' ? 'Spelling issue' : signal.kind === 'find' ? 'Search result' : 'Link'"
      :aria-label="signal.kind === 'spellcheck' ? 'Go to spelling issue' : signal.kind === 'find' ? 'Go to search result' : 'Go to link'"
      @pointerdown.stop
      @click.stop="activateSignal(signal)"
    />
    <span class="editor-ruler-viewport" :style="viewportStyle" aria-hidden="true" />
  </div>
</template>

<style scoped>
.editor-ruler {
  position: absolute;
  z-index: 8;
  top: 8px;
  right: 2px;
  bottom: 8px;
  width: 24px;
  border-left: 1px solid color-mix(in srgb, var(--border-subtle) 62%, transparent);
  background: color-mix(in srgb, var(--surface-bg) 96%, var(--surface-muted));
  cursor: pointer;
  user-select: none;
  touch-action: none;
}

.editor-ruler:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 52%, transparent);
  outline-offset: -2px;
}

.editor-ruler-heading,
.editor-ruler-signal {
  position: absolute;
  z-index: 2;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
  transform: translateY(-50%);
}

.editor-ruler-heading {
  left: 2px;
  height: 2px;
  background: color-mix(in srgb, var(--text-dim) 74%, transparent);
}

.editor-ruler-heading--h1 { width: 9px; }
.editor-ruler-heading--h2 { width: 7px; }
.editor-ruler-heading--h3 { width: 5px; }

.editor-ruler-signal {
  width: 2px;
  height: 5px;
}

.editor-ruler-signal--spellcheck { background: var(--editor-signal-spellcheck); }
.editor-ruler-signal--find { background: var(--editor-signal-find); }
.editor-ruler-signal--link { background: var(--editor-signal-link); }

.editor-ruler-heading:hover,
.editor-ruler-heading:focus-visible,
.editor-ruler-signal:hover,
.editor-ruler-signal:focus-visible {
  z-index: 4;
  outline: 2px solid color-mix(in srgb, currentColor 48%, transparent);
  outline-offset: 1px;
}

.editor-ruler-viewport {
  position: absolute;
  z-index: 1;
  right: 0;
  left: 0;
  min-height: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  cursor: grab;
}

.editor-ruler:active .editor-ruler-viewport {
  cursor: grabbing;
}
</style>
