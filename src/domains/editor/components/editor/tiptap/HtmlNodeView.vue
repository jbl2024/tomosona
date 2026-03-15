<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { NodeSelection } from '@tiptap/pm/state'
import { common, createLowlight } from 'lowlight'
import { sanitizeHtmlForPreview } from '../../../../../shared/lib/htmlSanitizer'
import { parseWikilinkTarget } from '../../../lib/wikilinks'

const INDENT = '  '
const lowlight = createLowlight(common)

type HastNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const props = defineProps<{
  node: { attrs: { html?: string; autoEdit?: boolean } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: {
    isEditable: boolean
    state?: { doc: unknown; selection?: { from?: number } }
    view?: { dispatch: (transaction: unknown) => void; focus?: (options?: FocusOptions) => void }
  }
  getPos?: () => number | undefined
}>()

const sourceTextarea = ref<HTMLTextAreaElement | null>(null)
const sourcePre = ref<HTMLElement | null>(null)
const sourceShell = ref<HTMLElement | null>(null)
const showSource = ref(false)
const sourceEditorHeight = ref('0px')
let pendingSourceFocusOptions: { placeCaretAtEnd?: boolean; placeCaretInsideTemplate?: boolean } | null = null

const html = computed(() => String(props.node.attrs.html ?? ''))
const sanitizedPreview = computed(() => toPreviewHtml(html.value))
const highlightedSource = computed(() => highlightHtmlSource(html.value))

function estimateSourceHeight(value: string): number {
  const lineCount = Math.max(1, value.split('\n').length)
  const lineHeightPx = 22
  const verticalPaddingPx = 18
  const borderPx = 2
  return Math.max(74, lineCount * lineHeightPx + verticalPaddingPx + borderPx)
}

function syncSourceEditorHeight() {
  const textarea = sourceTextarea.value
  if (!textarea) {
    sourceEditorHeight.value = `${estimateSourceHeight(html.value)}px`
    return
  }
  const previousHeight = textarea.style.height
  textarea.style.height = '0px'
  const measuredHeight = textarea.scrollHeight
  const nextHeight = Math.max(measuredHeight, estimateSourceHeight(textarea.value))
  sourceEditorHeight.value = `${nextHeight}px`
  textarea.style.height = previousHeight || sourceEditorHeight.value
}

function findTemplateInnerCaret(value: string): number | null {
  const match = value.match(/^<([A-Za-z][^\s/>]*)(?:[^>]*)>\n([ \t]*)\n<\/\1>\s*$/)
  if (!match) return null
  const lineBreakIndex = value.indexOf('\n')
  if (lineBreakIndex < 0) return null
  return lineBreakIndex + 1 + match[2].length
}

function applyCaretPosition(options?: { placeCaretAtEnd?: boolean; placeCaretInsideTemplate?: boolean }) {
  const textarea = sourceTextarea.value
  if (!textarea) return
  if (options?.placeCaretInsideTemplate) {
    const innerCaret = findTemplateInnerCaret(textarea.value)
    if (typeof innerCaret === 'number') {
      textarea.setSelectionRange(innerCaret, innerCaret)
      return
    }
  }
  if (options?.placeCaretAtEnd) {
    const size = textarea.value.length
    textarea.setSelectionRange(size, size)
  }
}

function requestAnimationFrameLike(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return window.setTimeout(() => callback(performance.now()), 16)
}

function focusSourceTextarea(options?: { placeCaretAtEnd?: boolean; placeCaretInsideTemplate?: boolean }, remainingAttempts = 8) {
  if (!showSource.value) {
    pendingSourceFocusOptions = null
    return
  }
  const textarea = sourceTextarea.value
  if (textarea) {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== textarea) {
      active.blur()
    }
    textarea.focus({ preventScroll: true })
    syncSourceEditorHeight()
    applyCaretPosition(options)
    if (document.activeElement === textarea) {
      pendingSourceFocusOptions = null
      return
    }
  }
  if (remainingAttempts <= 0) {
    pendingSourceFocusOptions = null
    return
  }
  requestAnimationFrameLike(() => focusSourceTextarea(options, remainingAttempts - 1))
}

