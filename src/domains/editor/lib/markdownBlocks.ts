import { normalizeCalloutKind } from './callouts'
import { parseWikilinkTarget } from './wikilinks'

export type EditorBlock = {
  id?: string
  type: string
  data: Record<string, unknown>
}

export type EditorDocument = {
  time: number
  blocks: EditorBlock[]
  version: string
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const ORDERED_LIST_RE = /^\s*\d+\.\s+(.+)$/
const UNORDERED_LIST_RE = /^\s*[-*+]\s+(.+)$/
const TASK_LIST_RE = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const FENCE_START_RE = /^```\s*([^`]*)$/
const CALLOUT_MARKER_RE = /^\[!([A-Za-z0-9_-]+)\]\s*(.*)$/
const HTML_OPEN_TAG_START_RE = /^\s*<([A-Za-z][\w:-]*)(?:\s[^>]*)?>/
const HTML_CLOSE_TAG_START_RE = /^\s*<\/([A-Za-z][\w:-]*)\s*>/
const HTML_COMMENT_RE = /^\s*<!--[\s\S]*?-->\s*$/
const HTML_DOCTYPE_RE = /^\s*<!DOCTYPE\s+html[^>]*>\s*$/i
const HTML_TAG_TOKEN_RE = /<\/?([A-Za-z][\w:-]*)(?:\s[^>]*?)?>/g
const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])
const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'canvas',
  'center',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul'
])

type RichListItem = {
  content?: string
  meta?: { checked?: boolean }
  items?: RichListItem[]
}

type ListStyle = 'ordered' | 'unordered' | 'checklist'
type TableAlign = 'left' | 'center' | 'right' | null

const TABLE_WIDTHS_LINE_RE = /^\{widths:\s*([^}]*)\s*\}$/i

function normalizeInput(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function extractCodeSpans(value: string): { text: string; tokens: string[] } {
  const tokens: string[] = []
  let out = ''
  let i = 0

  while (i < value.length) {
    if (value[i] !== '`') {
      out += value[i]
      i += 1
      continue
    }

    let markerLength = 1
    while (i + markerLength < value.length && value[i + markerLength] === '`') {
      markerLength += 1
    }

    const marker = '`'.repeat(markerLength)
    const closeIndex = value.indexOf(marker, i + markerLength)
    if (closeIndex === -1) {
      out += marker
      i += markerLength
      continue
    }

    const content = value.slice(i + markerLength, closeIndex)
    const token = `\u0000MDCODE${tokens.length}\u0000`
    tokens.push(`<code class="inline-code">${escapeHtml(content)}</code>`)
    out += token
    i = closeIndex + markerLength
  }

  return { text: out, tokens }
}

function extractUnderlineSpans(value: string): { text: string; tokens: string[] } {
  const tokens: string[] = []
  // Detects raw underline HTML spans, e.g. "<u>important</u>".
  const text = value.replace(/<u>([\s\S]*?)<\/u>/gi, (_full: string, inner: string) => {
    const token = `\u0000MDUNDERLINE${tokens.length}\u0000`
    tokens.push(`<u>${parseInlineSegment(inner)}</u>`)
    return token
  })
  return { text, tokens }
}

function parseInlineSegment(value: string): string {
  if (!value) return ''

  const escapes: string[] = []
  const escapedValue = value.replace(/\\([\\`*_~[\](){}#+\-.!|])/g, (_, ch: string) => {
    const token = `\u0000MDESC${escapes.length}\u0000`
    escapes.push(escapeHtml(ch))
    return token
  })

  const { text: codeProtected, tokens: codeTokens } = extractCodeSpans(escapedValue)
  const { text: underlineProtected, tokens: underlineTokens } = extractUnderlineSpans(codeProtected)
  let html = escapeHtml(underlineProtected)

  html = html.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
  html = html.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
  // Keep intraword underscores (for example note_path/file_name) as plain text.
  html = html.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_((?=[^\w])|$)/g, '$1<em>$2</em>')

  codeTokens.forEach((tokenHtml, index) => {
    html = html.split(`\u0000MDCODE${index}\u0000`).join(tokenHtml)
  })
  underlineTokens.forEach((tokenHtml, index) => {
    html = html.split(`\u0000MDUNDERLINE${index}\u0000`).join(tokenHtml)
  })
  escapes.forEach((escapedChar, index) => {
    html = html.split(`\u0000MDESC${index}\u0000`).join(escapedChar)
  })

  return html
}

function inlineMarkdownToHtml(value: string): string {
  const tokenRe = /\[\[([^\|\]\n]+)(?:\|([^\|\]\n]*))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g
  const tokens: string[] = []
  let expanded = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(value)) !== null) {
    const full = match[0]
    const index = match.index
    const isEscaped = index > 0 && value[index - 1] === '\\'

    if (isEscaped) {
      continue
    }

    expanded += value.slice(lastIndex, index)
    if (match[1]) {
      const target = match[1].trim()
      const alias = (match[2] ?? '').trim()
      const parsed = parseWikilinkTarget(target)
      const defaultLabel = parsed.anchor?.heading && !parsed.notePath ? parsed.anchor.heading : target
      const label = alias || defaultLabel
      if (!target) {
        expanded += full
      } else {
        const href = `wikilink:${encodeURIComponent(target)}`
        const token = `\u0000MDLINK${tokens.length}\u0000`
        tokens.push(`<a href="${escapeHtml(href)}" data-wikilink-target="${escapeHtml(target)}">${parseInlineSegment(label)}</a>`)
        expanded += token
      }
    } else {
      const text = match[3]
      const href = match[4]
      const safeHref = sanitizeExternalHref(href)
      if (safeHref) {
        const token = `\u0000MDLINK${tokens.length}\u0000`
        tokens.push(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${parseInlineSegment(text)}</a>`)
        expanded += token
      } else {
        expanded += full
      }
    }
    lastIndex = index + full.length
  }

  expanded += value.slice(lastIndex)
  let html = parseInlineSegment(expanded)
  tokens.forEach((tokenHtml, index) => {
    html = html.split(`\u0000MDLINK${index}\u0000`).join(tokenHtml)
  })
  return html
}

