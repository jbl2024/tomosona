<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  placeholder?: string
  disabled?: boolean
}>(), {
  placeholder: '',
  disabled: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const draft = ref('')

function normalizeTokens(tokens: string[]): string[] {
  return tokens
    .map((item) => item.trim())
    .filter(Boolean)
}

function nextTokens(input: string): string[] {
  return normalizeTokens(input.split(/[\n,]/g))
}

function commitDraft() {
  if (props.disabled) return
  const incoming = nextTokens(draft.value)
  if (!incoming.length) {
    draft.value = ''
    return
  }

  const existing = normalizeTokens(props.modelValue)
  const merged = [...existing]
  for (const token of incoming) {
    if (!merged.includes(token)) {
      merged.push(token)
    }
  }

  emit('update:modelValue', merged)
  draft.value = ''
}

function removeToken(index: number) {
  if (props.disabled) return
  const existing = normalizeTokens(props.modelValue)
  if (index < 0 || index >= existing.length) return
  existing.splice(index, 1)
  emit('update:modelValue', existing)
}

function onInput(event: Event) {
  const next = (event.target as HTMLInputElement | null)?.value ?? ''
  if (!next.includes(',')) {
    draft.value = next
    return
  }

  const segments = next.split(',')
  draft.value = segments.pop() ?? ''
  const committed = normalizeTokens(segments)
  if (!committed.length) return

  const existing = normalizeTokens(props.modelValue)
  const merged = [...existing]
  for (const token of committed) {
    if (!merged.includes(token)) merged.push(token)
  }
  emit('update:modelValue', merged)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === 'Tab' || event.key === ',') {
    event.preventDefault()
    commitDraft()
    return
  }

  if (event.key === 'Backspace' && !draft.value) {
    const existing = normalizeTokens(props.modelValue)
    if (!existing.length) return
    existing.pop()
    emit('update:modelValue', existing)
  }
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  if (!text) return
  if (!/[\n,]/.test(text)) return

  event.preventDefault()
  const incoming = nextTokens(text)
  if (!incoming.length) return

  const existing = normalizeTokens(props.modelValue)
  const merged = [...existing]
  for (const token of incoming) {
    if (!merged.includes(token)) merged.push(token)
  }
  emit('update:modelValue', merged)
}

watch(
  () => props.modelValue,
  () => {
    if (!props.modelValue.length && draft.value === ',') {
      draft.value = ''
    }
  }
)
</script>

<template>
  <div class="property-token-input">
    <span
      v-for="(token, index) in modelValue"
      :key="`${token}-${index}`"
      class="token-pill"
    >
      <span>{{ token }}</span>
      <button
        type="button"
        class="token-remove"
        :disabled="disabled"
        @click="removeToken(index)"
      >
        ×
      </button>
    </span>
    <input
      :value="draft"
      :placeholder="placeholder"
      :disabled="disabled"
      class="token-editor"
      @input="onInput"
      @keydown="onKeydown"
      @blur="commitDraft"
      @paste="onPaste"
    />
  </div>
</template>

<style>
.property-token-input {
  display: flex;
  min-height: 2rem;
  width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.5rem;
  background: var(--input-bg);
}

.property-token-input .token-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: var(--radius-pill);
  padding: 0.125rem 0.5rem;
  font-size: var(--font-size-sm);
  line-height: 1rem;
  background: var(--surface-muted);
  color: var(--text-main);
}

.property-token-input .token-remove {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 0.875rem;
  line-height: 1;
  color: inherit;
  cursor: pointer;
}

.property-token-input .token-editor {
  min-width: 8rem;
  flex: 1;
  border: 0;
  outline: none;
  font-size: var(--font-size-sm);
  line-height: 1rem;
  background: transparent;
  color: var(--input-text);
}
</style>
