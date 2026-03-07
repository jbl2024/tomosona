<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps<{
  node: { attrs: { text?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
}>()

const text = computed(() => String(props.node.attrs.text ?? ''))
const textareaEl = ref<HTMLTextAreaElement | null>(null)

function onInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement | null)?.value ?? ''
  props.updateAttributes({ text: value })
}

onMounted(() => {
  if (!props.editor.isEditable) return
  if (text.value.trim().length > 0) return
  void nextTick().then(() => {
    const textarea = textareaEl.value
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(0, 0)
  })
})
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
      spellcheck="false"
      placeholder="Quote text"
      @input="onInput"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-quote-source {
  caret-color: var(--editor-textarea-caret);
}
</style>