export function inlineTextToHtml(value: string): string {
  return inlineMarkdownToHtml(value)
}

export function sanitizeExternalHref(raw: string): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null

  try {
    const parsed = new URL(value, 'https://tomosona.local')
    const protocol = parsed.protocol.toLowerCase()
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      if (!parsed.hostname && protocol !== 'mailto:') return null
      return value
    }
  } catch {
    return null
  }

  return null
}

function blockTextToHtml(value: string): string {
  return inlineMarkdownToHtml(value).replace(/\n/g, '<br>')
}

function elementToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()
  const children = Array.from(element.childNodes).map(elementToMarkdown).join('')

  if (tag === 'br') return '\n'
  if (tag === 'strong' || tag === 'b') return `**${children}**`
  if (tag === 'em' || tag === 'i') return `*${children}*`
  if (tag === 's' || tag === 'strike') return `~~${children}~~`
  if (tag === 'u') return `<u>${children}</u>`
  if (tag === 'code') return `\`${children.replace(/`/g, '\\`')}\``

  if (tag === 'a') {
    const href = element.getAttribute('href')?.trim() ?? ''
    const wikilinkTarget = (() => {
      const dataTargetAlias = element.getAttribute('data-target')?.trim()
      if (dataTargetAlias) return dataTargetAlias
      const dataTarget = element.getAttribute('data-wikilink-target')?.trim()
      if (dataTarget) return dataTarget
      if (href.toLowerCase().startsWith('wikilink:')) {
        try {
          return decodeURIComponent(href.slice('wikilink:'.length)).trim()
        } catch {
          return ''
        }
      }
      if (href === '#') {
        return children.trim()
      }
      return ''
    })()

    if (wikilinkTarget) {
      const label = children.trim()
      const parsed = parseWikilinkTarget(wikilinkTarget)
      const defaultLabel = parsed.anchor?.heading && !parsed.notePath ? parsed.anchor.heading : wikilinkTarget
      if (label && label !== defaultLabel) {
        return `[[${wikilinkTarget}|${label}]]`
      }
      return `[[${wikilinkTarget}]]`
    }

    if (href) return `[${children}](${href})`
  }

  return children
}

function inlineHtmlToMarkdown(value: unknown): string {
  const html = String(value ?? '')
  if (!html.trim()) return ''

  const container = document.createElement('div')
  container.innerHTML = html
  return Array.from(container.childNodes).map(elementToMarkdown).join('')
}

function inlineNodesToMarkdown(nodes: Node[]): string {
  return nodes.map(elementToMarkdown).join('')
}

