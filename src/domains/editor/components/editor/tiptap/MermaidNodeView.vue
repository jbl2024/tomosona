<script setup lang="ts">
import mermaid from 'mermaid'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../../shared/components/ui/UiFilterableDropdown.vue'
import { beginHeavyRender, endHeavyRender } from '../../../lib/tiptap/renderStabilizer'
import {
  MERMAID_TEMPLATES,
  resolveMermaidTemplateId,
  toMermaidTemplateItems,
  type MermaidTemplateDropdownItem
} from '../../../lib/tiptap/mermaidTemplates'
import type { MermaidPreviewPayload } from '../../../composables/useMermaidPreviewDialog'
import {
  useTextareaBlockCursor,
  resolveTextareaBlockCursorOptions
} from '../../../composables/useTextareaBlockCursor'

const props = defineProps<{
  node: { attrs: { code?: string; autoEdit?: boolean }; nodeSize?: number }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: {
    isEditable: boolean
    state?: {
      doc?: { nodeAt: (pos: number) => { nodeSize: number } | null }
      selection?: { from?: number }
      tr?: { setSelection: (selection: TextSelection) => unknown }
    }
    view?: { dispatch: (transaction: unknown) => void }
  }
  getPos?: () => number | undefined
  extension: {
    options?: {
      confirmReplace?: (payload: { templateLabel: string }) => Promise<boolean>
      openPreview?: (payload: MermaidPreviewPayload) => void
    }
  }
}>()

const code = computed(() => String(props.node.attrs.code ?? ''))
const error = ref('')
const previewEl = ref<HTMLDivElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const showTemplateMenu = ref(false)
const templateQuery = ref('')
const activeTemplateIndex = ref(0)
const showCodeEditor = ref(false)
const renderedSvg = ref('')
useTextareaBlockCursor({
  textarea: textareaEl,
  ...resolveTextareaBlockCursorOptions(props.editor)
})
const currentTemplateId = computed(() => resolveMermaidTemplateId(code.value))
const templateItems = computed(() => toMermaidTemplateItems(MERMAID_TEMPLATES))
const INDENT = '  '
let renderRequestId = 0
let renderCount = 0

type MermaidRuntimeState = {
  initialized: boolean
  instanceSeq: number
  themeKey: 'light' | 'dark' | null
}

type FontFaceSetLike = {
  ready?: Promise<unknown>
  addEventListener?: (type: 'loadingdone' | 'loadingerror', listener: EventListener) => void
  removeEventListener?: (type: 'loadingdone' | 'loadingerror', listener: EventListener) => void
}

type CssDeclaration = {
  property: string
  value: string
}

const SVG_PRESENTATION_ATTRS = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'opacity',
  'color',
  'rx',
  'ry'
])

const HTML_INLINE_STYLE_ATTRS = new Set([
  'background',
  'background-color',
  'color',
  'display',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'text-align',
  'text-decoration',
  'text-transform',
  'white-space'
])

function runtimeState(): MermaidRuntimeState {
  const target = window as typeof window & { __tomosonaMermaidRuntime?: MermaidRuntimeState }
  if (!target.__tomosonaMermaidRuntime) {
    target.__tomosonaMermaidRuntime = { initialized: false, instanceSeq: 0, themeKey: null }
  }
  return target.__tomosonaMermaidRuntime
}

const instanceId = ++runtimeState().instanceSeq
let themeObserver: MutationObserver | null = null
let fontsReadyHandler: EventListener | null = null

function documentFonts(): FontFaceSetLike | null {
  return typeof document === 'undefined' ? null : ((document as Document & { fonts?: FontFaceSetLike }).fonts ?? null)
}

function resolveThemeKey(): 'light' | 'dark' {
  const root = document.documentElement
  return root.classList.contains('dark') || root.dataset.colorScheme === 'dark' ? 'dark' : 'light'
}

function buildMermaidConfig(themeKey: 'light' | 'dark') {
  if (themeKey === 'dark') {
    return {
      startOnLoad: false,
      securityLevel: 'strict' as const,
      suppressErrorRendering: true,
      theme: 'base' as const,
      darkMode: true,
      themeVariables: {
        background: '#282c34',
        primaryColor: '#3b4252',
        primaryBorderColor: '#a78bfa',
        primaryTextColor: '#e5e7eb',
        lineColor: '#9ca3af',
        textColor: '#e5e7eb',
        mainBkg: '#3b4252',
        secondBkg: '#312e81',
        tertiaryColor: '#282c34',
        clusterBkg: '#282c34',
        clusterBorder: '#64748b',
        edgeLabelBackground: '#282c34',
        fontFamily: 'Geist, Noto Sans, DejaVu Sans, sans-serif',
        fontSize: '16px'
      }
    }
  }

  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    suppressErrorRendering: true,
    theme: 'base' as const,
    darkMode: false,
    themeVariables: {
      background: '#ffffff',
      primaryColor: '#ede9fe',
      primaryBorderColor: '#a78bfa',
      primaryTextColor: '#1f2937',
      lineColor: '#4b5563',
      textColor: '#1f2937',
      mainBkg: '#ede9fe',
      secondBkg: '#f8fafc',
      tertiaryColor: '#ffffff',
      clusterBkg: '#f8fafc',
      clusterBorder: '#cbd5e1',
      edgeLabelBackground: '#ffffff',
      fontFamily: 'Geist, Noto Sans, DejaVu Sans, sans-serif',
      fontSize: '16px'
    }
  }
}

