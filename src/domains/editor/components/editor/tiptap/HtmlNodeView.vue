<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { common, createLowlight } from 'lowlight'
import { sanitizeHtmlForPreview } from '../../../../../lib/htmlSanitizer'
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
  node: { attrs: { html?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
}>()

const sourceTextarea = ref<HTMLTextAreaElement | null>(null)
const sourcePre = ref<HTMLElement | null>(null)
const showSource = ref(false)

const html = computed(() => String(props.node.attrs.html ?? ''))
const sanitizedPreview = computed(() => toPreviewHtml(html.value))
const highlightedSource = computed(() => highlightHtmlSource(html.value))

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
}

function onEditorToggle(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  showSource.value = !showSource.value
  if (showSource.value) {
    void nextTick().then(() => sourceTextarea.value?.focus())
  }
}

function syncHighlightedScroll() {
  if (!sourceTextarea.value || !sourcePre.value) return
  sourcePre.value.scrollTop = sourceTextarea.value.scrollTop
  sourcePre.value.scrollLeft = sourceTextarea.value.scrollLeft
}

function commitValue(nextValue: string, start: number, end: number) {
  props.updateAttributes({ html: nextValue })
  void nextTick().then(() => {
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
        ></div>

        <div v-else class="tomosona-html-source-shell">
          <pre ref="sourcePre" class="tomosona-html-source" aria-hidden="true"><code class="hljs language-xml" v-html="highlightedSource"></code></pre>
          <textarea
            ref="sourceTextarea"
            class="tomosona-html-textarea"
            :value="html"
            spellcheck="false"
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
  min-height: 120px;
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
