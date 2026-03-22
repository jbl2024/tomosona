<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../shared/components/ui/UiFilterableDropdown.vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  placeholder?: string
  disabled?: boolean
  suggestions?: string[]
}>(), {
  placeholder: '',
  disabled: false,
  suggestions: () => []
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const draft = ref('')
const suggestionOpen = ref(false)
const suggestionQuery = ref('')
const suggestionActiveIndex = ref(0)

const normalizedSuggestions = computed(() => {
  const existing = new Set(normalizeTokens(props.modelValue).map((item) => item.toLowerCase()))
  const seen = new Set<string>()
  const out: string[] = []
  for (const suggestion of props.suggestions ?? []) {
    const trimmed = suggestion.trim()
    if (!trimmed) continue
    const normalized = trimmed.toLowerCase()
    if (existing.has(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(trimmed)
  }
  return out
})

const suggestionItems = computed<FilterableDropdownItem[]>(() =>
  normalizedSuggestions.value.map((suggestion) => ({
    id: `property-suggestion:${suggestion}`,
    label: suggestion
  }))
)

function normalizeTokens(tokens: string[]): string[] {
  return tokens
    .map((item) => item.trim())
    .filter(Boolean)
}

function nextTokens(input: string): string[] {
  return normalizeTokens(input.split(/[\n,]/g))
}

function openSuggestions(nextQuery = draft.value) {
  const query = nextQuery.trim()
  suggestionQuery.value = query
  suggestionOpen.value = normalizedSuggestions.value.length > 0
  suggestionActiveIndex.value = 0
}

function closeSuggestions() {
  suggestionOpen.value = false
  suggestionQuery.value = ''
  suggestionActiveIndex.value = 0
}

function commitDraft() {
  if (props.disabled) return
  const incoming = nextTokens(draft.value)
  if (!incoming.length) {
    draft.value = ''
    closeSuggestions()
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
  closeSuggestions()
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
    openSuggestions(next)
    return
  }

  const segments = next.split(',')
  draft.value = segments.pop() ?? ''
  openSuggestions(draft.value)
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
    if (!draft.value) {
      closeSuggestions()
    }
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

function onSuggestionSelect(item: FilterableDropdownItem) {
  const value = String(item.label ?? '').trim()
  if (!value) return

  const existing = normalizeTokens(props.modelValue)
  if (!existing.includes(value)) {
    emit('update:modelValue', [...existing, value])
  }
  draft.value = ''
  closeSuggestions()
}

function onTriggerFocus() {
  if (props.disabled) return
  openSuggestions()
}

watch(
  () => props.modelValue,
  () => {
    if (!props.modelValue.length && draft.value === ',') {
      draft.value = ''
    }
  }
)

watch(
  normalizedSuggestions,
  () => {
    if (suggestionOpen.value) {
      openSuggestions()
    }
  }
)
</script>

<template>
  <UiFilterableDropdown
    class="property-token-input"
    :items="suggestionItems"
    :model-value="suggestionOpen"
    :query="suggestionQuery"
    :active-index="suggestionActiveIndex"
    :show-filter="false"
    :auto-focus-on-open="false"
    :close-on-select="false"
    menu-mode="portal"
    menu-class="property-token-input-menu"
    :matcher="(item, query) => item.label.toLowerCase().startsWith(query)"
    @open-change="suggestionOpen = $event"
    @query-change="suggestionQuery = $event"
    @active-index-change="suggestionActiveIndex = $event"
    @select="onSuggestionSelect"
  >
    <template #trigger>
      <div class="property-token-input-trigger">
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
          autocomplete="off"
          class="token-editor"
          @focus="onTriggerFocus"
          @input="onInput"
          @keydown="onKeydown"
          @blur="commitDraft"
          @paste="onPaste"
        />
      </div>
    </template>
    <template #item="{ item }">
      <span class="property-token-input-suggestion">{{ item.label }}</span>
    </template>
    <template #empty>
      <span class="property-token-input-empty">No suggestions</span>
    </template>
  </UiFilterableDropdown>
</template>

<style>
.property-token-input {
  position: relative;
}

.property-token-input-trigger {
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

.property-token-input-menu {
  width: min(22rem, calc(100vw - 2rem));
}

.property-token-input-suggestion {
  display: block;
}

.property-token-input-empty {
  display: block;
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
