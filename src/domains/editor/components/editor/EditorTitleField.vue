<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  disabled?: boolean
  placeholder?: string
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  commit: []
  'focus-body-request': []
}>()

const rootEl = ref<HTMLElement | null>(null)
const isFocused = ref(false)

watch(
  () => props.modelValue,
  (value) => {
    if (isFocused.value) return
    if (rootEl.value && rootEl.value.textContent !== value) {
      rootEl.value.textContent = value
    }
  },
  { immediate: true }
)

const placeholderText = computed(() => props.placeholder ?? 'Untitled')

onMounted(() => {
  if (rootEl.value && rootEl.value.textContent !== props.modelValue) {
    rootEl.value.textContent = props.modelValue
  }
})

function readContent() {
  return (rootEl.value?.textContent ?? '').replace(/\u00a0/g, ' ')
}

function emitCurrentValue() {
  const next = readContent()
  emit('update:modelValue', next)
}

function onInput() {
  emitCurrentValue()
}

function onFocus() {
  isFocused.value = true
}

function onBlur() {
  isFocused.value = false
  emitCurrentValue()
  emit('commit')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    rootEl.value?.blur()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    if (rootEl.value) rootEl.value.textContent = props.modelValue
    rootEl.value?.blur()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    emit('focus-body-request')
  }
}
</script>

<template>
  <h1
    ref="rootEl"
    class="editor-title-field"
    :class="{ 'editor-title-field--saving': props.saving }"
    :contenteditable="props.disabled ? 'false' : 'true'"
    :data-placeholder="placeholderText"
    spellcheck="false"
    @focus="onFocus"
    @input="onInput"
    @blur="onBlur"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.editor-title-field {
  font-size: calc(var(--editor-heading-1-size) * var(--editor-zoom, 1));
  font-weight: 580;
  line-height: 1.35;
  margin: 0 0 0.38rem;
  color: var(--text-main);
  outline: none;
}

.editor-title-field:empty::before {
  content: attr(data-placeholder);
  color: var(--text-dim);
}

.editor-title-field--saving {
  opacity: 0.92;
}
</style>
