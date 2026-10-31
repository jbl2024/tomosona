/**
 * Context-aware suggestions for the command palette browse state.
 *
 * Purpose:
 * - Resolve the palette's opening context from a frozen snapshot (active
 *   file, editor selection text, explorer selection, daily note) and rank
 *   context-relevant action ids first in the browse state.
 *
 * Boundaries:
 * - Pure resolution only: action availability, labels, and execution live in
 *   the palette catalog and the shell. Ids missing from the catalog are
 *   filtered out by the model so the browse never suggests dead actions.
 */

/** Frozen at palette open so actions operate on what the user saw. */
export type PaletteContextSnapshot = {
  activeFilePath: string
  editorSelectionText: string
  /** Markdown of the DOM selection at open; DOM selection dies on focus move. */
  editorSelectionMarkdown: string
  explorerSelectionPath: string | null
  isDailyNote: boolean
}

export const EMPTY_PALETTE_CONTEXT: PaletteContextSnapshot = {
  activeFilePath: '',
  editorSelectionText: '',
  editorSelectionMarkdown: '',
  explorerSelectionPath: null,
  isDailyNote: false
}

export type PaletteContextKind = 'empty' | 'note' | 'selection' | 'explorer' | 'daily'

/**
 * Picks the most specific applicable context: an editor selection targets the
 * text the user is working on, an explorer selection targets the file they
 * highlighted, then the daily journal, then any open note, else startup.
 */
export function paletteContextKind(snapshot: PaletteContextSnapshot): PaletteContextKind {
  if (snapshot.editorSelectionText.trim()) return 'selection'
  if (snapshot.explorerSelectionPath) return 'explorer'
  if (snapshot.activeFilePath && snapshot.isDailyNote) return 'daily'
  if (snapshot.activeFilePath) return 'note'
  return 'empty'
}

/**
 * Context-suggested action ids in display order. Ids must exist in the palette
 * catalog (or be implemented by later tasks) to surface in the browse state.
 */
export function contextSuggestionIds(kind: PaletteContextKind): string[] {
  switch (kind) {
    case 'selection':
      return [
        'extract-selection-to-note',
        'copy-selection-as-markdown',
        'transform-selection-heading',
        'transform-selection-list'
      ]
    case 'explorer':
      return [
        'open-explorer-selection',
        'copy-explorer-selection-link',
        'add-explorer-selection-to-favorites',
        'remove-explorer-selection-from-favorites',
        'reveal-explorer-selection'
      ]
    case 'daily':
      return ['open-yesterday', 'open-specific-date', 'create-new-file']
    case 'note':
      return ['convert-to-word', 'add-active-note-to-favorites', 'remove-active-note-from-favorites', 'reveal-in-explorer']
    case 'empty':
      return ['create-new-file', 'open-today', 'open-favorites']
  }
}
