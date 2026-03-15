<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { common } from 'lowlight'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../../shared/components/ui/UiFilterableDropdown.vue'

const WRAP_STORAGE_KEY = 'tomosona:editor:code-wrap'
const WRAP_EVENT = 'tomosona:code-wrap-changed'

const languages = Object.keys(common).sort()
const LANGUAGE_ALIASES: Record<string, string[]> = {
  javascript: ['js', 'node', 'ecmascript'],
  typescript: ['ts'],
  python: ['py'],
  shell: ['sh', 'zsh'],
  cpp: ['c++'],
  csharp: ['c#', 'cs'],
  yaml: ['yml'],
  markdown: ['md'],
  plaintext: ['plain', 'plain text', 'text', 'txt', 'none']
}

const props = defineProps<{
  node: { textContent?: string; attrs: { language?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
}>()

const wrapEnabled = ref(true)
const showLangMenu = ref(false)
const languageQuery = ref('')
const activeLanguageIndex = ref(0)

const currentLanguage = computed(() => props.node.attrs.language ?? '')
const controlsVisible = computed(() => showLangMenu.value)
const codeClass = computed(() => ({
  hljs: true,
  [`language-${currentLanguage.value}`]: Boolean(currentLanguage.value)
}))
const languageItems = computed<Array<FilterableDropdownItem & { value: string; aliases: string[] }>>(() => {
  const options = new Set<string>(['', ...languages])
  const current = currentLanguage.value.trim()
  if (current) options.add(current)
  return Array.from(options).map((value) => ({
    id: `lang:${value || 'plain-text'}`,
    label: value || 'plain text',
    value,
    aliases: value ? (LANGUAGE_ALIASES[value] ?? []) : ['plaintext', 'plain', 'text', 'txt', 'none']
  }))
})

function syncWrapFromStorage() {
  wrapEnabled.value = window.localStorage.getItem(WRAP_STORAGE_KEY) !== '0'
}

function onWrapChanged(event: Event) {
  const custom = event as CustomEvent<{ enabled?: boolean }>
  const enabled = custom.detail?.enabled
  if (typeof enabled === 'boolean') {
    wrapEnabled.value = enabled
    return
  }
  syncWrapFromStorage()
}

function setWrapEnabled(next: boolean) {
  wrapEnabled.value = next
  window.localStorage.setItem(WRAP_STORAGE_KEY, next ? '1' : '0')
  window.dispatchEvent(new CustomEvent(WRAP_EVENT, { detail: { enabled: next } }))
}

function setLanguage(lang: string) {
  const next = (() => {
    const normalized = lang.trim().toLowerCase()
    if (!normalized) return ''
    if (languages.includes(normalized)) return normalized
    const aliasMatch = Object.entries(LANGUAGE_ALIASES)
      .find(([, aliases]) => aliases.includes(normalized))
    return aliasMatch?.[0] ?? ''
  })()
  props.updateAttributes({ language: next })
}

function onLanguageSelect(item: FilterableDropdownItem) {
  const value = String(item.value ?? '')
  setLanguage(value)
}

function languageMatcher(item: FilterableDropdownItem, query: string): boolean {
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry)) : []
  return [String(item.label), ...aliases].some((token) => token.toLowerCase().includes(query))
}

async function copyCode() {
  const value = String(props.node.textContent ?? '')
  await navigator.clipboard.writeText(value)
}

const preClass = computed(() => ({ 'tomosona-code-wrap-enabled': wrapEnabled.value }))

onMounted(() => {
  syncWrapFromStorage()
  window.addEventListener(WRAP_EVENT, onWrapChanged as EventListener)
})

onBeforeUnmount(() => {
  window.removeEventListener(WRAP_EVENT, onWrapChanged as EventListener)
})
</script>

