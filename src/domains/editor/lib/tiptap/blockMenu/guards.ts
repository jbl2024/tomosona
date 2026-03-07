import type { Node as ProseNode } from '@tiptap/pm/model'
import type { BlockMenuTarget, TurnIntoType } from './types'

const NON_BLOCK_NODE_TYPES = new Set(['tableRow', 'tableCell', 'tableHeader'])

export function toBlockMenuTarget(node: ProseNode, pos: number): BlockMenuTarget {
  const isVirtualTitle = node.type.name === 'heading' && Boolean(node.attrs?.isVirtualTitle)
  const canDelete = !isVirtualTitle && !NON_BLOCK_NODE_TYPES.has(node.type.name)
  const canConvert = !isVirtualTitle && !NON_BLOCK_NODE_TYPES.has(node.type.name)

  return {
    pos,
    nodeType: node.type.name,
    nodeSize: node.nodeSize,
    canDelete,
    canConvert,
    text: node.textContent ?? '',
    isVirtualTitle,
  }
}

export function canCopyAnchor(target: BlockMenuTarget | null): boolean {
  if (!target) return false
  return target.nodeType === 'heading' && !target.isVirtualTitle && target.text.trim().length > 0
}

export function canTurnInto(target: BlockMenuTarget | null, _type: TurnIntoType): boolean {
  if (!target) return false
  return target.canConvert
}
