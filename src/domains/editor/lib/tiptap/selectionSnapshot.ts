import { NodeSelection, type Selection } from '@tiptap/pm/state'

export type PersistedTextSelection = {
  from: number
  to: number
}

/**
 * Converts a ProseMirror selection into a text-selection snapshot that is safe
 * to restore with `setTextSelection`.
 *
 * NodeSelection cannot be faithfully restored through text selection APIs, so
 * we persist it as a collapsed caret at `from` to avoid broad/random restores.
 */
export function toPersistedTextSelection(selection: Selection): PersistedTextSelection {
  if (selection instanceof NodeSelection) {
    return { from: selection.from, to: selection.from }
  }

  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  return { from, to }
}

