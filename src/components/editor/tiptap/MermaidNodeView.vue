<script setup lang="ts">
import mermaid from 'mermaid'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../ui/UiFilterableDropdown.vue'
import { beginHeavyRender, endHeavyRender } from '../../../lib/tiptap/renderStabilizer'
import {
  MERMAID_TEMPLATES,
  resolveMermaidTemplateId,
  toMermaidTemplateItems,
  type MermaidTemplateDropdownItem
} from '../../../lib/tiptap/mermaidTemplates'

const props = defineProps<{
  node: { attrs: { code?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
  extension: { options?: { confirmReplace?: (payload: { templateLabel: string }) => Promise<boolean> } }
}>()

const code = computed(() => String(props.node.attrs.code ?? ''))
const error = ref('')
const previewEl = ref<HTMLDivElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const showTemplateMenu = ref(false)
const templateQuery = ref('')
const activeTemplateIndex = ref(0)
const showCodeEditor = ref(false)
const currentTemplateId = computed(() => resolveMermaidTemplateId(code.value))
const templateItems = computed(() => toMermaidTemplateItems(MERMAID_TEMPLATES))
const INDENT = '  '
let renderRequestId = 0
let renderCount = 0

type MermaidRuntimeState = {
  initialized: boolean
  instanceSeq: number
}

function runtimeState(): MermaidRuntimeState {
  const target = window as typeof window & { __tomosonaMermaidRuntime?: MermaidRuntimeState }
  if (!target.__tomosonaMermaidRuntime) {
    target.__tomosonaMermaidRuntime = { initialized: false, instanceSeq: 0 }
  }
  return target.__tomosonaMermaidRuntime
}

const instanceId = ++runtimeState().instanceSeq

function ensureMermaid() {
  const runtime = runtimeState()
  if (runtime.initialized) return
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
  runtime.initialized = true
}

async function renderPreview() {
  const target = previewEl.value
  if (!target) return
  const requestId = ++renderRequestId
  const value = code.value.trim()
  if (!value) {
    target.innerHTML = ''
    error.value = 'Diagram is empty.'
    return
  }

  ensureMermaid()
  const renderToken = beginHeavyRender('mermaid-node-view')
  try {
    const id = `tomosona-mermaid-${instanceId}-${++renderCount}`
    const rendered = await mermaid.render(id, value)
    // Invariant: stale async render completions must not mutate DOM after a newer request won.
    if (requestId !== renderRequestId) return
    target.innerHTML = rendered.svg
    error.value = ''
  } catch (err) {
    // Invariant: stale async failures should be ignored for the same reason as stale successes.
    if (requestId !== renderRequestId) return
    target.innerHTML = ''
    error.value = err instanceof Error ? err.message : 'Invalid Mermaid diagram.'
  } finally {
    endHeavyRender(renderToken)
  }
}

function onInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement | null)?.value ?? ''
  props.updateAttributes({ code: value })
}

function templateMatcher(item: FilterableDropdownItem, query: string): boolean {
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry)) : []
  return [String(item.label), ...aliases].some((token) => token.toLowerCase().includes(query))
}

async function onTemplateSelect(item: FilterableDropdownItem) {
  const selected = templateItems.value.find((entry) => entry.value === item.value) as MermaidTemplateDropdownItem | undefined
  if (!selected) return

  const current = code.value.trim()
  const nextCode = String(selected.code).trim()
  if (current && current !== nextCode) {
    const confirmReplace = props.extension.options?.confirmReplace
    const approved = confirmReplace ? await confirmReplace({ templateLabel: String(selected.label) }) : true
    if (!approved) {
      return
    }
  }

  props.updateAttributes({ code: String(selected.code) })
  showCodeEditor.value = true
  await nextTick()
  textareaEl.value?.focus()
}

onMounted(() => {
  void renderPreview()
})

watch(code, () => {
  void nextTick().then(renderPreview)
})

function onPreviewClick(event: MouseEvent) {
  if (!props.editor.isEditable) return
  event.preventDefault()
  event.stopPropagation()
  showCodeEditor.value = true
  void nextTick().then(() => {
    textareaEl.value?.focus()
    const size = textareaEl.value?.value.length ?? 0
    textareaEl.value?.setSelectionRange(size, size)
  })
}

function onPreviewPointerDown(event: MouseEvent) {
  onPreviewClick(event)
}

function onEditorToggle(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  showCodeEditor.value = !showCodeEditor.value
  if (showCodeEditor.value) {
    void nextTick().then(() => textareaEl.value?.focus())
  }
}

function onEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault()
    const textarea = event.target as HTMLTextAreaElement | null
    if (!textarea) return
    applyTabIndentation(textarea, event.shiftKey)
    return
  }

  if (event.key !== 'Escape') return
  event.preventDefault()
  showCodeEditor.value = false
}