function markdownLinesWithPrefix(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n')
}

function hasDirectBlockChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) => {
    const tag = child.tagName.toLowerCase()
    return /^(h[1-6]|p|div|blockquote|pre|ul|ol|table)$/.test(tag)
  })
}

function detectCodeLanguage(element: HTMLElement): string {
  const ownClass = element.className ?? ''
  const nestedCode = element.querySelector('code')
  const nestedClass = nestedCode?.className ?? ''
  const match = `${ownClass} ${nestedClass}`.match(/(?:lang|language)-([A-Za-z0-9_-]+)/i)
  return (match?.[1] ?? '').trim()
}

function markdownFromCodeBlock(element: HTMLElement): string {
  const codeElement = element.tagName.toLowerCase() === 'code' ? element : element.querySelector('code')
  const language = detectCodeLanguage(element)
  const raw = (codeElement?.textContent ?? element.textContent ?? '').replace(/\r\n?/g, '\n')
  const code = raw.replace(/\n+$/g, '')
  return `\`\`\`${language}\n${code}\n\`\`\``
}

function markdownFromTable(table: HTMLTableElement): string {
  const trElements = Array.from(table.querySelectorAll('tr'))
  if (!trElements.length) return ''

  const rows = trElements
    .map((row) => {
      const cells = Array.from(row.children).filter((cell) => {
        const tag = cell.tagName.toLowerCase()
        return tag === 'th' || tag === 'td'
      })
      return cells.map((cell) => normalizeMultiline(inlineNodesToMarkdown(Array.from(cell.childNodes))))
    })
    .filter((cells) => cells.length > 0)

  if (!rows.length) return ''

  const columnCount = Math.max(2, ...rows.map((row) => row.length))
  const padded = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''))
  const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
  const lineForRow = (row: string[]) => `| ${row.map((cell) => escapeCell(cell)).join(' | ')} |`
  const alignments = Array.from({ length: columnCount }, (_, index) => {
    const firstCell = trElements[0]?.children?.item(index) as HTMLElement | null
    const raw = (firstCell?.style.textAlign || firstCell?.getAttribute('data-align') || '').trim().toLowerCase()
    if (raw === 'left' || raw === 'center' || raw === 'right') return raw as TableAlign
    return null
  })

  const header = padded[0]
  const separator = `| ${alignments.map((align) => tableSeparatorCell(align)).join(' | ')} |`
  const body = padded.slice(1).map(lineForRow)
  return [lineForRow(header), separator, ...body].join('\n')
}

function markdownFromList(list: HTMLElement, depth = 0): string[] {
  const ordered = list.tagName.toLowerCase() === 'ol'
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li') as HTMLLIElement[]
  const lines: string[] = []

  items.forEach((item, index) => {
    const nestedLists = Array.from(item.children).filter((child) => {
      const tag = child.tagName.toLowerCase()
      return tag === 'ul' || tag === 'ol'
    })
    const inlineNodes = Array.from(item.childNodes).filter((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return true
      const tag = (node as HTMLElement).tagName.toLowerCase()
      return tag !== 'ul' && tag !== 'ol'
    })

    const checkbox = inlineNodes.find(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).tagName.toLowerCase() === 'input' &&
        ((node as HTMLInputElement).type ?? '').toLowerCase() === 'checkbox'
    ) as HTMLInputElement | undefined
    const contentNodes = checkbox ? inlineNodes.filter((node) => node !== checkbox) : inlineNodes
    const content = normalizeMultiline(inlineNodesToMarkdown(contentNodes)).trim()
    const marker = checkbox
      ? `- [${checkbox.checked ? 'x' : ' '}] `
      : ordered
        ? `${index + 1}. `
        : '- '
    lines.push(`${'  '.repeat(depth)}${marker}${content}`)

    nestedLists.forEach((nested) => {
      lines.push(...markdownFromList(nested as HTMLElement, depth + 1))
    })
  })

  return lines
}

