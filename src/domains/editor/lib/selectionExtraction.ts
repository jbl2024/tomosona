/** Normalizes complete block selections for markdown extraction and replacement. */
import type { Editor, JSONContent } from '@tiptap/vue-3'
import type { ResolvedPos } from '@tiptap/pm/model'
import { editorDataToMarkdown, type EditorBlock } from './markdownBlocks'
import { fromTiptapDoc } from './tiptap/tiptapDocToEditorBlocks'

/** Standalone markdown and the complete document blocks it replaces. */
export type ExtractedSelection = {
  from: number
  to: number
  blocks: EditorBlock[]
  markdown: string
}

// Lift text edges through their wrappers, without including unselected content.
function documentBoundary(position: ResolvedPos): number | null {
  let current = position
  while (current.depth > 0) {
    if (current.parentOffset === 0) {
      current = current.doc.resolve(current.before())
    } else if (current.parentOffset === current.parent.content.size) {
      current = current.doc.resolve(current.after())
    } else {
      return null
    }
  }
  return current.pos
}

/**
 * Extracts complete document blocks, accepting text edges and the start of the
 * following block. Returns null for empty or partial blocks (including lists).
 * The returned range includes wrappers so replacement leaves no empty blocks.
 */
export function extractSelectedMarkdownBlocks(editor: Editor | null): ExtractedSelection | null {
  if (!editor) return null

  const { selection, doc } = editor.state
  if (!selection || selection.empty) return null

  const from = documentBoundary(selection.$from)
  const to = documentBoundary(selection.$to)
  if (from === null || to === null || from >= to) return null

  const content = doc.slice(from, to).content.toJSON() as JSONContent[]
  const blocks = fromTiptapDoc({ type: 'doc', content })
  if (!blocks.length) return null

  return {
    from,
    to,
    blocks,
    markdown: editorDataToMarkdown({ blocks }, { separateBlocks: true })
  }
}
