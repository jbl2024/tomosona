/**
 * Returns true when global shortcuts should be blocked for the current event target.
 *
 * We allow app-level shortcuts in the editor surface and in the sidebar search input,
 * but block them in ordinary form fields and non-editor contenteditable regions.
 */
export function shouldBlockGlobalShortcutsFromTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-search-input="true"]')) return false

  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (target.closest('.editor-shell')) return false

  return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'))
}

/**
 * Returns true when editor content has a non-empty text selection.
 *
 * Why:
 * - Global Mod+B should defer to editor bold when the user actively selected text
 *   inside the editor surface.
 */
export function hasActiveTextSelectionInEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (!target.closest('.editor-shell')) return false

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  if (!selection.toString().trim()) return false

  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element = container instanceof HTMLElement ? container : container.parentElement
  return Boolean(element?.closest('.editor-shell'))
}