function markdownFromStandaloneListItem(item: HTMLLIElement, depth = 0): string {
  const nestedLists = Array.from(item.children).filter((child) => {
    const tag = child.tagName.toLowerCase()
    return tag === 'ul' || tag === 'ol'
  })
  const inlineNodes = Array.from(item.childNodes).filter((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return true
    const tag = (node as HTMLElement).tagName.toLowerCase()
    return tag !== 'ul' && tag !== 'ol'
  })
  const checkbox = inlineNodes.find(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName.toLowerCase() === 'input' &&
      ((node as HTMLInputElement).type ?? '').toLowerCase() === 'checkbox'
  ) as HTMLInputElement | undefined
  const contentNodes = checkbox ? inlineNodes.filter((node) => node !== checkbox) : inlineNodes
  const content = normalizeMultiline(inlineNodesToMarkdown(contentNodes)).trim()
  const marker = checkbox ? `- [${checkbox.checked ? 'x' : ' '}] ` : '- '
  const lines = [`${'  '.repeat(depth)}${marker}${content}`]
  nestedLists.forEach((nested) => {
    lines.push(...markdownFromList(nested as HTMLElement, depth + 1))
  })
  return lines.join('\n')
}

function nodesToClipboardMarkdownBlocks(nodes: Node[]): string[] {
  const blocks: string[] = []

  const pushIfNotEmpty = (value: string) => {
    const normalized = normalizeMultiline(value)
    if (normalized) blocks.push(normalized)
  }

  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeMultiline(node.textContent ?? '')
      if (text) blocks.push(text)
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1))
      const text = normalizeMultiline(inlineNodesToMarkdown(Array.from(element.childNodes)))
      if (text) blocks.push(`${'#'.repeat(level)} ${text}`)
      return
    }

    if (tag === 'pre') {
      pushIfNotEmpty(markdownFromCodeBlock(element))
      return
    }

    if (tag === 'code') {
      pushIfNotEmpty(markdownFromCodeBlock(element))
      return
    }

    if (tag === 'ul' || tag === 'ol') {
      const lines = markdownFromList(element)
      if (lines.length) blocks.push(lines.join('\n'))
      return
    }

    if (tag === 'li') {
      const line = markdownFromStandaloneListItem(element as HTMLLIElement)
      if (line) blocks.push(line)
      return
    }

    if (tag === 'blockquote') {
      const innerBlocks = nodesToClipboardMarkdownBlocks(Array.from(element.childNodes))
      const nestedContent = normalizeMultiline(innerBlocks.join('\n\n'))
      if (nestedContent) blocks.push(markdownLinesWithPrefix(nestedContent, '> '))
      return
    }

    if (tag === 'table') {
      pushIfNotEmpty(markdownFromTable(element as HTMLTableElement))
      return
    }

    if (tag === 'br') {
      return
    }

    if (tag === 'p') {
      pushIfNotEmpty(inlineNodesToMarkdown(Array.from(element.childNodes)))
      return
    }

    if (tag === 'div' && hasDirectBlockChildren(element)) {
      const nested = nodesToClipboardMarkdownBlocks(Array.from(element.childNodes))
      nested.forEach((value) => blocks.push(value))
      return
    }

    // Keep inline root nodes (e.g. bare <a>, <strong>) instead of dropping
    // their own tag semantics by only serializing children.
    pushIfNotEmpty(inlineNodesToMarkdown([element]))
  })

  return blocks
}

export function clipboardHtmlToMarkdown(html: string): string {
  const raw = String(html ?? '')
  if (!raw.trim()) return ''

  const container = document.createElement('div')
  container.innerHTML = raw
  const blocks = nodesToClipboardMarkdownBlocks(Array.from(container.childNodes))
  if (!blocks.length) return ''
  return `${normalizeMultiline(blocks.join('\n\n'))}\n`
}

function normalizeLine(line: string): string {
  return line.replace(/[ \t]+$/g, '')
}

function normalizeMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function isRawFallbackStart(line: string): boolean {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('|')) return true
  return false
}

function firstHtmlTagName(line: string): string | null {
  const opening = line.match(HTML_OPEN_TAG_START_RE)?.[1]
  if (opening) return opening.toLowerCase()
  const closing = line.match(HTML_CLOSE_TAG_START_RE)?.[1]
  if (closing) return closing.toLowerCase()
  return null
}

function isHtmlishLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return (
    HTML_OPEN_TAG_START_RE.test(trimmed) ||
    HTML_CLOSE_TAG_START_RE.test(trimmed) ||
    HTML_COMMENT_RE.test(trimmed) ||
    HTML_DOCTYPE_RE.test(trimmed)
  )
}