<template>
  <NodeViewWrapper class="tomosona-code-node">
    <div
      class="tomosona-code-node-surface"
      :class="{ 'is-controls-open': controlsVisible }"
      :data-controls-open="controlsVisible ? 'true' : 'false'"
    >
      <div class="tomosona-code-node-actions" contenteditable="false">
        <UiFilterableDropdown
          class="tomosona-code-lang-select"
          :items="languageItems"
          :model-value="showLangMenu"
          :query="languageQuery"
          :active-index="activeLanguageIndex"
          :matcher="languageMatcher"
          filter-placeholder="Filter language..."
          :show-filter="true"
          :max-height="260"
          @open-change="showLangMenu = $event"
          @query-change="languageQuery = $event"
          @active-index-change="activeLanguageIndex = $event"
          @select="onLanguageSelect($event)"
        >
          <template #trigger="{ toggleMenu }">
            <button
              type="button"
              class="tomosona-code-lang-btn"
              @click.stop="toggleMenu"
              @mousedown.prevent
            >
              {{ currentLanguage || 'plain text' }}
            </button>
          </template>
          <template #item="{ item, active }">
            <span :class="{ 'tomosona-code-lang-active': active, 'tomosona-code-lang-selected': currentLanguage === item.value }">
              {{ item.label }}
            </span>
          </template>
        </UiFilterableDropdown>
        <button
          type="button"
          class="tomosona-code-node-wrap-btn"
          @mousedown.prevent
          @click="setWrapEnabled(!wrapEnabled)"
        >
          {{ wrapEnabled ? 'Unwrap' : 'Wrap' }}
        </button>
        <button
          type="button"
          class="tomosona-code-node-copy-btn"
          @mousedown.prevent
          @click="void copyCode()"
        >
          Copy
        </button>
      </div>

      <pre :class="preClass"><NodeViewContent as="code" :class="codeClass" /></pre>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-code-node {
  margin: 0.5rem 0;
}

.tomosona-code-node-surface {
  position: relative;
}

.tomosona-code-node pre {
  margin: 0;
  padding-top: 2.65rem;
}

.tomosona-code-node-actions {
  position: absolute;
  top: 0.7rem;
  right: 0.8rem;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 0.36rem;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition: opacity 120ms ease, transform 120ms ease;
}

.tomosona-code-node:hover .tomosona-code-node-actions,
.tomosona-code-node:focus-within .tomosona-code-node-actions,
.tomosona-code-node-surface.is-controls-open .tomosona-code-node-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.tomosona-code-node pre,
.tomosona-code-node code {
  font-family: var(--font-code);
}

.tomosona-code-node code.hljs {
  color: var(--editor-code-text);
}

.tomosona-code-node code :deep(.hljs-comment),
.tomosona-code-node code :deep(.hljs-quote) {
  color: var(--editor-code-comment);
}

.tomosona-code-node code :deep(.hljs-keyword),
.tomosona-code-node code :deep(.hljs-selector-tag),
.tomosona-code-node code :deep(.hljs-literal),
.tomosona-code-node code :deep(.hljs-title) {
  color: var(--editor-code-keyword);
}

.tomosona-code-node code :deep(.hljs-string),
.tomosona-code-node code :deep(.hljs-attr) {
  color: var(--editor-code-string);
}

.tomosona-code-node code :deep(.hljs-number),
.tomosona-code-node code :deep(.hljs-built_in),
.tomosona-code-node code :deep(.hljs-variable) {
  color: var(--editor-code-number);
}

.tomosona-code-node code :deep(.hljs-function),
.tomosona-code-node code :deep(.hljs-class),
.tomosona-code-node code :deep(.hljs-type) {
  color: var(--editor-code-function);
}

.tomosona-code-lang-btn {
  border: 1px solid var(--editor-block-control-border);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--editor-block-control-bg) 86%, transparent);
  backdrop-filter: blur(10px);
  color: var(--editor-block-control-text);
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
  padding: 0.28rem 0.45rem;
}

.tomosona-code-lang-btn:hover {
  background: var(--editor-block-control-hover);
}

.tomosona-code-node-wrap-btn,
.tomosona-code-node-copy-btn {
  border: 1px solid var(--editor-block-control-border);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--editor-block-control-bg) 86%, transparent);
  backdrop-filter: blur(10px);
  color: var(--editor-block-control-text);
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
  padding: 0.28rem 0.45rem;
}

.tomosona-code-node-wrap-btn:hover,
.tomosona-code-node-copy-btn:hover {
  background: var(--editor-block-control-hover);
}

.tomosona-code-lang-select {
  position: relative;
}

.tomosona-code-lang-select :deep(.ui-filterable-dropdown-menu) {
  min-width: 220px;
  max-width: 280px;
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
}

.tomosona-code-lang-select :deep(.ui-filterable-dropdown-option) {
  font-size: 12px;
}

.tomosona-code-lang-active {
  font-weight: 600;
}

.tomosona-code-lang-selected {
  text-decoration: underline;
}
</style>
