<script setup lang="ts">
import { Bars3Icon, ClipboardDocumentIcon, CodeBracketIcon, LinkIcon } from '@heroicons/vue/24/outline'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorBlockMenu from './EditorBlockMenu.vue'
import type { BlockMenuActionItem } from '../../lib/tiptap/blockMenu/types'
import type { InlineFormatMark, InlineFormatMarkOrLink } from '../../composables/useInlineFormatToolbar'

/**
 * EditorInlineFormatToolbar
 *
 * Presentational component for inline formatting controls + link popover.
 * It intentionally owns no editor state; callers pass state via props and
 * handle mutations through emitted events.
 *
 * How to use:
 * - Bind `open/left/top` and active marks from `useInlineFormatToolbar`.
 * - Forward emitted events back to composable actions.
 * - Pass block menu actions from `useBlockMenuControls` to expose structural
 *   commands next to text selection actions.
 *
 * Important:
 * - Buttons use `@mousedown.prevent` to avoid collapsing editor selection.
 * - Link input emits on Enter/Escape for keyboard-only flows and accepts `#section` fragments.
 */
const props = defineProps<{
  open: boolean
  left: number
  top: number
  activeMarks: Record<InlineFormatMarkOrLink, boolean>
  blockMenuActions: BlockMenuActionItem[]
  blockMenuConvertActions: BlockMenuActionItem[]
  linkPopoverOpen: boolean
  linkValue: string
  linkError: string
}>()

const emit = defineEmits<{
  'toggle-mark': [mark: InlineFormatMark]
  'open-link': []
  'wrap-wikilink': []
  'extract-note': []
  'select-block-action': [item: BlockMenuActionItem]
  'copy-as': [format: 'markdown' | 'html' | 'plain']
  'apply-link': []
  unlink: []
  'cancel-link': []
  'measure': [{ height: number; width: number }]
  'update:linkValue': [value: string]
}>()

const toolbarEl = ref<HTMLDivElement | null>(null)
const linkInputEl = ref<HTMLInputElement | null>(null)
const blockMenuButtonEl = ref<HTMLButtonElement | null>(null)
const blockMenuLeft = ref(0)
const blockMenuTop = ref(0)
const copyMenuOpen = ref(false)
const blockMenuOpen = ref(false)
const blockMenuIndex = ref(0)
let toolbarResizeObserver: ResizeObserver | null = null

function reportToolbarHeight() {
  const rect = toolbarEl.value?.getBoundingClientRect()
  emit('measure', {
    height: rect?.height ?? 0,
    width: rect?.width ?? 0
  })
}

watch(
  () => props.linkPopoverOpen,
  (open) => {
    if (!open) return
    void nextTick(() => {
      linkInputEl.value?.focus()
      linkInputEl.value?.select()
    })
  }
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      copyMenuOpen.value = false
      blockMenuOpen.value = false
      emit('measure', { height: 0, width: 0 })
      return
    }
    void nextTick(() => {
      reportToolbarHeight()
      if (!toolbarEl.value || typeof ResizeObserver === 'undefined') return
      toolbarResizeObserver?.disconnect()
      toolbarResizeObserver = new ResizeObserver(() => {
        reportToolbarHeight()
      })
      toolbarResizeObserver.observe(toolbarEl.value)
    })
  }
)

watch(
  () => props.linkPopoverOpen,
  (open) => {
    if (!open) return
    copyMenuOpen.value = false
    blockMenuOpen.value = false
  }
)

function onViewportChange() {
  if (!blockMenuOpen.value) return
  positionBlockMenu()
}

onMounted(() => {
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  toolbarResizeObserver?.disconnect()
  toolbarResizeObserver = null
})

/**
 * Handles keyboard submit/cancel while editing URL.
 */
function onLinkInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    emit('apply-link')
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel-link')
  }
}

function onCopyAs(format: 'markdown' | 'html' | 'plain') {
  emit('copy-as', format)
  copyMenuOpen.value = false
}

function closeLinkPopoverIfOpen() {
  if (!props.linkPopoverOpen) return
  emit('cancel-link')
}

