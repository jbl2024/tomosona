import type { JSONContent } from '@tiptap/vue-3'
import type { EditorBlock } from '../markdownBlocks'
import { normalizeCalloutKind } from '../callouts'
import { parseWikilinkTarget } from '../wikilinks'
import { TIPTAP_NODE_TYPES } from './types'

type TiptapNode = JSONContent
type TableAlign = 'left' | 'center' | 'right' | null

function roundPercentagesToHundred(values: number[]): number[] {
  if (!values.length) return []
  const floors = values.map((value) => Math.max(1, Math.floor(value)))
  let total = floors.reduce((acc, value) => acc + value, 0)
  if (total === 100) return floors

  const remainders = values.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
  if (total < 100) {
    remainders.sort((a, b) => b.fraction - a.fraction)
    let cursor = 0
    while (total < 100) {
      floors[remainders[cursor % remainders.length].index] += 1
      total += 1
      cursor += 1
    }
    return floors
  }

  remainders.sort((a, b) => a.fraction - b.fraction)
  let cursor = 0
  while (total > 100 && remainders.length > 0) {
    const idx = remainders[cursor % remainders.length].index
    if (floors[idx] > 1) {
      floors[idx] -= 1
      total -= 1
    }
    cursor += 1
    if (cursor > remainders.length * 3) break
  }
  return floors
}

function normalizedTableWidthPercents(widthsRaw: unknown[], columnCount: number): Array<number | null> {
  const parsed = Array.from({ length: columnCount }, (_, index) => {
    const numeric = Number.parseFloat(String(widthsRaw[index] ?? '').replace(/%$/, ''))
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    return numeric
  })
  const defined = parsed.filter((value): value is number => typeof value === 'number')
  if (!defined.length) return parsed

  const missingCount = parsed.filter((value) => value === null).length
  if (missingCount > 0) {
    const fallback = Math.max(1, defined.reduce((acc, value) => acc + value, 0) / defined.length)
    for (let index = 0; index < parsed.length; index += 1) {
      if (parsed[index] === null) parsed[index] = fallback
    }
  }

  const values = parsed.map((value) => Number(value ?? 0))
  const sum = values.reduce((acc, value) => acc + value, 0)
  if (sum <= 0) return parsed
  const scaled = values.map((value) => (value / sum) * 100)
  return roundPercentagesToHundred(scaled)
}

function marksForElement(element: HTMLElement): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const out: Array<{ type: string; attrs?: Record<string, unknown> }> = []
  const tag = element.tagName.toLowerCase()
  if (tag === 'strong' || tag === 'b') out.push({ type: 'bold' })
  if (tag === 'em' || tag === 'i') out.push({ type: 'italic' })
  if (tag === 's' || tag === 'strike') out.push({ type: 'strike' })
  if (tag === 'u') out.push({ type: 'underline' })
  if (tag === 'code') out.push({ type: 'code' })
  if (tag === 'a') {
    const href = element.getAttribute('href')?.trim() ?? ''
    if (href) out.push({ type: 'link', attrs: { href } })
  }
  return out
}

function parseInlineNode(node: Node, inheritedMarks: Array<{ type: string; attrs?: Record<string, unknown> }>): TiptapNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (!text) return []
    return [{ type: 'text', text, ...(inheritedMarks.length ? { marks: inheritedMarks } : {}) }]
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()
  if (tag === 'br') return [{ type: 'hardBreak' }]
  if (tag === 'a') {
    const target = (
      element.getAttribute('data-target') ??
      element.getAttribute('data-wikilink-target') ??
      ''
    ).trim()

    if (target) {
      const text = (element.textContent ?? '').trim()
      const parsed = parseWikilinkTarget(target)
      const defaultLabel = parsed.anchor?.heading && !parsed.notePath ? parsed.anchor.heading : target
      return [{
        type: TIPTAP_NODE_TYPES.wikilink,
        attrs: {
          target,
          label: text && text !== defaultLabel ? text : null,
          exists: true
        }
      }]
    }
  }

  const marks = [...inheritedMarks, ...marksForElement(element)]
  const out: TiptapNode[] = []
  Array.from(element.childNodes).forEach((child) => {
    out.push(...parseInlineNode(child, marks))
  })
  return out
}

function inlineNodesFromHtml(value: unknown): TiptapNode[] {
  const html = String(value ?? '')
  if (!html.trim()) return []
  const root = document.createElement('div')
  root.innerHTML = html
  const out: TiptapNode[] = []
  Array.from(root.childNodes).forEach((node) => {
    out.push(...parseInlineNode(node, []))
  })
  return out
}

function listItemNode(contentHtml: unknown, checked?: boolean, task = false, nested?: TiptapNode): TiptapNode {
  const paragraphContent = inlineNodesFromHtml(contentHtml)
  const paragraph: TiptapNode = {
    type: 'paragraph',
    content: paragraphContent
  }
  const attrs = typeof checked === 'boolean' ? { checked } : undefined
  const nodeType = task ? 'taskItem' : 'listItem'
  const contentNodes: TiptapNode[] = [paragraph]
  if (nested) contentNodes.push(nested)
  return {
    type: nodeType,
    ...(attrs ? { attrs } : {}),
    content: contentNodes
  }
}

