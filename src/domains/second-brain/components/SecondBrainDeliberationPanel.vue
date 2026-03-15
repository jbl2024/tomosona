<script setup lang="ts">
import type { SecondBrainMessage } from '../../../shared/api/apiTypes'
import type { SecondBrainModeSpec } from '../lib/secondBrainModes'
import { inlineTextToHtml } from '../../editor/lib/markdownBlocks'
import { sanitizeHtmlForPreview } from '../../../shared/lib/htmlSanitizer'
import SecondBrainModeSelector from './SecondBrainModeSelector.vue'

const props = defineProps<{
  messages: SecondBrainMessage[]
  mode: string
  messageInput: string
  modes: SecondBrainModeSpec[]
  sending: boolean
  sendError: string
  resolveMessageContent: (message: SecondBrainMessage) => string
  citationsByMessageId: Record<string, string[]>
}>()

const emit = defineEmits<{
  'update:mode': [value: string]
  'update:message-input': [value: string]
  send: []
  'append-to-draft': [messageId: string]
  'open-citation': [path: string]
}>()

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const htmlParts: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let listKind: 'ul' | 'ol' | null = null
  let blockquote: string[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let inTable = false
  let tableLines: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    htmlParts.push(`<p>${inlineTextToHtml(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (!listKind || !listItems.length) return
    htmlParts.push(`<${listKind}>${listItems.join('')}</${listKind}>`)
    listKind = null
    listItems = []
  }

  const flushBlockquote = () => {
    if (!blockquote.length) return
    htmlParts.push(`<blockquote><p>${inlineTextToHtml(blockquote.join('<br>'))}</p></blockquote>`)
    blockquote = []
  }

  const flushCode = () => {
    if (!inCode) return
    const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
    htmlParts.push(`<pre><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    inCode = false
    codeLang = ''
    codeLines = []
  }

  const flushTable = () => {
    if (!inTable || tableLines.length < 2) {
      inTable = false
      tableLines = []
      return
    }
    const separatorIndex = tableLines.findIndex(line => /^\|[\s\-:|]+\|$/.test(line.trim()))
    if (separatorIndex < 1) {
      inTable = false
      tableLines = []
      return
    }
    const headerLine = tableLines[0]
    const bodyLines = tableLines.slice(separatorIndex + 1)
    const parseRow = (line: string) => {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
      return cells
    }
    const headerCells = parseRow(headerLine)
    const alignments = parseRow(tableLines[separatorIndex]).map(cell => {
      const trimmed = cell.trim()
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
      if (trimmed.endsWith(':')) return 'right'
      return 'left'
    })
    let tableHtml = '<table><thead><tr>'
    headerCells.forEach((cell, i) => {
      const align = alignments[i] || 'left'
      const alignAttr = align === 'left' ? '' : ` align="${align}"`
      tableHtml += `<th${alignAttr}>${inlineTextToHtml(cell)}</th>`
    })
    tableHtml += '</tr></thead><tbody>'
    for (const rowLine of bodyLines) {
      const cells = parseRow(rowLine)
      tableHtml += '<tr>'
      cells.forEach((cell, i) => {
        const align = alignments[i] || 'left'
        const alignAttr = align === 'left' ? '' : ` align="${align}"`
        tableHtml += `<td${alignAttr}>${inlineTextToHtml(cell)}</td>`
      })
      tableHtml += '</tr>'
    }
    tableHtml += '</tbody></table>'
    htmlParts.push(tableHtml)
    inTable = false
    tableLines = []
  }

  for (const line of lines) {
    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/)
    if (fence) {
      if (inCode) {
        flushCode()
      } else {
        flushParagraph()
        flushList()
        flushBlockquote()
        inCode = true
        codeLang = fence[1] ?? ''
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      flushBlockquote()
      flushTable()
      continue
    }

    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|')
    if (isTableRow) {
      if (!inTable) {
        flushParagraph()
        flushList()
        flushBlockquote()
        inTable = true
        tableLines = []
      }
      tableLines.push(line.trim())
      continue
    }

    if (inTable) {
      flushTable()
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      flushBlockquote()
      const level = heading[1].length
      htmlParts.push(`<h${level}>${inlineTextToHtml(heading[2])}</h${level}>`)
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blockquote.push(quote[1] ?? '')
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    if (unordered) {
      flushParagraph()
      flushBlockquote()
      if (listKind !== 'ul') {
        flushList()
        listKind = 'ul'
      }
      listItems.push(`<li>${inlineTextToHtml(unordered[1])}</li>`)
      continue
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      flushBlockquote()
      if (listKind !== 'ol') {
        flushList()
        listKind = 'ol'
      }
      listItems.push(`<li>${inlineTextToHtml(ordered[1])}</li>`)
      continue
    }

    flushList()
    flushBlockquote()
    paragraph.push(line.trim())
  }

  flushParagraph()
  flushList()
  flushBlockquote()
  flushCode()
  flushTable()

  const html = htmlParts.join('')
  return sanitizeHtmlForPreview(html || `<p>${inlineTextToHtml(source)}</p>`)
}

function renderAssistantContent(message: SecondBrainMessage): string {
  return renderMarkdown(props.resolveMessageContent(message))
}
</script>

<template>
  <section class="sb-deliberation">
    <div class="sb-controls">
      <SecondBrainModeSelector :modes="modes" :model-value="mode" @update:model-value="emit('update:mode', $event)" />
    </div>

    <div class="sb-thread">
      <article v-for="message in messages" :key="message.id" class="sb-msg" :class="`sb-msg-${message.role}`">
        <header>
          <strong>{{ message.role === 'user' ? 'Vous' : 'IA' }}</strong>
          <button v-if="message.role === 'assistant'" type="button" class="sb-mini-btn" @click="emit('append-to-draft', message.id)">
            Ajouter au brouillon
          </button>
        </header>
        <pre v-if="message.role === 'user'">{{ resolveMessageContent(message) }}</pre>
        <div v-else class="sb-msg-content" v-html="renderAssistantContent(message)"></div>
        <div v-if="message.role === 'assistant'" class="sb-citations">
          <button
            v-for="path in (citationsByMessageId[message.id] || [])"
            :key="`${message.id}-${path}`"
            type="button"
            class="sb-citation"
            @click="emit('open-citation', path)"
          >
            {{ path }}
          </button>
        </div>
      </article>
      <p v-if="!messages.length" class="sb-empty">Demarrez une deliberation.</p>
    </div>

    <div class="sb-input-row">
      <textarea
        :value="messageInput"
        class="sb-textarea"
        placeholder="Posez une question contextualisee..."
        @input="emit('update:message-input', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <button type="button" class="sb-btn" :disabled="sending" @click="emit('send')">
        {{ sending ? 'Envoi...' : 'Envoyer' }}
      </button>
      <p v-if="sendError" class="sb-error">{{ sendError }}</p>
    </div>
  </section>
</template>

<style scoped>
.sb-deliberation {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  min-height: 0;
  height: 100%;
}
.sb-thread {
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-thread-bg);
  color: var(--sb-text);
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sb-msg {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  padding: 8px;
}
.sb-msg header {
  display: flex;
  justify-content: space-between;
}
.sb-msg pre {
  margin: 6px 0;
  white-space: pre-wrap;
  font-size: 12px;
}
.sb-msg-content {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.5;
}
.sb-msg-content p {
  margin: 0 0 6px;
}
.sb-msg-content p:last-child {
  margin-bottom: 0;
}
.sb-msg-content h1,
.sb-msg-content h2,
.sb-msg-content h3,
.sb-msg-content h4,
.sb-msg-content h5,
.sb-msg-content h6 {
  margin: 8px 0 5px;
  line-height: 1.3;
  font-weight: 700;
}
.sb-msg-content ul,
.sb-msg-content ol {
  margin: 5px 0 6px;
  padding-left: 18px;
}
.sb-msg-content ul {
  list-style: disc outside;
}
.sb-msg-content ol {
  list-style: decimal outside;
}
.sb-msg-content li {
  margin: 1px 0;
}
.sb-msg-content ul ul {
  list-style-type: circle;
}
.sb-msg-content ol ol {
  list-style-type: lower-alpha;
}
.sb-msg-content blockquote {
  margin: 5px 0 6px;
  border-left: 3px solid var(--sb-blockquote-border);
  padding: 2px 0 2px 10px;
  color: var(--sb-text-soft);
}
.sb-msg-content code {
  font-family: var(--font-code);
  background: var(--sb-code-bg);
  border-radius: 4px;
  padding: 1px 4px;
}
.sb-msg-content pre {
  margin: 6px 0;
  background: var(--sb-code-bg);
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  padding: 6px;
  overflow: auto;
}
.sb-msg-content pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.sb-msg-content a {
  color: var(--sb-active-text);
  text-decoration: underline;
}
.sb-msg-content table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}
.sb-msg-content th,
.sb-msg-content td {
  border: 1px solid var(--sb-input-border);
  padding: 4px 8px;
}
.sb-msg-content th {
  background: var(--sb-code-bg);
  font-weight: 600;
}
.sb-msg-user {
  background: var(--sb-user-bg);
}
.sb-msg-assistant {
  background: var(--sb-assistant-bg);
}
.sb-citations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sb-citation,
.sb-mini-btn,
.sb-btn {
  border: 1px solid var(--sb-button-border);
  border-radius: 8px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  font-size: 11px;
  padding: 4px 8px;
}
.sb-input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-textarea {
  width: 100%;
  min-height: 88px;
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  font-size: 12px;
  padding: 8px;
  resize: vertical;
}
.sb-empty {
  margin: 0;
  color: var(--sb-text-dim);
  font-size: 12px;
}
.sb-error {
  margin: 0;
  color: var(--sb-danger-text);
  font-size: 12px;
}
</style>
