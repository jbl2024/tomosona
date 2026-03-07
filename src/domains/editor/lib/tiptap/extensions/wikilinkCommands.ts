import type { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TIPTAP_NODE_TYPES } from '../types'

export type WikilinkEditingRange = {
  from: number
  to: number
}

export type ParsedWikilinkToken = {
  target: string
  label: string | null
}

export function buildWikilinkToken(target: string, label?: string | null): string {
  const normalizedTarget = String(target ?? '').trim()
  const normalizedLabel = String(label ?? '').trim()
  if (!normalizedTarget) return '[[]]'
  return normalizedLabel ? `[[${normalizedTarget}|${normalizedLabel}]]` : `[[${normalizedTarget}]]`
}

export function parseWikilinkToken(value: string): ParsedWikilinkToken | null {
  const match = String(value).match(/^\[\[([^\|\]\n]+)(?:\|([^\|\]\n]*))?\]\]$/)
  if (!match) return null
  const target = (match[1] ?? '').trim()
  if (!target) return null
  const labelRaw = (match[2] ?? '').trim()
  return {
    target,
    label: labelRaw || null
  }
}

export function insertWikilinkDraft(editor: Editor, from?: number, to?: number): WikilinkEditingRange | null {
  const { state } = editor
  const replaceFrom = typeof from === 'number' ? from : state.selection.from
  const replaceTo = typeof to === 'number' ? to : state.selection.to
  const token = '[[]]'
  const tr = state.tr.insertText(token, replaceFrom, replaceTo)
  const caret = replaceFrom + 2
  tr.setSelection(TextSelection.create(tr.doc, caret))
  editor.view.dispatch(tr)
  return { from: replaceFrom, to: replaceFrom + token.length }
}

export function enterWikilinkEditFromNode(editor: Editor, pos: number): WikilinkEditingRange | null {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== TIPTAP_NODE_TYPES.wikilink) return null

  const target = String(node.attrs.target ?? '').trim()
  if (!target) return null
  const label = String(node.attrs.label ?? '').trim()
  const token = buildWikilinkToken(target, label || null)
  const tr = editor.state.tr.insertText(token, pos, pos + node.nodeSize)
  const pipeIndex = token.indexOf('|')
  const caretOffset = pipeIndex >= 0 ? pipeIndex + 1 : token.length - 2
  tr.setSelection(TextSelection.create(tr.doc, pos + caretOffset))
  editor.view.dispatch(tr)
  return { from: pos, to: pos + token.length }
}

export function commitWikilinkAtRange(
  editor: Editor,
  range: WikilinkEditingRange,
  parsed: ParsedWikilinkToken,
  exists = true
): number | null {
  const nodeType = editor.state.schema.nodes[TIPTAP_NODE_TYPES.wikilink]
  if (!nodeType) return null
  const label = parsed.label?.trim() || null
  const node = nodeType.create({
    target: parsed.target,
    label,
    exists
  })

  const tr = editor.state.tr.replaceWith(range.from, range.to, node)
  const posAfter = Math.min(tr.doc.content.size, range.from + node.nodeSize)
  tr.setSelection(TextSelection.create(tr.doc, Math.max(1, posAfter)))
  editor.view.dispatch(tr)
  return range.from
}

export function cancelWikilinkEditing(editor: Editor, range: WikilinkEditingRange): void {
  const from = Math.max(1, Math.min(range.from, editor.state.doc.content.size))
  const to = Math.max(from, Math.min(range.to, editor.state.doc.content.size))
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))
  editor.view.dispatch(tr)
}

export function findSelectedWikilinkNode(state: Editor['state']): { pos: number; node: ProseMirrorNode } | null {
  const selection = state.selection
  if (!(selection instanceof NodeSelection)) return null
  const node = selection.node
  if (!node || node.type.name !== TIPTAP_NODE_TYPES.wikilink) return null
  return { pos: selection.from, node }
}