function ensureMermaid() {
  const runtime = runtimeState()
  const themeKey = resolveThemeKey()
  if (runtime.initialized && runtime.themeKey === themeKey) return
  mermaid.initialize(buildMermaidConfig(themeKey))
  runtime.initialized = true
  runtime.themeKey = themeKey
}

async function waitForFontsReady(requestId: number) {
  const fonts = documentFonts()
  if (!fonts?.ready) return requestId === renderRequestId
  try {
    await fonts.ready
  } catch {
    // Fall back to rendering with available fonts if the browser reports a font load failure.
  }
  return requestId === renderRequestId
}

function parseCssDeclarations(block: string) {
  return block
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':')
      if (separator < 0) return null
      const property = entry.slice(0, separator).trim()
      const value = entry.slice(separator + 1).trim()
      if (!property || !value) return null
      return { property, value }
    })
    .filter((entry): entry is CssDeclaration => entry !== null)
}

function normalizeSvgSelector(selector: string, rootId: string | null) {
  const trimmed = selector.trim()
  if (!trimmed || trimmed.startsWith('@')) return ''
  if (!rootId) return trimmed
  return trimmed.split(`#${rootId}`).join('').trim()
}

function mergeInlineStyles(element: Element, declarations: CssDeclaration[]) {
  if (declarations.length === 0) return
  const styleMap = new Map<string, string>()
  for (const declaration of parseCssDeclarations(element.getAttribute('style') ?? '')) {
    styleMap.set(declaration.property, declaration.value)
  }
  for (const declaration of declarations) {
    styleMap.set(declaration.property, declaration.value)
  }
  const styleValue = Array.from(styleMap.entries())
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
  if (styleValue) {
    element.setAttribute('style', styleValue)
  }
}

function isHtmlForeignObjectElement(element: Element) {
  return element.namespaceURI === 'http://www.w3.org/1999/xhtml'
}

function applyCssAsSvgAttributes(svg: SVGSVGElement, stylesheet: string) {
  const rootId = svg.getAttribute('id')
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g
  for (const match of stylesheet.matchAll(ruleRe)) {
    const selectorGroup = match[1] ?? ''
    const declarations = parseCssDeclarations(match[2] ?? '')
    if (declarations.length === 0) continue

    for (const selector of selectorGroup.split(',')) {
      const normalizedSelector = normalizeSvgSelector(selector, rootId)
      if (!normalizedSelector) continue

      let elements: Element[] = []
      try {
        elements = Array.from(svg.querySelectorAll(normalizedSelector))
      } catch {
        continue
      }

      for (const element of elements) {
        if (isHtmlForeignObjectElement(element)) {
          mergeInlineStyles(element, declarations.filter((declaration) => HTML_INLINE_STYLE_ATTRS.has(declaration.property)))
          continue
        }

        for (const declaration of declarations.filter((entry) => SVG_PRESENTATION_ATTRS.has(entry.property))) {
          element.setAttribute(declaration.property, declaration.value)
        }
      }
    }
  }
}

function normalizeForeignObjectMarkup(svg: SVGSVGElement) {
  const htmlParagraphs = Array.from(svg.querySelectorAll('foreignObject p'))
  for (const paragraph of htmlParagraphs) {
    mergeInlineStyles(paragraph, [
      { property: 'margin', value: '0' },
      { property: 'font-size', value: 'inherit' },
      { property: 'font-family', value: 'inherit' },
      { property: 'line-height', value: 'inherit' }
    ])
  }
}

function sanitizeRenderedSvg(markup: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(markup, 'image/svg+xml')
  const svg = doc.documentElement as Element
  if (svg.localName !== 'svg') return markup
  const svgRoot = svg as unknown as SVGSVGElement

  const styleElements = Array.from(svgRoot.querySelectorAll('style'))
  for (const styleElement of styleElements) {
    applyCssAsSvgAttributes(svgRoot, styleElement.textContent ?? '')
    styleElement.remove()
  }

  normalizeForeignObjectMarkup(svgRoot)
  return new XMLSerializer().serializeToString(svgRoot)
}

function requestAnimationFrameLike(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return window.setTimeout(() => callback(performance.now()), 16)
}

function focusCodeTextarea() {
  const textarea = textareaEl.value
  if (!textarea) return false
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== textarea) {
    active.blur()
  }
  textarea.focus({ preventScroll: true })
  return document.activeElement === textarea
}