function scheduleSourceFocus(options?: { placeCaretAtEnd?: boolean; placeCaretInsideTemplate?: boolean }) {
  pendingSourceFocusOptions = options ?? {}
  void nextTick().then(() => {
    window.setTimeout(() => {
      focusSourceTextarea(pendingSourceFocusOptions ?? undefined)
    }, 0)
  })
}

function openSourceEditor(options?: { placeCaretAtEnd?: boolean; placeCaretInsideTemplate?: boolean }) {
  if (!props.editor.isEditable) return
  focusHtmlNodeSelection()
  showSource.value = true
  scheduleSourceFocus(options)
}

function focusHtmlNodeSelection() {
  const pos = props.getPos?.()
  const state = props.editor.state
  const view = props.editor.view
  if (typeof pos !== 'number' || !state || !view?.dispatch) return
  try {
    const selection = NodeSelection.create(state.doc as never, pos)
    const currentFrom = state.selection?.from
    if (currentFrom === selection.from) return
    const transaction = (state as { tr?: { setSelection: (selection: NodeSelection) => unknown } }).tr
    if (!transaction?.setSelection) return
    view.dispatch(transaction.setSelection(selection))
  } catch {
    // Ignore focus anchoring failures and fall back to direct textarea focus.
  }
}

function consumeAutoEdit() {
  if (!props.editor.isEditable) return
  if (!props.node.attrs.autoEdit) return
  openSourceEditor({ placeCaretInsideTemplate: true })
  props.updateAttributes({ autoEdit: false })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hastToHtml(node: HastNode): string {
  if (node.type === 'text') return escapeHtml(String(node.value ?? ''))
  if (node.type !== 'element') return ''
  const tag = String(node.tagName ?? 'span')
  const rawClasses = node.properties?.className
  const className = Array.isArray(rawClasses)
    ? rawClasses.map((entry) => String(entry)).join(' ')
    : typeof rawClasses === 'string'
      ? rawClasses
      : ''
  const attrs = className ? ` class="${escapeHtml(className)}"` : ''
  const children = Array.isArray(node.children) ? node.children.map((child) => hastToHtml(child)).join('') : ''
  return `<${tag}${attrs}>${children}</${tag}>`
}

function highlightHtmlSource(value: string): string {
  if (!value) return ''
  try {
    const tree = lowlight.highlight('xml', value)
    const nodes = Array.isArray(tree.children) ? tree.children as HastNode[] : []
    return nodes.map((node) => hastToHtml(node)).join('')
  } catch {
    return escapeHtml(value)
  }
}

function toPreviewHtml(value: string): string {
  const sanitized = sanitizeHtmlForPreview(value)
  if (!sanitized || !sanitized.includes('[[')) return sanitized

  const root = document.createElement('div')
  root.innerHTML = sanitized
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text) textNodes.push(node)
  }

  const wikilinkRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  textNodes.forEach((node) => {
    const parent = node.parentElement
    if (!parent) return
    if (parent.closest('a,code,pre')) return

    const source = node.nodeValue ?? ''
    if (!source.includes('[[')) return
    let hasReplacement = false
    const fragment = document.createDocumentFragment()
    let offset = 0
    let match: RegExpExecArray | null
    wikilinkRe.lastIndex = 0

    while ((match = wikilinkRe.exec(source)) !== null) {
      const full = match[0]
      const start = match.index
      const end = start + full.length
      const rawTarget = (match[1] ?? '').trim()
      const alias = (match[2] ?? '').trim()
      if (start > offset) {
        fragment.append(document.createTextNode(source.slice(offset, start)))
      }
      if (!rawTarget) {
        fragment.append(document.createTextNode(full))
      } else {
        const parsed = parseWikilinkTarget(rawTarget)
        const defaultLabel = parsed.anchor?.heading && !parsed.notePath ? parsed.anchor.heading : rawTarget
        const anchor = document.createElement('a')
        anchor.className = 'wikilink'
        anchor.setAttribute('data-wikilink-target', rawTarget)
        anchor.setAttribute('href', `wikilink:${encodeURIComponent(rawTarget)}`)
        anchor.textContent = alias || defaultLabel
        fragment.append(anchor)
        hasReplacement = true
      }
      offset = end
    }

    if (!hasReplacement) return
    if (offset < source.length) {
      fragment.append(document.createTextNode(source.slice(offset)))
    }
    parent.replaceChild(fragment, node)
  })

  return root.innerHTML
}

function onInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement | null)?.value ?? ''
  props.updateAttributes({ html: value })
  syncSourceEditorHeight()
}

function onEditorToggle(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  if (showSource.value) {
    showSource.value = false
    return
  }
  openSourceEditor()
}

function onPreviewModifierPointerDown(event: MouseEvent) {
  if (!props.editor.isEditable) return
  if (!event.metaKey && !event.ctrlKey) return
  event.preventDefault()
  event.stopPropagation()
}

function onPreviewModifierClick(event: MouseEvent) {
  if (!props.editor.isEditable) return
  if (!event.metaKey && !event.ctrlKey) return
  event.preventDefault()
  event.stopPropagation()
  openSourceEditor({ placeCaretAtEnd: true })
}

function onSourceBlur() {
  window.setTimeout(() => {
    if (!showSource.value) return
    const active = document.activeElement
    if (active instanceof HTMLElement && sourceShell.value?.contains(active)) return
    showSource.value = false
  }, 0)
}

function syncHighlightedScroll() {
  if (!sourceTextarea.value || !sourcePre.value) return
  sourcePre.value.scrollTop = sourceTextarea.value.scrollTop
  sourcePre.value.scrollLeft = sourceTextarea.value.scrollLeft
}

function commitValue(nextValue: string, start: number, end: number) {
  props.updateAttributes({ html: nextValue })
  void nextTick().then(() => {
    syncSourceEditorHeight()
    sourceTextarea.value?.setSelectionRange(start, end)
    syncHighlightedScroll()
  })
}

