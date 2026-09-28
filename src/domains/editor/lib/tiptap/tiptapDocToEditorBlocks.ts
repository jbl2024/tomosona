import type { JSONContent } from '@tiptap/vue-3'
import type { EditorBlock } from '../markdownBlocks'
import { normalizeCalloutKind } from '../callouts'
import { parseRelativeMarkdownHref } from '../markdownBlocks'
import { TIPTAP_NODE_TYPES } from './types'
type TableAlign = 'left' | 'center' | 'right' | null

function textFromNode(node: JSONContent | null | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return String(node.text ?? '')
  if (!Array.isArray(node.content)) return ''
  return node.content.map((child) => textFromNode(child)).join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function serializeTextWithMarks(node: JSONContent): string {
  const text = escapeHtml(String(node.text ?? ''))
  const marks = Array.isArray(node.marks) ? node.marks : []
  return marks.reduce((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return `<strong>${acc}</strong>`
      case 'italic':
        return `<em>${acc}</em>`
      case 'strike':
        return `<s>${acc}</s>`
      case 'underline':
        return `<u>${acc}</u>`
      case 'code':
        return `<code>${acc}</code>`
      case TIPTAP_NODE_TYPES.wikilink: {
        const target = String(mark.attrs?.target ?? '').trim()
        const href = `wikilink:${encodeURIComponent(target)}`
        return `<a href="${escapeHtml(href)}" data-wikilink-target="${escapeHtml(target)}">${acc}</a>`
      }
      case 'link': {
        const href = String(mark.attrs?.href ?? '').trim()
        if (href.startsWith('#')) {
          return `<a href="${escapeHtml(href)}">${acc}</a>`
        }
        const relativeMarkdownHref = parseRelativeMarkdownHref(href)
        if (relativeMarkdownHref) {
          return `<a href="${escapeHtml(href)}" data-markdown-target="${escapeHtml(href)}">${acc}</a>`
        }
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${acc}</a>`
      }
      default:
        return acc
    }
  }, text)
}

function inlineHtmlFromNode(node: JSONContent | null | undefined): string {
  if (!node) return ''
  if (node.type === TIPTAP_NODE_TYPES.wikilink) {
    const target = String(node.attrs?.target ?? '').trim()
    if (!target) return ''
    const label = String(node.attrs?.label ?? '').trim() || target
    const href = `wikilink:${encodeURIComponent(target)}`
    return `<a href="${escapeHtml(href)}" data-wikilink-target="${escapeHtml(target)}">${escapeHtml(label)}</a>`
  }
  if (node.type === 'text') return serializeTextWithMarks(node)
  if (node.type === 'hardBreak') return '<br>'
  if (!Array.isArray(node.content)) return ''
  return node.content.map((child) => inlineHtmlFromNode(child)).join('')
}

function paragraphText(node: JSONContent | null | undefined): string {
  return inlineHtmlFromNode(node)
}

function nestedListNodeFromItem(item: JSONContent, style: 'ordered' | 'unordered' | 'checklist'): JSONContent | null {
  const children = Array.isArray(item.content) ? item.content : []
  return children.find((child) => {
    if (style === 'ordered') return child.type === 'orderedList'
    if (style === 'checklist') return child.type === 'taskList'
    return child.type === 'bulletList'
  }) ?? null
}

function listItemToRichItem(item: JSONContent, style: 'ordered' | 'unordered' | 'checklist'): {
  content: string
  meta: Record<string, unknown>
  items: Array<{ content: string; meta: Record<string, unknown>; items: unknown[] }>
} {
  const children = Array.isArray(item.content) ? item.content : []
  const paragraph = children.find((child) => child.type === 'paragraph')
  const nestedList = nestedListNodeFromItem(item, style)
  const nestedItems = Array.isArray(nestedList?.content)
    ? nestedList!.content!
        .filter((child) => child.type === 'listItem' || child.type === 'taskItem')
        .map((child) => listItemToRichItem(child, style))
    : []

  return {
    content: paragraphText(paragraph),
    meta: style === 'checklist' ? { checked: Boolean(item.attrs?.checked) } : {},
    items: nestedItems
  }
}

function nodeToBlock(node: JSONContent): EditorBlock | null {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', data: { text: paragraphText(node) } }

    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 2)))
      const text = paragraphText(node)
      return {
        type: 'header',
        data: { level, text }
      }
    }

    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const style =
        node.type === 'orderedList' ? 'ordered' : node.type === 'taskList' ? 'checklist' : 'unordered'
      const items = (Array.isArray(node.content) ? node.content : [])
        .filter((item) => item.type === 'listItem' || item.type === 'taskItem')
        .map((item) => listItemToRichItem(item, style))
      return { type: 'list', data: { style, meta: {}, items } }
    }

    case 'codeBlock': {
      return {
        type: 'code',
        data: {
          language: String(node.attrs?.language ?? ''),
          code: textFromNode(node)
        }
      }
    }

    case 'table': {
      const tableRows = (Array.isArray(node.content) ? node.content : [])
        .filter((row) => row.type === 'tableRow')
      const rows = tableRows
        .map((row) => {
          const cells = Array.isArray(row.content) ? row.content : []
          return cells.map((cell) => inlineHtmlFromNode(cell))
        })
      const firstRowCells = Array.isArray(tableRows[0]?.content) ? tableRows[0]!.content! : []
      const align: TableAlign[] = firstRowCells.map((cell) => {
        const token = String(cell.attrs?.textAlign ?? '').trim().toLowerCase()
        if (token === 'left' || token === 'center' || token === 'right') return token as TableAlign
        return null
      })
      return {
        type: 'table',
        data: {
          withHeadings: true,
          content: rows,
          ...(align.some((item) => item !== null) ? { align } : {})
        }
      }
    }

    case 'horizontalRule':
      return { type: 'delimiter', data: {} }

    case TIPTAP_NODE_TYPES.callout:
      return {
        type: 'callout',
        data: {
          kind: normalizeCalloutKind(String(node.attrs?.kind ?? 'NOTE')),
          message: String(node.attrs?.message ?? '')
        }
      }

    case TIPTAP_NODE_TYPES.mermaid:
      return {
        type: 'mermaid',
        data: {
          code: String(node.attrs?.code ?? '')
        }
      }

    case TIPTAP_NODE_TYPES.quote:
      return {
        type: 'quote',
        data: {
          text: String(node.attrs?.text ?? '')
        }
      }

    case TIPTAP_NODE_TYPES.asset:
      return {
        type: 'asset',
        data: {
          src: String(node.attrs?.src ?? ''),
          alt: String(node.attrs?.alt ?? ''),
          title: String(node.attrs?.title ?? '')
        }
      }

    case TIPTAP_NODE_TYPES.html:
      return {
        type: 'html',
        data: {
          html: String(node.attrs?.html ?? '')
        }
      }

    case TIPTAP_NODE_TYPES.noteEmbed:
      return {
        type: 'embed',
        data: {
          target: String(node.attrs?.target ?? '')
        }
      }

    default:
      return null
  }
}

export function fromTiptapDoc(doc: JSONContent | null | undefined): EditorBlock[] {
  const nodes = Array.isArray(doc?.content) ? doc!.content! : []
  return nodes
    .map((node) => nodeToBlock(node))
    .filter((block): block is EditorBlock => Boolean(block))
}
