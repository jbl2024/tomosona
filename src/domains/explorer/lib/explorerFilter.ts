/**
 * Module: explorerFilter
 *
 * Purpose:
 * - Keep explorer tree filtering pure and testable.
 * - Preserve tree context by keeping ancestor directories for matching rows.
 *
 * Boundaries:
 * - This module never performs I/O or mutates explorer state.
 * - It only derives visible rows from already loaded tree snapshots.
 */

import type { TreeNode } from '../../../shared/api/apiTypes'
import type { ExplorerVisibleRow } from '../composables/useExplorerTreeState'

type FilterTreeOptions = {
  rootPath: string
  childrenByDir: Record<string, TreeNode[]>
}

/**
 * Returns the explorer rows visible for the given filter query.
 *
 * Behavior:
 * - empty queries keep the current expanded/collapsed visible rows unchanged
 * - non-empty queries walk the loaded tree, keep fuzzy matches, and retain
 *   ancestor directories so result rows still read like a tree
 */
export function filterExplorerRows(
  query: string,
  visibleRows: ExplorerVisibleRow[],
  options: FilterTreeOptions
): ExplorerVisibleRow[] {
  const normalizedQuery = normalizeForSearch(query)
  if (!normalizedQuery) {
    return visibleRows
  }

  return collectMatches(options.rootPath, 0, options.childrenByDir, normalizedQuery)
}

function collectMatches(
  dirPath: string,
  depth: number,
  childrenByDir: Record<string, TreeNode[]>,
  normalizedQuery: string
): ExplorerVisibleRow[] {
  const rows: ExplorerVisibleRow[] = []
  const children = childrenByDir[dirPath] ?? []

  for (const child of children) {
    const descendantRows = child.is_dir
      ? collectMatches(child.path, depth + 1, childrenByDir, normalizedQuery)
      : []
    const matchesSelf = matchesExplorerQuery(child, normalizedQuery)

    if (!matchesSelf && !descendantRows.length) {
      continue
    }

    rows.push({ path: child.path, depth })
    rows.push(...descendantRows)
  }

  return rows
}

function matchesExplorerQuery(node: TreeNode, normalizedQuery: string): boolean {
  const name = normalizeForSearch(node.name)
  return fuzzyIncludes(name, normalizedQuery)
}

function normalizeForSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function fuzzyIncludes(candidate: string, query: string): boolean {
  if (!query) return true
  if (candidate.includes(query)) return true

  let queryIndex = 0
  for (const char of candidate) {
    if (char === query[queryIndex]) {
      queryIndex += 1
      if (queryIndex === query.length) {
        return true
      }
    }
  }

  return false
}

/** Returns the character positions matching a fuzzy name query, or an empty set. */
export function explorerMatchPositions(name: string, query: string): Set<number> {
  const needle = normalizeForSearch(query)
  if (!needle) return new Set()
  const chars = Array.from(name)
  const normalized = chars.map((char) => char.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  const joined = normalized.join('')
  const start = joined.indexOf(needle)
  const indexes: number[] = []
  if (start >= 0) {
    for (let i = start; i < start + needle.length; i++) indexes.push(i)
  } else {
    let next = 0
    for (let i = 0; i < joined.length && next < needle.length; i++) {
      if (joined[i] === needle[next]) { indexes.push(i); next++ }
    }
    if (next !== needle.length) return new Set()
  }
  const positions = new Set<number>()
  let offset = 0
  normalized.forEach((part, index) => {
    if (indexes.some((position) => position >= offset && position < offset + part.length)) positions.add(index)
    offset += part.length
  })
  return positions
}

/** Whether a node's own name matches the local explorer query. */
export function explorerNameMatches(node: TreeNode, query: string): boolean {
  const normalized = normalizeForSearch(query)
  return Boolean(normalized && matchesExplorerQuery(node, normalized))
}