function isHtmlBlockStart(line: string): boolean {
  if (!isHtmlishLine(line)) return false
  const tag = firstHtmlTagName(line)
  if (!tag) return true
  return HTML_BLOCK_TAGS.has(tag)
}

function htmlDepthDelta(line: string): number {
  let depth = 0
  HTML_TAG_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HTML_TAG_TOKEN_RE.exec(line)) !== null) {
    const token = match[0]
    const tag = match[1]?.toLowerCase() ?? ''
    if (!tag || HTML_VOID_TAGS.has(tag)) continue
    if (token.startsWith('</')) {
      depth -= 1
      continue
    }
    if (!token.endsWith('/>')) {
      depth += 1
    }
  }
  return depth
}

function parseHtmlBlock(lines: string[], start: number): { html: string; next: number } {
  const htmlLines: string[] = []
  let depth = 0
  let i = start

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      if (depth > 0) {
        htmlLines.push(line)
        i += 1
        continue
      }
      break
    }

    if (depth <= 0 && i > start && !isHtmlishLine(line)) {
      break
    }

    htmlLines.push(line)
    depth += htmlDepthDelta(line)
    i += 1
  }

  return {
    html: normalizeMultiline(htmlLines.join('\n')),
    next: i
  }
}

function parseTableCells(line: string, options?: { allowEmptyRow?: boolean }): string[] | null {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.includes('|')) return null
  if (!trimmed.startsWith('|') && !trimmed.endsWith('|')) return null

  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let wikilinkDepth = 0

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    const next = inner[i + 1] ?? ''

    if (ch === '\\' && next === '|') {
      current += '|'
      i += 1
      continue
    }

    if (ch === '[' && next === '[') {
      wikilinkDepth += 1
      current += '[['
      i += 1
      continue
    }

    if (ch === ']' && next === ']' && wikilinkDepth > 0) {
      wikilinkDepth -= 1
      current += ']]'
      i += 1
      continue
    }

    if (ch === '|' && wikilinkDepth === 0) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  cells.push(current.trim())
  if (!cells.length) return null
  if (!options?.allowEmptyRow && cells.every((cell) => cell.length === 0)) return null
  return cells
}

function tableSeparatorCell(align: TableAlign): string {
  if (align === 'left') return ':---'
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

function parseTableSeparatorAlignments(line: string, expectedColumns: number): TableAlign[] | null {
  const cells = parseTableCells(line)
  if (!cells || cells.length !== expectedColumns) return null
  const parsed: TableAlign[] = []
  for (const cell of cells) {
    const normalized = cell.replace(/\s+/g, '')
    if (!/^:?-+:?$/.test(normalized)) return null
    const starts = normalized.startsWith(':')
    const ends = normalized.endsWith(':')
    parsed.push(starts && ends ? 'center' : starts ? 'left' : ends ? 'right' : null)
  }
  return parsed
}

function parseTableWidthsLine(line: string, expectedColumns: number): Array<number | null> | null {
  const match = line.trim().match(TABLE_WIDTHS_LINE_RE)
  if (!match) return null
  const raw = match[1] ?? ''
  const parts = raw.split(',').map((part) => part.trim())
  if (!parts.length) return null
  const parsed = Array.from({ length: expectedColumns }, (_, index) => {
    const token = parts[index] ?? ''
    if (!token) return null
    const numeric = Number.parseFloat(token.replace(/%$/, ''))
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    return numeric
  })
  const defined = parsed.filter((value): value is number => typeof value === 'number')
  if (!defined.length) return parsed

  const sum = defined.reduce((acc, value) => acc + value, 0)
  const shouldNormalizeAsWeights = sum > 100 || defined.some((value) => value > 100)
  if (!shouldNormalizeAsWeights) {
    return parsed.map((value) => (value === null ? null : Math.max(1, Math.round(value))))
  }

  return parsed.map((value) => (value === null ? null : Math.max(1, Math.round((value / sum) * 100))))
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  const header = parseTableCells(lines[index], { allowEmptyRow: true })
  if (!header || header.length < 2) return false
  return Boolean(parseTableSeparatorAlignments(lines[index + 1], header.length))
}

function isBlockStarter(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    FENCE_START_RE.test(line) ||
    line.startsWith('>') ||
    ORDERED_LIST_RE.test(line) ||
    UNORDERED_LIST_RE.test(line)
  )
}

