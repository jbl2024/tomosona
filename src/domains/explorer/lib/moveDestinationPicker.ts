/**
 * Module: moveDestinationPicker
 *
 * Purpose:
 * - Compute the searchable destination list for a move command so invalid
 *   targets are unavailable with an explanation instead of failing silently.
 *
 * Boundaries:
 * - Pure list building over known folder paths and the normalized selection;
 *   no filesystem access. Execution still goes through the safe move boundary.
 */

import { normalizeWorkspacePath } from './workspacePaths'

/** One selectable destination row in the move picker. */
export type MoveDestination = {
  path: string
  /** Workspace-relative label, or "Workspace root" for the root itself. */
  label: string
  disabled: boolean
  /** Why the destination cannot receive the selection, when disabled. */
  reason?: string
}

/** Inputs for building the destination list. */
export type MoveDestinationInput = {
  root: string
  /** All known folder paths (absolute), including the workspace root. */
  folders: string[]
  /** Normalized selection: ancestors kept, covered descendants removed. */
  sources: string[]
  /** Most-recent-first destination paths from persisted preferences. */
  recentDestinations?: string[]
  /** Parent lookup for workspace paths; returns '' above the root. */
  parentOf: (path: string) => string
}

function clean(path: string): string {
  return normalizeWorkspacePath(path).replace(/\/+$/, '')
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

function relativeLabel(root: string, path: string): string {
  if (path === root) return 'Workspace root'
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/**
 * Builds the destination list for a move: workspace root first, then recent
 * destinations, then remaining folders alphabetically. Destinations that are
 * part of the selection, inside a moved folder, or already the selection's
 * parent are listed as disabled with an explicit reason.
 */
export function listMoveDestinations(input: MoveDestinationInput): MoveDestination[] {
  const root = clean(input.root)
  const sources = input.sources.map(clean).filter(Boolean)
  const folders = Array.from(new Set(input.folders.map(clean).filter(Boolean)))
  const recent = (input.recentDestinations ?? []).map(clean).filter(Boolean)

  const destinations = new Map<string, MoveDestination>()

  for (const folder of [root, ...folders]) {
    if (destinations.has(folder)) continue
    let disabled = false
    let reason: string | undefined

    if (folder === root && sources.some((source) => source === root)) {
      disabled = true
      reason = 'The workspace root cannot be moved'
    } else if (sources.some((source) => isSameOrDescendant(folder, source))) {
      disabled = true
      reason = sources.includes(folder) ? 'This folder is part of the selection' : 'Inside a moved folder'
    } else if (sources.length > 0 && sources.every((source) => clean(input.parentOf(source)) === folder)) {
      disabled = true
      reason = 'Already in this folder'
    }

    destinations.set(folder, {
      path: folder,
      label: relativeLabel(root, folder),
      disabled,
      reason
    })
  }

  const recentOrdered = recent.filter((path) => path !== root && destinations.has(path))
  const rest = folders
    .filter((path) => path !== root && !recentOrdered.includes(path) && destinations.has(path))
    .sort((left, right) => destinations.get(left)!.label.localeCompare(destinations.get(right)!.label))

  return [destinations.get(root)!, ...recentOrdered.map((path) => destinations.get(path)!), ...rest.map((path) => destinations.get(path)!)]
}

/** Filters destination rows by a search query, matching label substrings. */
export function filterMoveDestinations(destinations: MoveDestination[], query: string): MoveDestination[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return destinations
  return destinations.filter((destination) => destination.label.toLowerCase().includes(needle))
}
