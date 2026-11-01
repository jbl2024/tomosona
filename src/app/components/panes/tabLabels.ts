/**
 * Module: tabLabels
 *
 * Purpose:
 * - Single source of truth for how a tab is named, so the strip and the tab
 *   list never drift apart.
 *
 * Boundaries:
 * - Pure string helpers over `PaneTab`. No Vue, no state, no I/O.
 * - Paths are never rewritten here: only the displayed label drops the
 *   Markdown extension.
 */
import type { PaneTab } from '../../composables/useMultiPaneWorkspaceState'

/** Returns the last path segment, tolerating both separators. */
export function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

/** Returns the parent folder name, or an empty string at the workspace root. */
export function parentFolder(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

/** Drops the Markdown extension so the strip stays quiet. */
export function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '')
}

/** Returns the path of a tab that has one, or an empty string. */
export function tabPath(tab: PaneTab): string {
  return tab.type === 'document' || tab.type === 'file-inspector' ? tab.path : ''
}

/** Returns the label shown for a tab: the document name without `.md`. */
export function tabLabel(tab: PaneTab): string {
  const path = tabPath(tab)
  return path ? stripMarkdownExtension(fileName(path)) : 'Home'
}

/** Returns the folder used to disambiguate homonym tabs. */
export function tabFolder(tab: PaneTab): string {
  const path = tabPath(tab)
  return path ? parentFolder(path) : ''
}

/** Reports whether another tab in the same pane carries the same label. */
export function hasHomonym(label: string, labels: string[]): boolean {
  return labels.filter((item) => item === label).length > 1
}
