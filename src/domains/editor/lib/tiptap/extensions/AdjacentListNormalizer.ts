import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'

const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * Keeps adjacent list blocks as one list after deleting content between them.
 * ProseMirror joins list items interactively, but deleting a whole separator
 * block can otherwise leave two sibling list nodes behind.
 */
export const AdjacentListNormalizer = Extension.create({
  name: 'adjacentListNormalizer',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null

        const transaction = newState.tr
        let childIndex = 0
        let position = 0

        while (childIndex < transaction.doc.childCount - 1) {
          const current = transaction.doc.child(childIndex)
          const next = transaction.doc.child(childIndex + 1)
          const boundary = position + current.nodeSize
          const areMatchingLists = LIST_NODE_NAMES.has(current.type.name) && current.type === next.type

          if (areMatchingLists && canJoin(transaction.doc, boundary)) {
            transaction.join(boundary)
            continue
          }

          const following = childIndex + 2 < transaction.doc.childCount
            ? transaction.doc.child(childIndex + 2)
            : null
          const isEmptySeparator = next.type.name === 'paragraph' && next.content.size === 0
          const listsAroundSeparator = LIST_NODE_NAMES.has(current.type.name)
            && current.type === following?.type
          // Only remove a separator that was emptied by this edit. A newly
          // created empty paragraph is an intentional split between lists.
          let oldBoundary = boundary
          for (let i = transactions.length - 1; i >= 0; i -= 1) {
            oldBoundary = transactions[i].mapping.invert().map(oldBoundary, 1)
          }
          const oldSeparator = oldState.doc.nodeAt(oldBoundary)
          const wasNonEmptyParagraph = oldSeparator?.type.name === 'paragraph' && oldSeparator.content.size > 0
          if (isEmptySeparator && listsAroundSeparator && wasNonEmptyParagraph) {
            transaction.delete(boundary, boundary + next.nodeSize)
            continue
          }

          position = boundary
          childIndex += 1
        }

        return transaction.docChanged ? transaction : null
      }
    })]
  }
})
