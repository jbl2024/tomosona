import type { PathMove } from '../../shared/api/apiTypes'

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameOrDescendant(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

/**
 * Normalizes and sorts path moves so descendant rewrites prefer the most
 * specific matching source prefix.
 */
export function sortPathMoves(moves: PathMove[]): PathMove[] {
  return moves
    .map((move) => ({
      from: normalizePath(move.from),
      to: normalizePath(move.to)
    }))
    .filter((move) => move.from && move.to && move.from !== move.to)
    .sort((left, right) => right.from.length - left.from.length || left.from.localeCompare(right.from))
}

/** Rewrites a path using the first matching move prefix. */
export function rewritePathWithMoves(path: string, moves: PathMove[]): string {
  const normalizedPath = normalizePath(path)
  if (!normalizedPath) return ''

  for (const move of sortPathMoves(moves)) {
    if (!isSameOrDescendant(normalizedPath, move.from)) continue
    return `${move.to}${normalizedPath.slice(move.from.length)}`
  }

  return normalizedPath
}

/**
 * Expands folder moves into exact per-path pairs for the provided candidates.
 * This is used by shell state that tracks individual note paths.
 */
export function expandPathMoves(moves: PathMove[], candidates: string[]): PathMove[] {
  const normalizedMoves = sortPathMoves(moves)
  const expanded = new Map<string, PathMove>()

  for (const candidate of candidates) {
    const from = normalizePath(candidate)
    if (!from) continue
    const to = rewritePathWithMoves(from, normalizedMoves)
    if (!to || to === from) continue
    expanded.set(from.toLowerCase(), { from, to })
  }

  return Array.from(expanded.values()).sort((left, right) => left.from.localeCompare(right.from))
}
