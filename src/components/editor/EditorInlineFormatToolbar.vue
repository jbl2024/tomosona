<script setup lang="ts">
import { CodeBracketIcon, LinkIcon } from '@heroicons/vue/24/outline'
import { nextTick, ref, watch } from 'vue'
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
 *
 * Important:
 * - Buttons use `@mousedown.prevent` to avoid collapsing editor selection.
 * - Link input emits on Enter/Escape for keyboard-only flows.
 */
const props = defineProps<{
  open: boolean
  left: number
  top: number
  activeMarks: Record<InlineFormatMarkOrLink, boolean>
  linkPopoverOpen: boolean
  linkValue: string
  linkError: string
}>()

const emit = defineEmits<{
  'toggle-mark': [mark: InlineFormatMark]
  'open-link': []
  'wrap-wikilink': []
  'copy-as': [format: 'markdown' | 'html' | 'plain']
  'open-pulse': []
  'apply-link': []
  unlink: []
  'cancel-link': []
  'update:linkValue': [value: string]
}>()

const linkInputEl = ref<HTMLInputElement | null>(null)
const copyMenuOpen = ref(false)

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
    if (!open) copyMenuOpen.value = false
  }
)

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
</script>

<template>
  <div
    v-if="open"
    class="inline-format-toolbar absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border p-1"
    :style="{ left: `${left}px`, top: `${top}px` }"
  >
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="bold"
      :class="activeMarks.bold ? 'inline-format-toolbar-btn--active bg-slate-200' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'bold')"
    >
      B
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs italic transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="italic"
      :class="activeMarks.italic ? 'inline-format-toolbar-btn--active bg-slate-200' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'italic')"
    >
      I
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs line-through transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="strike"
      :class="activeMarks.strike ? 'inline-format-toolbar-btn--active bg-slate-200' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'strike')"
    >
      S
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs underline transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="underline"
      :class="activeMarks.underline ? 'inline-format-toolbar-btn--active bg-slate-200' : ''"
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
      :class="activeMarks.code ? 'inline-format-toolbar-btn--active bg-slate-200' : ''"
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
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-semibold transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="pulse"
      title="Pulse selection"
      @mousedown.prevent
      @click="emit('open-pulse')"
    >
      Pulse
    </button>
    <button
      type="button"
      class="inline-format-toolbar-btn inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 active:translate-y-px active:scale-[0.98]"
      data-action="link"
      aria-label="Link"
      title="Link"
      :class="activeMarks.link ? 'inline-format-toolbar-btn--active bg-slate-200' : ''"
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
        aria-label="Copy as"
        title="Copy as"
        @mousedown.prevent
        @click="copyMenuOpen = !copyMenuOpen"
      >
        ...
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

    <div
      v-if="linkPopoverOpen"
      class="inline-format-toolbar-popover absolute left-1/2 top-full z-40 mt-2 w-72 -translate-x-1/2 rounded-md border p-2"
      @mousedown.stop
    >
      <input
        ref="linkInputEl"
        type="url"
        class="inline-format-toolbar-input w-full rounded border px-2 py-1 text-xs outline-none"
        placeholder="https://example.com"
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
