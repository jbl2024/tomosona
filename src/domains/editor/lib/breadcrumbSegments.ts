/**
 * Module: breadcrumbSegments
 *
 * Purpose:
 * - Turn a document path into the ordered segments the editor breadcrumb
 *   renders, and decide which segments survive a narrow pane.
 *
 * Boundaries:
 * - Pure string work. No Vue, no I/O, no navigation side effects.
 * - Folder segments carry absolute paths so the explorer reveal port can use
 *   them directly; the document segment keeps the document's own path.
 */
import {
  toWorkspaceAbsolutePath,
  toWorkspaceRelativePath
} from '../../explorer/lib/workspacePaths'

export type BreadcrumbSegmentKind = 'folder' | 'document'

export type BreadcrumbSegment = {
  kind: BreadcrumbSegmentKind
  /** Display label: the folder name, or the document name without `.md`. */
  label: string
  /** Absolute path used by the reveal port and the document actions. */
  path: string
}

/** Drops the Markdown extension so the breadcrumb stays quiet. */
function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '')
}

/**
 * Builds the breadcrumb segments for `path`.
 *
 * Returns an empty list when the path is empty. A document at the workspace
 * root yields a single document segment, so the breadcrumb never renders a
 * separator without a neighbour.
 */
export function buildBreadcrumbSegments(workspacePath: string, path: string): BreadcrumbSegment[] {
  const normalizedPath = String(path ?? '').trim()
  if (!normalizedPath) return []

  const relative = toWorkspaceRelativePath(workspacePath, normalizedPath)
  const parts = relative.split('/').filter(Boolean)
  if (!parts.length) return []

  const segments: BreadcrumbSegment[] = []
  for (let index = 0; index < parts.length - 1; index += 1) {
    segments.push({
      kind: 'folder',
      label: parts[index],
      path: toWorkspaceAbsolutePath(workspacePath, parts.slice(0, index + 1).join('/'))
    })
  }

  segments.push({
    kind: 'document',
    label: stripMarkdownExtension(parts[parts.length - 1]),
    path: normalizedPath
  })
  return segments
}

/**
 * Splits segments into the ones a narrow breadcrumb keeps and the ones it
 * hides behind an ellipsis.
 *
 * The first and last segments always stay visible: the workspace root and the
 * document must remain reachable without opening the ellipsis.
 */
export function condenseBreadcrumbSegments(segments: BreadcrumbSegment[]): {
  visible: BreadcrumbSegment[]
  hidden: BreadcrumbSegment[]
} {
  if (segments.length <= 2) return { visible: segments, hidden: [] }
  return {
    visible: [segments[0], segments[segments.length - 1]],
    hidden: segments.slice(1, -1)
  }
}
