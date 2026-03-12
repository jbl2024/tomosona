<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps<{
  node: { attrs: { text?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
}>()

const text = computed(() => String(props.node.attrs.text ?? ''))
const textareaEl = ref<HTMLTextAreaElement | null>(null)

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
  props.updateAttributes({ text: value })
}

onMounted(() => {
  scheduleAutosize()
})

watch(text, () => {
  scheduleAutosize()
}, { flush: 'post' })
</script>

<template>
  <NodeViewWrapper class="tomosona-quote is-editing">
    <div class="tomosona-quote-preview">
      <blockquote class="tomosona-quote-preview-content">
        <p class="tomosona-quote-paragraph" v-for="(line, idx) in text.split('\n')" :key="idx">{{ line }}</p>
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
      @focus="scheduleAutosize"
      @input="onInput"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-quote-source {
  caret-color: var(--editor-textarea-caret);
}
</style>
