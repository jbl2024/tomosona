<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { StreamLanguage } from '@codemirror/language'
import { search, openSearchPanel } from '@codemirror/search'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  languageLabel: string
  readOnly?: boolean
  wordWrap?: boolean
  scrollTop?: number
  scrollLeft?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  focus: []
  blur: []
  scroll: [position: { top: number; left: number }]
  'toggle-word-wrap': []
}>()

const rootEl = ref<HTMLDivElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)
let suppressDocChange = false

function emitScrollPosition() {
  const view = editorView.value
  if (!view) return
  emit('scroll', { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft })
}

const editorClass = computed(() => ({
  'tomosona-source-editor': true,
  'tomosona-source-editor--readonly': Boolean(props.readOnly)
}))

function buildState(value: string) {
  return EditorState.create({
    doc: value,
    extensions: [
      basicSetup,
      search(),
      languageExtensionFor(props.languageLabel),
      props.wordWrap !== false ? EditorView.lineWrapping : [],
      EditorView.editable.of(!props.readOnly),
      EditorView.domEventHandlers({
        focus: () => emit('focus'),
        blur: () => emit('blur')
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (suppressDocChange) return
        emit('update:modelValue', update.state.doc.toString())
      }),
      keymap.of([indentWithTab])
    ]
  })
}

function languageExtensionFor(label: string) {
  const normalized = label.trim().toLowerCase()
  switch (normalized) {
    case 'md': case 'markdown': return markdown()
    case 'js': case 'mjs': case 'cjs': case 'ts': case 'tsx': case 'jsx':
    case 'typescript': case 'javascript': return javascript({ typescript: ['ts', 'tsx', 'typescript'].includes(normalized), jsx: ['jsx', 'tsx'].includes(normalized) })
    case 'json': case 'jsonc': return json()
    case 'html': case 'htm': case 'vue': return html()
    case 'css': case 'scss': case 'less': return css()
    case 'xml': case 'svg': return xml()
    case 'yaml': case 'yml': return yaml()
    case 'toml': return StreamLanguage.define(toml)
    case 'sh': case 'bash': case 'zsh': case 'fish': return StreamLanguage.define(shell)
    case 'dockerfile': return StreamLanguage.define(dockerFile)
    case 'py': case 'python': return python()
    case 'rs': case 'rust': return rust()
    case 'sql': return sql()
    default: return []
  }
}

function syncFromProp(value: string) {
  const view = editorView.value
  if (!view) return
  const current = view.state.doc.toString()
  if (current === value) return
  suppressDocChange = true
  try {
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    })
  } finally {
    suppressDocChange = false
  }
}

function focus() {
  editorView.value?.focus()
}

function restoreScrollPosition() {
  const view = editorView.value
  if (!view) return
  view.scrollDOM.scrollTop = props.scrollTop ?? 0
  view.scrollDOM.scrollLeft = props.scrollLeft ?? 0
}

function openSearch() {
  const view = editorView.value
  if (view) openSearchPanel(view)
}

onMounted(() => {
  if (!rootEl.value) return
  editorView.value = new EditorView({
    state: buildState(props.modelValue),
    parent: rootEl.value
  })
  editorView.value.scrollDOM.addEventListener('scroll', emitScrollPosition)
  requestAnimationFrame(restoreScrollPosition)
})

watch(
  () => props.modelValue,
  (value) => {
    syncFromProp(value)
  }
)

watch(
  () => props.readOnly,
  () => {
    const view = editorView.value
    if (!view) return
    const scrollTop = view.scrollDOM.scrollTop
    const scrollLeft = view.scrollDOM.scrollLeft
    const nextState = buildState(view.state.doc.toString())
    view.setState(nextState)
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = scrollTop
      view.scrollDOM.scrollLeft = scrollLeft
    })
  }
)

watch(() => props.wordWrap, () => {
  const view = editorView.value
  if (!view) return
  const scrollTop = view.scrollDOM.scrollTop
  const scrollLeft = view.scrollDOM.scrollLeft
  view.setState(buildState(view.state.doc.toString()))
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = scrollTop
    view.scrollDOM.scrollLeft = scrollLeft
  })
})

watch([() => props.scrollTop, () => props.scrollLeft], restoreScrollPosition)

onBeforeUnmount(() => {
  editorView.value?.scrollDOM.removeEventListener('scroll', emitScrollPosition)
  editorView.value?.destroy()
  editorView.value = null
})

defineExpose({
  focus,
  openSearch
})
</script>

<template>
  <div
    ref="rootEl"
    :class="editorClass"
    :data-language-label="props.languageLabel"
    @tomosona:source-find.stop="openSearch"
  >
    <button
      type="button"
      class="tomosona-source-editor-wrap-toggle"
      :aria-pressed="props.wordWrap !== false"
      :title="props.wordWrap !== false ? 'Disable word wrap' : 'Enable word wrap'"
      @click="emit('toggle-word-wrap')"
    >
      {{ props.wordWrap !== false ? 'Wrap: on' : 'Wrap: off' }}
    </button>
  </div>
</template>

<style scoped>
.tomosona-source-editor {
  position: relative;
  height: 100%;
  min-height: 100%;
  width: 100%;
}

.tomosona-source-editor :deep(.cm-scroller) {
  font-family: var(--font-code);
  overflow: auto;
}

.tomosona-source-editor :deep(.cm-editor) {
  height: 100%;
  min-height: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
}

.tomosona-source-editor :deep(.cm-gutters) {
  background: color-mix(in srgb, var(--surface-muted) 70%, transparent);
  border-right-color: color-mix(in srgb, var(--border-subtle) 70%, transparent);
  color: var(--text-dim);
}

.tomosona-source-editor :deep(.cm-activeLineGutter),
.tomosona-source-editor :deep(.cm-activeLine) {
  background: color-mix(in srgb, var(--surface-subtle) 72%, transparent);
}

.tomosona-source-editor-wrap-toggle {
  position: absolute;
  z-index: 2;
  top: 0.5rem;
  right: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--surface-bg) 88%, transparent);
  color: var(--text-dim);
  padding: 0.2rem 0.45rem;
  font-size: 0.72rem;
}

.tomosona-source-editor-wrap-toggle:hover {
  color: var(--text-main);
  background: var(--surface-subtle);
}
</style>
