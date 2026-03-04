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
  'apply-link': []
  unlink: []
  'cancel-link': []
  'update:linkValue': [value: string]
}>()

const linkInputEl = ref<HTMLInputElement | null>(null)

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
</script>

<template>
  <div
    v-if="open"
    class="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
    :style="{ left: `${left}px`, top: `${top}px` }"
  >
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
      data-action="bold"
      :class="activeMarks.bold ? 'bg-slate-200 dark:bg-slate-700' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'bold')"
    >
      B
    </button>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs italic transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
      data-action="italic"
      :class="activeMarks.italic ? 'bg-slate-200 dark:bg-slate-700' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'italic')"
    >
      I
    </button>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs line-through transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
      data-action="strike"
      :class="activeMarks.strike ? 'bg-slate-200 dark:bg-slate-700' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'strike')"
    >
      S
    </button>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs underline transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
      data-action="underline"
      :class="activeMarks.underline ? 'bg-slate-200 dark:bg-slate-700' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'underline')"
    >
      U
    </button>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
      data-action="code"
      aria-label="Code"
      title="Code"
      :class="activeMarks.code ? 'bg-slate-200 dark:bg-slate-700' : ''"
      @mousedown.prevent
      @click="emit('toggle-mark', 'code')"
    >
      <CodeBracketIcon class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-mono transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
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
      class="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px active:scale-[0.98] active:bg-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700"
      data-action="link"
      aria-label="Link"
      title="Link"
      :class="activeMarks.link ? 'bg-slate-200 dark:bg-slate-700' : ''"
      @mousedown.prevent
      @click="emit('open-link')"
    >
      <LinkIcon class="h-4 w-4" />
    </button>

    <div
      v-if="linkPopoverOpen"
      class="absolute left-1/2 top-full z-40 mt-2 w-72 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      @mousedown.stop
    >
      <input
        ref="linkInputEl"
        type="url"
        class="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        placeholder="https://example.com"
        :value="linkValue"
        data-testid="link-input"
        @input="emit('update:linkValue', ($event.target as HTMLInputElement).value)"
        @keydown="onLinkInputKeydown"
      >
      <p v-if="linkError" class="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{{ linkError }}</p>
      <div class="mt-2 flex justify-end gap-1">
        <button type="button" class="px-2 py-1 text-xs" data-action="cancel-link" @click="emit('cancel-link')">Cancel</button>
        <button type="button" class="px-2 py-1 text-xs" data-action="unlink" @click="emit('unlink')">Remove</button>
        <button type="button" class="px-2 py-1 text-xs font-semibold" data-action="apply-link" @click="emit('apply-link')">Apply</button>
      </div>
    </div>
  </div>
</template>
