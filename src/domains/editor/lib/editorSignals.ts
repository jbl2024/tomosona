/**
 * Editor signal contracts and extraction helpers shared by the ruler and shell.
 * Signal positions remain ProseMirror ranges; presentation owns viewport mapping.
 */
import type { Editor } from '@tiptap/vue-3'
import { getEditorFindState } from './tiptap/extensions/EditorFind'
import { getSpellcheckState } from './tiptap/extensions/Spellcheck'
import { TIPTAP_NODE_TYPES } from './tiptap/types'

export type EditorSignalKind = 'spellcheck' | 'find' | 'link'
export type EditorSignalDirection = 1 | -1

export type EditorSignalRange = {
  kind: EditorSignalKind
  from: number
  to: number
}

export type EditorHeadingRange = {
  level: 1 | 2 | 3
  from: number
  to: number
  text: string
}

/** Summary emitted by a rich-text editor for the globally active status bar. */
export type EditorSignalSummary = {
  path: string
  spellcheckEnabled: boolean
  findActive: boolean
  spellcheckCount: number
  findCount: number
  linkCount: number
}

export const EMPTY_EDITOR_SIGNAL_SUMMARY: EditorSignalSummary = {
  path: '',
  spellcheckEnabled: false,
  findActive: false,
  spellcheckCount: 0,
  findCount: 0,
  linkCount: 0
}

/** Selects only the summary owned by the active pane and active document. */
export function resolveActiveEditorSignalSummary(
  summariesByPane: Record<string, EditorSignalSummary>,
  activePaneId: string,
  activePath: string
): EditorSignalSummary {
  const summary = summariesByPane[activePaneId]
  return summary?.path === activePath
    ? summary
    : { ...EMPTY_EDITOR_SIGNAL_SUMMARY, path: activePath }
}

/** Extracts the visible H1-H3 structure from the current Tiptap document. */
export function collectEditorHeadingRanges(editor: Editor | null): EditorHeadingRange[] {
  if (!editor) return []
  const headings: EditorHeadingRange[] = []

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const rawLevel = Number(node.attrs.level ?? 3)
    if (rawLevel < 1 || rawLevel > 3) return false
    headings.push({
      level: rawLevel as 1 | 2 | 3,
      from: pos,
      to: pos + node.nodeSize,
      text: node.textContent.trim()
    })
    return false
  })

  return headings
}

/**
 * Extracts spellcheck, active find, and link occurrences without duplicating
 * adjacent text nodes covered by the same link mark.
 */
export function collectEditorSignalRanges(editor: Editor | null): EditorSignalRange[] {
  if (!editor) return []

  const spellcheck = getSpellcheckState(editor.state).decorations.find().map((decoration) => ({
    kind: 'spellcheck' as const,
    from: decoration.from,
    to: decoration.to
  }))
  const find = getEditorFindState(editor).matches.map((match) => ({
    kind: 'find' as const,
    from: match.from,
    to: match.to
  }))
  const links: Array<EditorSignalRange & { href: string }> = []

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === TIPTAP_NODE_TYPES.wikilink) {
      links.push({ kind: 'link', from: pos, to: pos + node.nodeSize, href: `wiki:${String(node.attrs.target ?? '')}` })
      return false
    }
    if (!node.isText) return true

    const mark = node.marks.find((candidate) => candidate.type.name === 'link')
    if (!mark) return true
    const href = String(mark.attrs.href ?? '')
    const previous = links[links.length - 1]
    if (previous?.href === href && previous.to === pos) {
      previous.to = pos + node.nodeSize
    } else {
      links.push({ kind: 'link', from: pos, to: pos + node.nodeSize, href })
    }
    return true
  })

  return [...spellcheck, ...find, ...links.map(({ href: _href, ...range }) => range)]
}

/** Builds the shell-facing counters from an editor signal snapshot. */
export function buildEditorSignalSummary(
  path: string,
  signals: EditorSignalRange[],
  options: { spellcheckEnabled: boolean; findActive: boolean }
): EditorSignalSummary {
  return {
    path,
    spellcheckEnabled: options.spellcheckEnabled,
    findActive: options.findActive,
    spellcheckCount: signals.filter((signal) => signal.kind === 'spellcheck').length,
    findCount: signals.filter((signal) => signal.kind === 'find').length,
    linkCount: signals.filter((signal) => signal.kind === 'link').length
  }
}

export type PositionedEditorSignal = EditorSignalRange & {
  topPercent: number
  lane: number
  overflowOffset: number
}

/**
 * Gives vertically overlapping markers distinct horizontal lanes. Once lanes
 * are exhausted, subsequent markers wrap with a small vertical offset.
 */
export function assignEditorSignalLanes<T extends EditorSignalRange & { topPercent: number }>(
  signals: T[],
  laneCount = 3,
  collisionPercent = 0.5
): Array<T & { lane: number; overflowOffset: number }> {
  const safeLaneCount = Math.max(1, Math.floor(laneCount))
  const groups: T[][] = []

  for (const signal of [...signals].sort((left, right) => left.topPercent - right.topPercent)) {
    const group = groups.find((candidate) => Math.abs((candidate[0]?.topPercent ?? 0) - signal.topPercent) <= collisionPercent)
    if (group) group.push(signal)
    else groups.push([signal])
  }

  return groups.flatMap((group) => group.map((signal, index) => ({
    ...signal,
    lane: index % safeLaneCount,
    overflowOffset: Math.floor(index / safeLaneCount) * 2
  })))
}