function scheduleCodeFocus(placeCaretAtEnd = true) {
  void nextTick().then(() => {
    window.setTimeout(() => {
      const focusTarget = () => {
        if (!focusCodeTextarea()) {
          requestAnimationFrameLike(() => {
            if (focusCodeTextarea() && placeCaretAtEnd) {
              const size = textareaEl.value?.value.length ?? 0
              textareaEl.value?.setSelectionRange(size, size)
            }
          })
          return
        }
        if (placeCaretAtEnd) {
          const size = textareaEl.value?.value.length ?? 0
          textareaEl.value?.setSelectionRange(size, size)
        }
      }
      focusTarget()
    }, 0)
  })
}

function focusMermaidNodeSelection() {
  const pos = props.getPos?.()
  const state = props.editor.state
  const view = props.editor.view
  if (typeof pos !== 'number' || !state?.doc || !view?.dispatch) return

  const node = state.doc.nodeAt(pos)
  const nodeSize = props.node.nodeSize ?? node?.nodeSize ?? 1
  try {
    const selection = TextSelection.create(state.doc as never, pos + nodeSize)
    const currentFrom = state.selection?.from
    if (currentFrom === selection.from) return
    const transaction = state.tr
    if (!transaction?.setSelection) return
    view.dispatch(transaction.setSelection(selection))
  } catch {
    // Ignore selection anchoring failures and fall back to direct textarea focus.
  }
}

function openCodeEditor() {
  if (!props.editor.isEditable) return
  focusMermaidNodeSelection()
  showCodeEditor.value = true
  scheduleCodeFocus()
}

function consumeAutoEdit() {
  if (!props.editor.isEditable) return
  if (!props.node.attrs.autoEdit) return
  openCodeEditor()
  props.updateAttributes({ autoEdit: false })
}

async function renderPreview() {
  const target = previewEl.value
  if (!target) return
  const requestId = ++renderRequestId
  const value = code.value.trim()
  if (!value) {
    target.innerHTML = ''
    renderedSvg.value = ''
    error.value = 'Diagram is empty.'
    return
  }

  if (!(await waitForFontsReady(requestId))) return
  ensureMermaid()
  const renderToken = beginHeavyRender('mermaid-node-view')
  try {
    const id = `tomosona-mermaid-${instanceId}-${++renderCount}`
    const rendered = await mermaid.render(id, value)
    const sanitizedSvg = sanitizeRenderedSvg(rendered.svg)
    // Invariant: stale async render completions must not mutate DOM after a newer request won.
    if (requestId !== renderRequestId) return
    target.innerHTML = sanitizedSvg
    renderedSvg.value = sanitizedSvg
    error.value = ''
  } catch (err) {
    // Invariant: stale async failures should be ignored for the same reason as stale successes.
    if (requestId !== renderRequestId) return
    target.innerHTML = ''
    renderedSvg.value = ''
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
  const root = document.documentElement
  themeObserver = new MutationObserver(() => {
    void renderPreview()
  })
  themeObserver.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] })
  const fonts = documentFonts()
  if (fonts?.addEventListener) {
    fontsReadyHandler = () => {
      void renderPreview()
    }
    fonts.addEventListener('loadingdone', fontsReadyHandler)
    fonts.addEventListener('loadingerror', fontsReadyHandler)
  }
  consumeAutoEdit()
  void renderPreview()
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  const fonts = documentFonts()
  if (fonts?.removeEventListener && fontsReadyHandler) {
    fonts.removeEventListener('loadingdone', fontsReadyHandler)
    fonts.removeEventListener('loadingerror', fontsReadyHandler)
  }
  fontsReadyHandler = null
})

watch(code, () => {
  void nextTick().then(renderPreview)
})

watch(() => props.node.attrs.autoEdit, () => {
  consumeAutoEdit()
})

function onPreviewClick(event: MouseEvent) {
  if (!props.editor.isEditable) return
  event.preventDefault()
  event.stopPropagation()
  openCodeEditor()
}

function onPreviewPointerDown(event: MouseEvent) {
  onPreviewClick(event)
}

function onEditorToggle(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  if (showCodeEditor.value) {
    showCodeEditor.value = false
    return
  }
  openCodeEditor()
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

function openZoomModal(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  if (!renderedSvg.value || error.value) return
  props.extension.options?.openPreview?.({
    svg: renderedSvg.value,
    code: code.value,
    templateId: currentTemplateId.value || 'mermaid'
  })
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
      <div class="tomosona-mermaid-actions">
        <UiFilterableDropdown
          v-if="editor.isEditable"
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
          @mousedown.stop.prevent="openZoomModal($event)"
        >
          Zoom
        </button>
        <button
          v-if="editor.isEditable"
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
  /* Keeps the native caret visible for the bar cursor style and while the
     block-cursor overlay is inactive (see useTextareaBlockCursor). */
  caret-color: var(--editor-textarea-caret);
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
