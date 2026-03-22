import type { Editor } from '@tiptap/core'
import type { Node as ProseNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { BlockMenuTarget, TurnIntoType } from './types'

const NON_BLOCK_NODE_TYPES = new Set(['tableRow', 'tableCell', 'tableHeader'])

function humanizeNodeType(nodeType: string): string {
  const stripped = nodeType.replace(/(Block|Node|List|Item)$/u, '')
  const spaced = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
  if (!spaced) return nodeType
  return `${spaced[0].toUpperCase()}${spaced.slice(1)}`
}

export function toBlockMenuTarget(node: ProseNode, pos: number): BlockMenuTarget {
  const canDelete = !NON_BLOCK_NODE_TYPES.has(node.type.name)
  const canConvert = !NON_BLOCK_NODE_TYPES.has(node.type.name)

  return {
    pos,
    nodeType: node.type.name,
    nodeSize: node.nodeSize,
    canDelete,
    canConvert,
    text: node.textContent ?? '',
    attrs: node.attrs ? { ...node.attrs } : undefined,
  }
}

export function toSelectionBlockMenuTarget(editor: Editor | null): BlockMenuTarget | null {
  if (!editor) return null

  const { selection } = editor.state
  if (selection instanceof NodeSelection) {
    return toBlockMenuTarget(selection.node, selection.from)
  }

  const { $from } = selection
  const parentType = $from.parent.type.name
  if (parentType !== 'heading' && parentType !== 'paragraph') return null

  return toBlockMenuTarget($from.parent, $from.before($from.depth))
}

export function getBlockStructureLabel(target: BlockMenuTarget | null): string {
  if (!target) return ''

  switch (target.nodeType) {
    case 'heading': {
      const rawLevel = Number(target.attrs?.level)
      if (Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 6) {
        return `H${rawLevel}`
      }
      return 'Heading'
    }
    case 'paragraph':
      return 'P'
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
    case 'listItem':
    case 'taskItem':
      return 'List'
    case 'codeBlock':
      return 'Code'
    case 'blockquote':
    case 'quoteBlock':
      return 'Quote'
    case 'table':
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return 'Table'
    case 'calloutBlock':
      return 'Callout'
    case 'mermaidBlock':
      return 'Mermaid'
    case 'htmlBlock':
      return 'HTML'
    default:
      return humanizeNodeType(target.nodeType)
  }
}

export function canCopyAnchor(target: BlockMenuTarget | null): boolean {
  if (!target) return false
  return target.nodeType === 'heading' && target.text.trim().length > 0
}

export function canTurnInto(target: BlockMenuTarget | null, _type: TurnIntoType): boolean {
  if (!target) return false
  return target.canConvert
}