function onToggleCopyMenu() {
  if (copyMenuOpen.value) {
    copyMenuOpen.value = false
    return
  }

  blockMenuOpen.value = false
  closeLinkPopoverIfOpen()
  copyMenuOpen.value = true
}

function onToggleBlockMenu() {
  if (blockMenuOpen.value) {
    blockMenuOpen.value = false
    return
  }

  copyMenuOpen.value = false
  closeLinkPopoverIfOpen()
  blockMenuIndex.value = 0
  blockMenuOpen.value = true
  void nextTick(() => {
    positionBlockMenu()
  })
}

function positionBlockMenu() {
  const button = blockMenuButtonEl.value
  if (!button) return

  const viewportPadding = 8
  const menuWidth = 256
  const menuHeight = 360
  const rect = button.getBoundingClientRect()

  let left = rect.right - menuWidth
  if (left + menuWidth > window.innerWidth - viewportPadding) {
    left = window.innerWidth - menuWidth - viewportPadding
  }
  if (left < viewportPadding) {
    left = viewportPadding
  }

  let top = rect.bottom + 8
  if (top + menuHeight > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - menuHeight - 8)
  }

  blockMenuLeft.value = left
  blockMenuTop.value = top
}

function onSelectBlockAction(item: BlockMenuActionItem) {
  emit('select-block-action', item)
  blockMenuOpen.value = false
}
</script>

