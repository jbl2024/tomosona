<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { inlineTextToHtml } from '../../../lib/markdownBlocks'
import { INLINE_TEXT_COMMAND_HANDLER } from '../../../lib/inlineTextCommands'

const props = defineProps<{
  node: { attrs: { text?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
  getPos?: () => number
}>()

const text = computed(() => String(props.node.attrs.text ?? ''))
const renderedText = computed(() => inlineTextToHtml(text.value).replace(/\n/g, '<br>'))
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const isEditing = ref(false)
let pendingTextUpdate: string | undefined
const inlineTextCommands = inject(INLINE_TEXT_COMMAND_HANDLER, null)

function commandInput(textarea: HTMLTextAreaElement) {
  return {
    element: textarea,
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
    getPos: props.getPos ?? (() => 0),
    setValue: (value: string) => props.updateAttributes({ text: value })
  }
}

function startEditing(event: Event) {
  if (!props.editor.isEditable || (event.target as Element | null)?.closest('a')) return
  event.preventDefault()
  isEditing.value = true
  void nextTick().then(() => textareaEl.value?.focus())
}

function autosizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  if (textarea.scrollHeight <= 0) {
    textarea.style.removeProperty('height')
    return
  }
  textarea.style.height = `${textarea.scrollHeight}px`
}

function scheduleAutosize() {
  void nextTick().then(() => {
    const requestRaf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16)
    requestRaf(() => {
      const textarea = textareaEl.value
      if (!textarea) return
      autosizeTextarea(textarea)
    })
  })
}

function onInput(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  if (textarea) autosizeTextarea(textarea)
  const value = textarea?.value ?? ''
  pendingTextUpdate = value
  props.updateAttributes({ text: value })
  if (textarea) inlineTextCommands?.onInput(commandInput(textarea))
}

function onFocus() {
  if (props.editor.isEditable) isEditing.value = true
  scheduleAutosize()
}

function onKeydown(event: KeyboardEvent) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  inlineTextCommands?.onKeydown(event, commandInput(textarea))
}

function onKeyup(event: KeyboardEvent) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  inlineTextCommands?.onInput(commandInput(textarea))
}

onMounted(() => {
  scheduleAutosize()
})

watch(text, (value) => {
  // A reused node view must not keep source mode when another note is loaded.
  if (value !== pendingTextUpdate) isEditing.value = false
  pendingTextUpdate = undefined
  scheduleAutosize()
}, { flush: 'post' })

watch(isEditing, (editing) => {
  // The textarea is hidden in preview mode, so measure it only after it opens.
  if (editing) scheduleAutosize()
}, { flush: 'post' })
</script>

<template>
  <NodeViewWrapper class="tomosona-quote" :class="{ 'is-editing': editor.isEditable && (isEditing || !text) }">
    <div
      class="tomosona-quote-preview"
      :tabindex="editor.isEditable ? 0 : undefined"
      :aria-label="editor.isEditable ? 'Edit quote' : undefined"
      @click.stop="startEditing"
      @keydown.enter="startEditing"
      @keydown.space="startEditing"
    >
      <blockquote class="tomosona-quote-preview-content">
        <p class="tomosona-quote-paragraph" v-html="renderedText"></p>
      </blockquote>
    </div>
    <textarea
      ref="textareaEl"
      class="tomosona-quote-source"
      :value="text"
      :readonly="!editor.isEditable"
      rows="1"
      spellcheck="false"
      placeholder="Quote text"
      aria-label="Quote Markdown"
      @focus="onFocus"
      @blur="isEditing = false; inlineTextCommands?.onBlur()"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="onKeyup"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-quote-source {
  caret-color: var(--editor-textarea-caret);
}
</style>
