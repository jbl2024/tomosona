import { clipboardHtmlToMarkdown } from './markdownBlocks'

export type CopyAsFormat = 'markdown' | 'html' | 'plain'

export type ClipboardSelectionPayload = {
  plain: string
  html: string
  markdown: string
}

function isSelectionInsideRoot(selection: Selection, root: HTMLElement): boolean {
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!anchorNode || !focusNode) return false
  return root.contains(anchorNode) && root.contains(focusNode)
}

/**
 * Builds plain/html/markdown clipboard payload from the current DOM selection.
 * Returns null when there is no non-empty selection within `root`.
 */
export function extractSelectionClipboardPayload(
  root: HTMLElement,
  selection: Selection | null = window.getSelection()
): ClipboardSelectionPayload | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  if (!isSelectionInsideRoot(selection, root)) return null

  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()
  const container = document.createElement('div')
  container.appendChild(fragment)
  const html = container.innerHTML.trim()
  const plain = selection.toString().trim()
  if (!html || !plain) return null

  const markdown = clipboardHtmlToMarkdown(html).trim() || plain
  return { plain, html, markdown }
}

/**
 * Writes a selection payload in the requested explicit format.
 * Keeps a plain-text fallback for destination compatibility.
 */
export async function writeSelectionPayloadToClipboard(
  payload: ClipboardSelectionPayload,
  format: CopyAsFormat
): Promise<void> {
  if (!navigator.clipboard?.writeText) return

  const textByFormat = format === 'markdown'
    ? payload.markdown
    : format === 'plain'
      ? payload.plain
      : payload.html

  const hasRichClipboard = typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function'
  if (!hasRichClipboard) {
    await navigator.clipboard.writeText(textByFormat)
    return
  }

  if (format === 'html') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([payload.html], { type: 'text/html' }),
        'text/plain': new Blob([payload.plain], { type: 'text/plain' })
      })
    ])
    return
  }

  if (format === 'markdown') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/markdown': new Blob([payload.markdown], { type: 'text/markdown' }),
        // Many targets (for example VS Code) consume text/plain first.
        'text/plain': new Blob([payload.markdown], { type: 'text/plain' })
      })
    ])
    return
  }

  await navigator.clipboard.writeText(payload.plain)
}