function indentWidth(raw: string): number {
  let width = 0
  for (const ch of raw) width += ch === '\t' ? 2 : 1
  return width
}

function parseListLine(
  line: string,
  style: ListStyle
): { indent: number; content: string; checked?: boolean } | null {
  if (style === 'ordered') {
    const match = line.match(/^(\s*)\d+\.\s+(.+)$/)
    if (!match) return null
    return { indent: indentWidth(match[1]), content: match[2].trim() }
  }

  if (style === 'checklist') {
    const match = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/)
    if (!match) return null
    return {
      indent: indentWidth(match[1]),
      content: match[3].trim(),
      checked: match[2].toLowerCase() === 'x'
    }
  }

  const match = line.match(/^(\s*)[-*+]\s+(?!\[[ xX]\]\s*)(.+)$/)
  if (!match) return null
  return { indent: indentWidth(match[1]), content: match[2].trim() }
}

function parseRichList(lines: string[], start: number, style: ListStyle): { items: RichListItem[]; next: number } {
  const items: RichListItem[] = []
  const stack: Array<{ indent: number; items: RichListItem[] }> = [{ indent: -1, items }]
  let i = start

  while (i < lines.length) {
    const parsed = parseListLine(lines[i], style)
    if (!parsed) break

    while (stack.length > 1 && parsed.indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const item: RichListItem = {
      content: blockTextToHtml(parsed.content),
      items: []
    }
    if (style === 'checklist') {
      item.meta = { checked: Boolean(parsed.checked) }
    }

    const parent = stack[stack.length - 1]
    parent.items.push(item)
    stack.push({ indent: parsed.indent, items: item.items as RichListItem[] })
    i += 1
  }

  return { items, next: i }
}

export function markdownToEditorData(markdown: string): EditorDocument {
  const normalized = normalizeInput(markdown)
  const lines = normalized.split('\n')
  const blocks: EditorBlock[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      blocks.push({
        type: 'header',
        data: {
          level: headingMatch[1].length,
          text: blockTextToHtml(headingMatch[2].trim())
        }
      })
      i += 1
      continue
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'delimiter', data: {} })
      i += 1
      continue
    }

    const fenceMatch = line.match(FENCE_START_RE)
    if (fenceMatch) {
      const language = (fenceMatch[1] ?? '').trim()
      i += 1
      const codeLines: string[] = []
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length && /^```\s*$/.test(lines[i])) i += 1

      if (language.toLowerCase() === 'mermaid') {
        blocks.push({
          type: 'mermaid',
          data: {
            code: codeLines.join('\n')
          }
        })
        continue
      }

      blocks.push({
        type: 'code',
        data: {
          code: codeLines.join('\n'),
          language
        }
      })
      continue
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }

      const calloutMarker = quoteLines[0]?.trim().match(CALLOUT_MARKER_RE)
      if (calloutMarker) {
        const typeToken = normalizeCalloutKind(calloutMarker[1])
        const lead = calloutMarker[2].trim()
        const messageLines = lead ? [lead, ...quoteLines.slice(1)] : quoteLines.slice(1)
        blocks.push({
          type: 'callout',
          data: {
            kind: typeToken,
            message: normalizeMultiline(messageLines.join('\n'))
          }
        })
        continue
      }

      blocks.push({
        type: 'quote',
        data: {
          text: normalizeMultiline(quoteLines.join('\n'))
        }
      })
      continue
    }

    if (isMarkdownTableStart(lines, i)) {
      const header = (parseTableCells(lines[i], { allowEmptyRow: true }) ?? []).map((cell) => blockTextToHtml(cell))
      const align = parseTableSeparatorAlignments(lines[i + 1], header.length) ?? Array.from({ length: header.length }, () => null)
      const rows: string[][] = [header]
      i += 2

      while (i < lines.length) {
        const row = parseTableCells(lines[i], { allowEmptyRow: true })
        if (!row) break
        rows.push(row.map((cell) => blockTextToHtml(cell)))
        i += 1
      }
      const columnCount = Math.max(2, ...rows.map((row) => row.length))
      const normalizedAlign = Array.from({ length: columnCount }, (_, index) => align[index] ?? null)
      const widths = i < lines.length ? parseTableWidthsLine(lines[i], columnCount) : null
      if (widths) i += 1

      blocks.push({
        type: 'table',
        data: {
          withHeadings: true,
          content: rows,
          ...(normalizedAlign.some((item) => item !== null) ? { align: normalizedAlign } : {}),
          ...(widths && widths.some((item) => item !== null) ? { widths } : {})
        }
      })
      continue
    }

    if (ORDERED_LIST_RE.test(line)) {
      const parsed = parseRichList(lines, i, 'ordered')
      blocks.push({ type: 'list', data: { style: 'ordered', items: parsed.items } })
      i = parsed.next
      continue
    }

    if (TASK_LIST_RE.test(line)) {
      const parsed = parseRichList(lines, i, 'checklist')
      blocks.push({ type: 'list', data: { style: 'checklist', items: parsed.items } })
      i = parsed.next
      continue
    }

    if (UNORDERED_LIST_RE.test(line) && !TASK_LIST_RE.test(line)) {
      const parsed = parseRichList(lines, i, 'unordered')
      blocks.push({ type: 'list', data: { style: 'unordered', items: parsed.items } })
      i = parsed.next
      continue
    }

    if (line.startsWith('    ') || line.startsWith('\t')) {
      const codeLines: string[] = []
      while (i < lines.length && lines[i].trim()) {
        const current = lines[i]
        if (current.startsWith('    ')) {
          codeLines.push(current.slice(4))
        } else if (current.startsWith('\t')) {
          codeLines.push(current.slice(1))
        } else {
          codeLines.push(current)
        }
        i += 1
      }
      blocks.push({
        type: 'code',
        data: {
          code: codeLines.join('\n'),
          language: ''
        }
      })
      continue
    }

    if (isHtmlBlockStart(line)) {
      const parsed = parseHtmlBlock(lines, i)
      if (parsed.html) {
        blocks.push({ type: 'html', data: { html: parsed.html } })
        i = parsed.next
        continue
      }
    }

    if (isRawFallbackStart(line)) {
      const rawLines: string[] = []
      while (i < lines.length && lines[i].trim()) {
        rawLines.push(lines[i])
        i += 1
      }
      blocks.push({ type: 'raw', data: { markdown: rawLines.join('\n') } })
      continue
    }

    const paragraphLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isBlockStarter(lines[i]) &&
      !isHtmlBlockStart(lines[i]) &&
      !isRawFallbackStart(lines[i]) &&
      !isMarkdownTableStart(lines, i)
    ) {
      paragraphLines.push(lines[i])
      i += 1
    }

    blocks.push({ type: 'paragraph', data: { text: blockTextToHtml(paragraphLines.join('\n')) } })
  }

  return { time: Date.now(), blocks, version: '2.0.0' }
}

function normalizeParagraphMarkdown(value: unknown): string {
  return normalizeMultiline(inlineHtmlToMarkdown(value))
}

function oldListItemsToStrings(items: unknown[]): string[] {
  return items
    .map((item) => (typeof item === 'string' ? normalizeMultiline(item).trim() : ''))
    .filter(Boolean)
}

function flattenRichList(
  items: RichListItem[],
  depth: number,
  marker: 'ordered' | 'unordered' | 'checklist'
): string[] {
  const lines: string[] = []

  items.forEach((item, index) => {
    const content = normalizeParagraphMarkdown(item.content ?? '')
    const prefix =
      marker === 'ordered'
        ? `${index + 1}. `
        : marker === 'checklist'
          ? `- [${item.meta?.checked ? 'x' : ' '}] `
          : '- '
    lines.push(`${'  '.repeat(depth)}${prefix}${content}`)

    if (Array.isArray(item.items) && item.items.length) {
      lines.push(...flattenRichList(item.items, depth + 1, marker))
    }
  })

  return lines
}

function listToMarkdown(data: Record<string, unknown>): string {
  const style =
    data.style === 'ordered'
      ? 'ordered'
      : data.style === 'checklist'
        ? 'checklist'
        : 'unordered'
  const items = Array.isArray(data.items) ? data.items : []
  if (!items.length) return ''

  if (typeof items[0] === 'string') {
    const old = oldListItemsToStrings(items as unknown[])
    return old
      .map((item, index) => {
        if (style === 'ordered') return `${index + 1}. ${item}`
        if (style === 'checklist') return `- [ ] ${item}`
        return `- ${item}`
      })
      .join('\n')
  }

  return flattenRichList(items as RichListItem[], 0, style).join('\n')
}

function blockToMarkdown(block: EditorBlock): string {
  switch (block.type) {
    case 'header':
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(block.data?.level ?? 2)))
      const text = normalizeParagraphMarkdown(block.data?.text)
      return text ? `${'#'.repeat(level)} ${text}` : `${'#'.repeat(level)} `
    }

    case 'paragraph':
      return normalizeParagraphMarkdown(block.data?.text)

    case 'list':
      return listToMarkdown(block.data)

    case 'quote': {
      const text = normalizeParagraphMarkdown(block.data?.text)
      if (!text) return ''
      return text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    }

    case 'callout':
    case 'warning': {
      const rawKind = block.type === 'callout'
        ? String(block.data?.kind ?? '')
        : String(block.data?.title ?? '')
      const typeToken = normalizeCalloutKind(
        rawKind
          .toUpperCase()
          .replace(/[^A-Z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
      )
      const message = normalizeMultiline(String(block.data?.message ?? ''))
      if (!message) return `> [!${typeToken}]`
      const lines = message.split('\n').map((line) => `> ${line}`).join('\n')
      return `> [!${typeToken}]\n${lines}`
    }

    case 'table': {
      const rawRows = Array.isArray(block.data?.content) ? block.data.content : []
      const rows = rawRows
        .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []))
        .filter((row) => row.length > 0)
      if (!rows.length) return ''

      const withHeadings = Boolean(block.data?.withHeadings)
      const columnCount = Math.max(...rows.map((row) => row.length), 2)
      const pad = (row: string[]) => Array.from({ length: columnCount }, (_, idx) => row[idx] ?? '')
      const cellToMarkdown = (value: string) => normalizeParagraphMarkdown(value)
      const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>')
      const rowToLine = (row: string[]) => `| ${row.map((cell) => escapeCell(cellToMarkdown(cell))).join(' | ')} |`
      const alignRaw = Array.isArray(block.data?.align) ? block.data.align : []
      const align = Array.from({ length: columnCount }, (_, idx) => {
        const token = String(alignRaw[idx] ?? '').trim().toLowerCase()
        if (token === 'left' || token === 'center' || token === 'right') return token as TableAlign
        return null
      })
      const widthsRaw = Array.isArray(block.data?.widths) ? block.data.widths : []
      const widths = Array.from({ length: columnCount }, (_, idx) => {
        const numeric = Number.parseInt(String(widthsRaw[idx] ?? ''), 10)
        if (!Number.isFinite(numeric) || numeric <= 0) return null
        return Math.max(1, Math.min(100, numeric))
      })

      const normalizedRows = rows.map(pad)
      const header = withHeadings ? normalizedRows[0] : Array.from({ length: columnCount }, () => '')
      const bodyRows = withHeadings ? normalizedRows.slice(1) : normalizedRows
      const separator = `| ${align.map((item) => tableSeparatorCell(item)).join(' | ')} |`
      const markdownLines = [rowToLine(header), separator, ...bodyRows.map(rowToLine)]
      if (widths.some((item) => item !== null)) {
        markdownLines.push(`{widths: ${widths.map((item) => (item === null ? '' : `${item}%`)).join(',')}}`)
      }
      return markdownLines.join('\n')
    }

    case 'mermaid': {
      const code = String(block.data?.code ?? '').replace(/\r\n?/g, '\n').trim()
      return `\`\`\`mermaid\n${code}\n\`\`\``
    }

    case 'code': {
      const language = String(block.data?.language ?? '').trim()
      const code = String(block.data?.code ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
      return `\`\`\`${language}\n${code}\n\`\`\``
    }

    case 'delimiter':
      return '---'

    case 'html':
      return normalizeMultiline(String(block.data?.html ?? ''))

    case 'raw':
      return normalizeMultiline(String(block.data?.markdown ?? ''))

    default: {
      const fallback = normalizeMultiline(JSON.stringify(block.data ?? {}, null, 2))
      return fallback ? `\`\`\`json\n${fallback}\n\`\`\`` : ''
    }
  }
}

export function editorDataToMarkdown(data: { blocks?: EditorBlock[] } | null | undefined): string {
  const blocks = data?.blocks ?? []
  const lines = blocks
    .map((block) => blockToMarkdown(block))
    .map((text) => normalizeMultiline(text))
    .filter((text) => text.length > 0)

  return `${lines.join('\n\n')}\n`
}
