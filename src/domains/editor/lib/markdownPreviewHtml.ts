/**
 * Module: markdownPreviewHtml
 *
 * Renders note markdown into an HTML fragment for read-only previews
 * (explorer quick preview).
 *
 * Boundaries:
 * - Reuses the editor markdown block parser so previews and the editor agree on
 *   block structure and inline formatting.
 * - Pure string transformation: no filesystem, IPC, or network access.
 * - Never shells out to an external converter, so previews do not depend on
 *   Pandoc being installed and runnable.
 */

import { sanitizeHtmlForPreview } from '../../../shared/lib/htmlSanitizer'
import { parseFrontmatterEnvelope } from '../../../shared/lib/markdownFrontmatter'
import { inlineTextToHtml, markdownToEditorData, type EditorBlock } from './markdownBlocks'

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

const TABLE_ALIGNMENTS = new Set(['left', 'center', 'right'])

type PreviewListItem = {
  content?: string
  meta?: { checked?: boolean }
  items?: PreviewListItem[]
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Renders raw markdown text (quote and callout bodies) as escaped paragraphs. */
function renderMarkdownParagraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<p>${inlineTextToHtml(chunk).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function renderCodeBlock(code: string, language: string): string {
  const token = language.trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, '')
  const className = token ? ` class="language-${token}"` : ''
  return `<pre><code${className}>${escapeHtml(code)}</code></pre>`
}

function renderTable(data: Record<string, unknown>): string {
  const rows = asArray(data.content).map((row) => asArray(row).map((cell) => asString(cell)))
  if (!rows.length) return ''

  const align = asArray(data.align).map((value) => asString(value))
  const withHeadings = data.withHeadings !== false

  const renderCell = (tag: 'th' | 'td', value: string, index: number) => {
    const alignment = align[index]
    const style = alignment && TABLE_ALIGNMENTS.has(alignment) ? ` style="text-align: ${alignment}"` : ''
    return `<${tag}${style}>${value}</${tag}>`
  }

  const head = withHeadings
    ? `<thead><tr>${rows[0].map((value, index) => renderCell('th', value, index)).join('')}</tr></thead>`
    : ''
  const bodyRows = withHeadings ? rows.slice(1) : rows
  const body = bodyRows.length
    ? `<tbody>${bodyRows
        .map((row) => `<tr>${row.map((value, index) => renderCell('td', value, index)).join('')}</tr>`)
        .join('')}</tbody>`
    : ''

  return `<table>${head}${body}</table>`
}

function renderListItems(items: PreviewListItem[], style: string): string {
  const tag = style === 'ordered' ? 'ol' : 'ul'
  const className = style === 'checklist' ? ' class="preview-checklist"' : ''
  const body = items.map((item) => renderListItem(item, style)).join('')
  return `<${tag}${className}>${body}</${tag}>`
}

function renderListItem(item: PreviewListItem, style: string): string {
  const content = asString(item.content)
  const marker = style === 'checklist'
    ? `<span class="preview-checkbox" aria-hidden="true">${item.meta?.checked ? '[x]' : '[ ]'}</span> `
    : ''
  const nested = Array.isArray(item.items) && item.items.length
    ? renderListItems(item.items, style)
    : ''
  return `<li>${marker}${content}${nested}</li>`
}

function renderBlock(block: EditorBlock): string {
  const data = block.data ?? {}

  switch (block.type) {
    case 'paragraph': {
      // Blank markdown lines are editor blocks; the preview relies on block
      // margins instead of empty paragraphs.
      const text = asString(data.text)
      return text ? `<p>${text}</p>` : ''
    }
    case 'header': {
      const level = Math.min(6, Math.max(1, Number(data.level) || 1))
      return `<h${level}>${asString(data.text)}</h${level}>`
    }
    case 'delimiter':
      return '<hr>'
    case 'code':
      return renderCodeBlock(asString(data.code), asString(data.language))
    case 'mermaid':
      return renderCodeBlock(asString(data.code), 'mermaid')
    case 'quote':
      return `<blockquote>${renderMarkdownParagraphs(asString(data.text))}</blockquote>`
    case 'callout': {
      const kind = asString(data.kind).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'note'
      return `<blockquote class="preview-callout preview-callout--${kind}">${renderMarkdownParagraphs(
        asString(data.message)
      )}</blockquote>`
    }
    case 'table':
      return renderTable(data)
    case 'list':
      return renderListItems(asArray(data.items) as PreviewListItem[], asString(data.style))
    case 'html':
      return asString(data.html)
    case 'asset': {
      const src = asString(data.src).trim()
      if (!src) return ''
      const alt = escapeHtml(asString(data.alt))
      const title = asString(data.title)
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<p><img src="${escapeHtml(src)}" alt="${alt}"${titleAttr}></p>`
    }
    case 'embed': {
      const target = asString(data.target).trim()
      return target ? `<p class="preview-embed">Embedded note: ${escapeHtml(target)}</p>` : ''
    }
    case 'raw':
      return `<p>${escapeHtml(asString(data.markdown))}</p>`
    default:
      return ''
  }
}

/**
 * Drops anchor targets so preview links cannot navigate the app webview.
 *
 * The preview modal has no link handler, so a live `href` (wikilink, relative
 * note path, or external URL) would replace the running app with that target.
 */
function neutralizePreviewLinks(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.removeAttribute('rel')
  })
  return template.innerHTML
}

/**
 * Renders note markdown as a sanitized HTML fragment for read-only previews.
 *
 * Frontmatter is dropped, block structure comes from the editor markdown parser,
 * and the result is sanitized so embedded HTML cannot inject scripts or unsafe URLs.
 */
export function renderMarkdownPreviewHtml(markdown: string): string {
  const body = parseFrontmatterEnvelope(String(markdown ?? '')).body
  if (!body.trim()) return ''

  const html = markdownToEditorData(body).blocks.map(renderBlock).join('\n')
  return neutralizePreviewLinks(sanitizeHtmlForPreview(html))
}