function applyTabIndentation(textarea: HTMLTextAreaElement, unindent: boolean) {
  const source = textarea.value
  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? start

  if (!unindent) {
    if (start === end) {
      const next = `${source.slice(0, start)}${INDENT}${source.slice(end)}`
      props.updateAttributes({ code: next })
      void nextTick().then(() => {
        textareaEl.value?.setSelectionRange(start + INDENT.length, start + INDENT.length)
      })
      return
    }

    const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const selectedBlock = source.slice(lineStart, end)
    const lines = selectedBlock.split('\n')
    const indented = lines.map((line) => `${INDENT}${line}`).join('\n')
    const next = `${source.slice(0, lineStart)}${indented}${source.slice(end)}`
    const addedChars = INDENT.length * lines.length
    props.updateAttributes({ code: next })
    void nextTick().then(() => {
      textareaEl.value?.setSelectionRange(start + INDENT.length, end + addedChars)
    })
    return
  }

  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const selectedBlock = source.slice(lineStart, end)
  const lines = selectedBlock.split('\n')

  let removedTotal = 0
  let removedFirstLine = 0
  const updatedLines = lines.map((line, index) => {
    if (line.startsWith(INDENT)) {
      removedTotal += INDENT.length
      if (index === 0) removedFirstLine = INDENT.length
      return line.slice(INDENT.length)
    }
    if (line.startsWith('\t')) {
      removedTotal += 1
      if (index === 0) removedFirstLine = 1
      return line.slice(1)
    }
    if (line.startsWith(' ')) {
      removedTotal += 1
      if (index === 0) removedFirstLine = 1
      return line.slice(1)
    }
    return line
  })

  if (removedTotal === 0) return
  const next = `${source.slice(0, lineStart)}${updatedLines.join('\n')}${source.slice(end)}`
  const nextStart = Math.max(lineStart, start - removedFirstLine)
  const nextEnd = Math.max(nextStart, end - removedTotal)
  props.updateAttributes({ code: next })
  void nextTick().then(() => {
    textareaEl.value?.setSelectionRange(nextStart, nextEnd)
  })
}
</script>

<template>
  <NodeViewWrapper
    class="tomosona-mermaid"
    :class="{ 'is-editing': editor.isEditable && showCodeEditor }"
  >
    <div class="tomosona-mermaid-header" contenteditable="false">
      <span class="tomosona-mermaid-title">Mermaid</span>
      <div class="tomosona-mermaid-actions" v-if="editor.isEditable">
        <UiFilterableDropdown
          class="tomosona-mermaid-template-select"
          :items="templateItems"
          :model-value="showTemplateMenu"
          :query="templateQuery"
          :active-index="activeTemplateIndex"
          :matcher="templateMatcher"
          filter-placeholder="Filter template..."
          :show-filter="true"
          :max-height="240"
          @open-change="showTemplateMenu = $event"
          @query-change="templateQuery = $event"
          @active-index-change="activeTemplateIndex = $event"
          @select="void onTemplateSelect($event)"
        >
          <template #trigger="{ toggleMenu }">
            <button
              type="button"
              class="tomosona-mermaid-template-btn"
              @click.stop="toggleMenu"
              @mousedown.prevent
            >
              {{ currentTemplateId ? `Template: ${currentTemplateId}` : 'Template' }}
            </button>
          </template>
          <template #item="{ item, active }">
            <span :class="{ 'tomosona-mermaid-template-active': active, 'tomosona-mermaid-template-selected': item.value === currentTemplateId }">
              {{ item.label }}
            </span>
          </template>
        </UiFilterableDropdown>
        <button
          type="button"
          class="tomosona-mermaid-edit-btn"
          @mousedown.stop.prevent="onEditorToggle($event)"
        >
          {{ showCodeEditor ? 'Done' : 'Edit' }}
        </button>
      </div>
    </div>

    <div class="tomosona-mermaid-body">
      <textarea
        v-if="editor.isEditable && showCodeEditor"
        ref="textareaEl"
        class="tomosona-mermaid-code"
        :value="code"
        spellcheck="false"
        @input="onInput"
        @keydown="onEditorKeydown"
      />
      <div
        ref="previewEl"
        class="tomosona-mermaid-preview"
        :class="{ 'is-editable': editor.isEditable }"
        contenteditable="false"
        @mousedown.stop.prevent="onPreviewPointerDown"
      ></div>
      <div v-if="editor.isEditable && !showCodeEditor" class="tomosona-mermaid-hint" contenteditable="false">
        Click diagram to edit code
      </div>
      <textarea
        v-if="!editor.isEditable"
        class="tomosona-mermaid-code"
        :value="code"
        readonly
      ></textarea>
      <div v-if="error" class="tomosona-mermaid-error" contenteditable="false">{{ error }}</div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-mermaid-actions {
  align-items: center;
  display: flex;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  visibility: hidden;
}

.tomosona-mermaid-template-select {
  position: relative;
}

.tomosona-mermaid-template-btn,
.tomosona-mermaid-edit-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
}

.tomosona-mermaid-template-btn:hover,
.tomosona-mermaid-edit-btn:hover {
  background: var(--color-bg-hover);
}

.tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-menu) {
  min-width: 220px;
  max-width: 280px;
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-menu) {
  background: rgb(15 23 42);
  border-color: rgb(71 85 105);
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-filter) {
  border-bottom-color: rgb(71 85 105);
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-filter-input) {
  background: rgb(15 23 42);
  border-color: rgb(71 85 105);
  color: rgb(226 232 240);
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-filter-input::placeholder) {
  color: rgb(148 163 184);
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-option) {
  color: rgb(226 232 240);
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-option:hover),
.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-option[data-active='true']) {
  background: rgb(30 41 59);
}

.dark .tomosona-mermaid-template-select :deep(.ui-filterable-dropdown-empty) {
  color: rgb(148 163 184);
}

.tomosona-mermaid-template-active {
  font-weight: 600;
}

.tomosona-mermaid-template-selected {
  text-decoration: underline;
}

.tomosona-mermaid-preview.is-editable {
  cursor: text;
  user-select: none;
}

.tomosona-mermaid-hint {
  color: #64748b;
  font-size: 12px;
  margin-top: 8px;
}

.tomosona-mermaid-code {
  font-family: var(--font-code);
  font-size: 12px;
  line-height: 1.45;
  margin-bottom: 10px;
  min-height: 120px;
  width: 100%;
}

.tomosona-mermaid:hover .tomosona-mermaid-actions,
.tomosona-mermaid:focus-within .tomosona-mermaid-actions {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

@media (hover: none) {
  .tomosona-mermaid .tomosona-mermaid-actions {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
  }
}
</style>