function richItemToNode(entry: unknown, style: 'ordered' | 'unordered' | 'checklist'): TiptapNode | null {
  if (!entry || typeof entry !== 'object') return null
  const item = entry as Record<string, unknown>
  const contentHtml = item.content
  const checkedRaw = (item.meta as { checked?: boolean } | undefined)?.checked

  let nested: TiptapNode | undefined
  if (Array.isArray(item.items) && item.items.length > 0) {
    const nestedItems = item.items
      .map((child) => richItemToNode(child, style))
      .filter((child): child is TiptapNode => Boolean(child))
    if (nestedItems.length > 0) {
      nested = style === 'ordered'
        ? { type: 'orderedList', content: nestedItems }
        : style === 'checklist'
          ? { type: 'taskList', content: nestedItems }
          : { type: 'bulletList', content: nestedItems }
    }
  }

  return listItemNode(contentHtml, style === 'checklist' ? Boolean(checkedRaw) : undefined, style === 'checklist', nested)
}

function blockToNode(block: EditorBlock): TiptapNode | null {
  const data = block.data ?? {}

  switch (block.type) {
    case 'paragraph': {
      return { type: 'paragraph', content: inlineNodesFromHtml(data.text) }
    }

    case 'header':
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(data.level ?? 2)))
      return {
        type: 'heading',
        attrs: {
          level,
          isVirtualTitle: block.id === '__virtual_title__'
        },
        content: inlineNodesFromHtml(data.text)
      }
    }

    case 'list': {
      const style = data.style === 'ordered' ? 'ordered' : data.style === 'checklist' ? 'checklist' : 'unordered'
      const rawItems = Array.isArray(data.items) ? data.items : []
      const content = rawItems
        .map((item) => richItemToNode(item, style))
        .filter((item): item is TiptapNode => Boolean(item))

      if (!content.length) {
        content.push(listItemNode('', style === 'checklist' ? false : undefined, style === 'checklist'))
      }

      if (style === 'ordered') {
        return { type: 'orderedList', content }
      }
      if (style === 'checklist') {
        return { type: 'taskList', content }
      }
      return { type: 'bulletList', content }
    }

    case 'quote': {
      return {
        type: TIPTAP_NODE_TYPES.quote,
        attrs: {
          text: String(data.text ?? '')
        }
      }
    }

    case 'callout': {
      return {
        type: TIPTAP_NODE_TYPES.callout,
        attrs: {
          kind: normalizeCalloutKind(String(data.kind ?? 'NOTE')),
          message: String(data.message ?? '')
        }
      }
    }

    case 'mermaid': {
      return {
        type: TIPTAP_NODE_TYPES.mermaid,
        attrs: {
          code: String(data.code ?? '')
        }
      }
    }

    case 'code': {
      return {
        type: 'codeBlock',
        attrs: {
          language: String(data.language ?? '').trim() || null
        },
        content: String(data.code ?? '') ? [{ type: 'text', text: String(data.code ?? '') }] : []
      }
    }

    case 'table': {
      const rows = Array.isArray(data.content) ? data.content : []
      const alignRaw = Array.isArray(data.align) ? data.align : []
      const widthsRaw = Array.isArray(data.widths) ? data.widths : []
      const rowNodes: TiptapNode[] = rows.map((row, rowIndex) => {
        const cells = Array.isArray(row) ? row : []
        const cellType = rowIndex === 0 ? 'tableHeader' : 'tableCell'
        const columnCount = Math.max(cells.length, alignRaw.length, widthsRaw.length)
        const widthPercents = normalizedTableWidthPercents(widthsRaw, columnCount)
        return {
          type: 'tableRow',
          content: Array.from({ length: columnCount }, (_, colIndex) => {
            const rawAlign = String(alignRaw[colIndex] ?? '').trim().toLowerCase()
            const textAlign: TableAlign = rawAlign === 'left' || rawAlign === 'center' || rawAlign === 'right'
              ? (rawAlign as TableAlign)
              : null
            const widthPercent = Number.parseInt(String(widthPercents[colIndex] ?? ''), 10)
            const colwidth = Number.isFinite(widthPercent) && widthPercent > 0
              ? [Math.max(1, widthPercent)]
              : null
            return {
              type: cellType,
              attrs: {
                textAlign,
                colwidth
              },
              content: [{ type: 'paragraph', content: inlineNodesFromHtml(String(cells[colIndex] ?? '')) }]
            }
          })
        }
      })
      return {
        type: 'table',
        content: rowNodes
      }
    }

    case 'delimiter':
      return { type: 'horizontalRule' }

    case 'html':
      return {
        type: TIPTAP_NODE_TYPES.html,
        attrs: {
          html: String(data.html ?? '')
        }
      }

    case 'raw':
      return {
        type: 'codeBlock',
        attrs: { language: 'markdown' },
        content: String(data.markdown ?? '') ? [{ type: 'text', text: String(data.markdown ?? '') }] : []
      }

    default: {
      const fallback = JSON.stringify(data ?? {}, null, 2)
      return {
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: fallback ? [{ type: 'text', text: fallback }] : []
      }
    }
  }
}

export function toTiptapDoc(blocks: EditorBlock[]): JSONContent {
  const content = blocks
    .map((block) => blockToNode(block))
    .filter((node): node is JSONContent => Boolean(node))

  return {
    type: 'doc',
    content
  }
}