<template>
  <div
    ref="toolbarEl"
    v-if="open"
    class="inline-format-toolbar absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border p-1"
    :style="{ left: `${left}px`, top: `${top}px` }"
  >
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="bold"
      :class="activeMarks.bold ? 'inline-format-toolbar-btn--active' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'bold')"
    >
      B
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs italic transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="italic"
      :class="activeMarks.italic ? 'inline-format-toolbar-btn--active' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'italic')"
    >
      I
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs line-through transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="strike"
      :class="activeMarks.strike ? 'inline-format-toolbar-btn--active' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'strike')"
    >
      S
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs underline transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="underline"
      :class="activeMarks.underline ? 'inline-format-toolbar-btn--active' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'underline')"
    >
      U
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="code"
      aria-label="Code"
      title="Code"
      :class="activeMarks.code ? 'inline-format-toolbar-btn--active' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'code')"
    >
      <CodeBracketIcon class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-mono transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="wikilink"
      aria-label="Wikilink"
      title="Wikilink"
      @mousedown.prevent
      @click="emit('wrap-wikilink')"
    >
      [[ ]]
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="extract-note"
      aria-label="Extract selection into note"
      title="Extract selection into note"
      @mousedown.prevent
      @click="emit('extract-note')"
    >
      Note
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="link"
      aria-label="Link"
      title="Link"
      :class="activeMarks.link ? 'inline-format-toolbar-btn--active' : ''"
      @mousedown.prevent
      @click="emit('open-link')"
    >
      <LinkIcon class="h-4 w-4" />
    </button>
    <div class="relative">
      <button
        type="button"
        class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-semibold transition-all duration-150 active:translate-y-px active:scale-[0.98]"
        data-action="copy-menu-toggle"
        aria-label="Copy options"
        title="Copy options"
        @mousedown.prevent
        @click="onToggleCopyMenu"
      >
        <ClipboardDocumentIcon class="h-4 w-4" />
      </button>

      <div
        v-if="copyMenuOpen"
        class="inline-format-toolbar-popover absolute right-0 top-full z-40 mt-2 w-40 rounded-md border p-1"
        @mousedown.stop
      >
        <button
          type="button"
          class="inline-format-toolbar-menu-item block w-full rounded px-2 py-1 text-left text-xs"
          data-action="copy-as-markdown"
          @click="onCopyAs('markdown')"
        >
          Copy as Markdown
        </button>
        <button
          type="button"
          class="inline-format-toolbar-menu-item block w-full rounded px-2 py-1 text-left text-xs"
          data-action="copy-as-html"
          @click="onCopyAs('html')"
        >
          Copy as HTML
        </button>
        <button
          type="button"
          class="inline-format-toolbar-menu-item block w-full rounded px-2 py-1 text-left text-xs"
          data-action="copy-as-plain"
          @click="onCopyAs('plain')"
        >
          Copy as Plain text
        </button>
      </div>
    </div>

    <div class="relative">
      <button
        ref="blockMenuButtonEl"
        type="button"
        class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-semibold transition-all duration-150 active:translate-y-px active:scale-[0.98]"
        data-action="block-menu-toggle"
        aria-label="Block actions"
        title="Block actions"
        @mousedown.prevent
        @click="onToggleBlockMenu"
      >
        <Bars3Icon class="h-4 w-4" />
      </button>
      <Teleport to="body">
        <div
          v-if="blockMenuOpen"
          class="fixed z-50"
          :style="{ left: `${blockMenuLeft}px`, top: `${blockMenuTop}px` }"
        >
          <EditorBlockMenu
            :open="blockMenuOpen"
            :index="blockMenuIndex"
            :actions="blockMenuActions"
            :convert-actions="blockMenuConvertActions"
            @update:index="blockMenuIndex = $event"
            @select="onSelectBlockAction"
            @close="blockMenuOpen = false"
          />
        </div>
      </Teleport>
    </div>

    <div
      v-if="linkPopoverOpen"
      class="inline-format-toolbar-popover absolute left-1/2 top-full z-40 mt-2 w-72 -translate-x-1/2 rounded-md border p-2"
      @mousedown.stop
    >
      <input
        ref="linkInputEl"
        type="text"
        class="inline-format-toolbar-input w-full rounded border px-2 py-1 text-xs outline-none"
        placeholder="#ma-section or https://example.com"
        :value="linkValue"
        data-testid="link-input"
        @input="emit('update:linkValue', ($event.target as HTMLInputElement).value)"
        @keydown="onLinkInputKeydown"
      >
      <p v-if="linkError" class="inline-format-toolbar-error mt-1 text-[11px]">{{ linkError }}</p>
      <div class="mt-2 flex justify-end gap-1">
        <button type="button" class="inline-format-toolbar-text-btn px-2 py-1 text-xs" data-action="cancel-link" @click="emit('cancel-link')">Cancel</button>
        <button type="button" class="inline-format-toolbar-text-btn px-2 py-1 text-xs" data-action="unlink" @click="emit('unlink')">Remove</button>
        <button type="button" class="inline-format-toolbar-text-btn inline-format-toolbar-text-btn--strong px-2 py-1 text-xs font-semibold" data-action="apply-link" @click="emit('apply-link')">Apply</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inline-format-toolbar,
.inline-format-toolbar-popover {
  border-color: var(--editor-menu-border);
  background: var(--editor-menu-bg);
  box-shadow: var(--editor-menu-shadow);
}

.inline-format-toolbar {
  overflow: visible;
  width: 420px;
  min-width: 420px;
  max-width: 420px;
  box-sizing: border-box;
  justify-content: space-between;
}

.inline-format-toolbar-btn,
.inline-format-toolbar-menu-item,
.inline-format-toolbar-text-btn {
  color: var(--editor-menu-text);
}

.inline-format-toolbar-btn:hover,
.inline-format-toolbar-menu-item:hover,
.inline-format-toolbar-text-btn:hover {
  background: var(--editor-menu-hover-bg);
  color: var(--editor-menu-text-strong);
}

.inline-format-toolbar-btn:active {
  background: var(--editor-menu-active-bg);
}

.inline-format-toolbar-btn--active {
  background: var(--editor-menu-active-bg);
  color: var(--editor-menu-text-strong);
}

.inline-format-toolbar-input {
  border-color: var(--input-border);
  background: var(--input-bg);
  color: var(--input-text);
}

.inline-format-toolbar-input:focus {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 2px var(--input-focus-ring);
}

.inline-format-toolbar-error {
  color: var(--danger);
}

.inline-format-toolbar-text-btn--strong {
  color: var(--accent);
}
</style>