function applyTabIndentation(textarea: HTMLTextAreaElement, unindent: boolean) {
  const source = textarea.value
  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? start

  if (!unindent) {
    if (start === end) {
      const next = `${source.slice(0, start)}${INDENT}${source.slice(end)}`
      commitValue(next, start + INDENT.length, start + INDENT.length)
      return
    }

    const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const selectedBlock = source.slice(lineStart, end)
    const lines = selectedBlock.split('\n')
    const indented = lines.map((line) => `${INDENT}${line}`).join('\n')
    const next = `${source.slice(0, lineStart)}${indented}${source.slice(end)}`
    const addedChars = INDENT.length * lines.length
    commitValue(next, start + INDENT.length, end + addedChars)
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
  commitValue(next, nextStart, nextEnd)
}

function applyAutoIndent(textarea: HTMLTextAreaElement) {
  const source = textarea.value
  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? start
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const currentLine = source.slice(lineStart, start)
  const indent = currentLine.match(/^[ \t]*/)?.[0] ?? ''
  const insertion = `\n${indent}`
  const next = `${source.slice(0, start)}${insertion}${source.slice(end)}`
  const nextPos = start + insertion.length
  commitValue(next, nextPos, nextPos)
}

function onEditorKeydown(event: KeyboardEvent) {
  if (!props.editor.isEditable) return
  const textarea = event.target as HTMLTextAreaElement | null
  if (!textarea) return

  if (event.key === 'Tab') {
    event.preventDefault()
    applyTabIndentation(textarea, event.shiftKey)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    applyAutoIndent(textarea)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    showSource.value = false
  }
}

onMounted(() => {
  sourceEditorHeight.value = `${estimateSourceHeight(html.value)}px`
  consumeAutoEdit()
})

watch(() => props.node.attrs.autoEdit, () => {
  consumeAutoEdit()
})

watch(html, () => {
  if (!showSource.value) return
  void nextTick().then(() => {
    syncSourceEditorHeight()
    syncHighlightedScroll()
  })
})
</script>

<template>
  <NodeViewWrapper class="tomosona-html-node" :class="{ 'is-editing': editor.isEditable && showSource }">
    <div class="tomosona-html-surface">
      <div class="tomosona-html-body">
        <button
          v-if="editor.isEditable"
          type="button"
          class="tomosona-html-toggle-btn"
          contenteditable="false"
          @mousedown.stop.prevent="onEditorToggle($event)"
        >
          &lt;/&gt;
        </button>
        <div
          v-if="!showSource"
          class="tomosona-html-preview"
          contenteditable="false"
          v-html="sanitizedPreview"
          @mousedown="onPreviewModifierPointerDown"
          @click="onPreviewModifierClick"
        ></div>

        <div v-else ref="sourceShell" class="tomosona-html-source-shell">
          <pre ref="sourcePre" class="tomosona-html-source" :style="{ height: sourceEditorHeight }" aria-hidden="true"><code class="hljs language-xml" v-html="highlightedSource"></code></pre>
          <textarea
            ref="sourceTextarea"
            class="tomosona-html-textarea"
            :value="html"
            :style="{ height: sourceEditorHeight }"
            spellcheck="false"
            @blur="onSourceBlur"
            @input="onInput"
            @scroll="syncHighlightedScroll"
            @keydown="onEditorKeydown"
          />
        </div>
      </div>
    </div>
   </NodeViewWrapper>
</template>

<style scoped>
.tomosona-html-node {
  margin: 0.18rem 0;
}

.tomosona-html-surface {
  position: relative;
}

.tomosona-html-body {
  position: relative;
}

.tomosona-html-toggle-btn {
  border: 1px solid var(--editor-block-control-border);
  border-radius: 0.4rem;
  background: var(--editor-block-control-bg);
  color: var(--editor-block-control-text);
  cursor: pointer;
  font-family: var(--font-code);
  font-size: 0.72rem;
  line-height: 1;
  padding: 0.2rem 0.36rem;
  position: absolute;
  right: 0.42rem;
  top: 0.38rem;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  visibility: hidden;
}

.tomosona-html-toggle-btn:hover {
  background: var(--editor-block-control-hover);
}

.tomosona-html-preview {
  border: 1px solid transparent;
  border-radius: 0.7rem;
  min-height: 2.25rem;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.tomosona-html-source-shell {
  position: relative;
}

.tomosona-html-source,
.tomosona-html-textarea {
  border: 1px solid var(--editor-source-border);
  border-radius: 0.7rem;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  line-height: 1.45;
  margin: 0;
  overflow: auto;
  padding: 0.56rem 0.62rem;
  white-space: pre;
  width: 100%;
}

.tomosona-html-source {
  color: var(--editor-source-text);
  pointer-events: none;
}

.tomosona-html-textarea {
  background: transparent;
  caret-color: var(--editor-textarea-caret);
  color: transparent;
  bottom: 0;
  left: 0;
  position: absolute;
  resize: none;
  right: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.tomosona-html-textarea::selection {
  background: var(--editor-textarea-selection);
}

.tomosona-html-source code.hljs {
  color: var(--editor-code-text);
}

.tomosona-html-source code :deep(.hljs-tag),
.tomosona-html-source code :deep(.hljs-name),
.tomosona-html-source code :deep(.hljs-selector-tag) {
  color: var(--editor-html-tag);
}

.tomosona-html-source code :deep(.hljs-attr) {
  color: var(--editor-html-attr);
}

.tomosona-html-source code :deep(.hljs-string) {
  color: var(--editor-html-string);
}

.tomosona-html-node:hover .tomosona-html-toggle-btn,
.tomosona-html-node.is-editing .tomosona-html-toggle-btn {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

.tomosona-html-node:hover .tomosona-html-preview,
.tomosona-html-node.is-editing .tomosona-html-preview {
  border-color: var(--editor-source-border);
}
</style>
