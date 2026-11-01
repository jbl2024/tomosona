/** Plans individual link targets against the same resolver used by navigation.
 * This is read-only: callers must separately inspect content, handle warnings,
 * and validate file versions before applying any change.
 */
import { resolveExistingWikilinkPath, normalizeWikilinkNotePath } from '../../domains/editor/lib/wikilinkResolution'
import { normalizeWorkspacePath } from '../../domains/explorer/lib/workspacePaths'
import type { PathMove } from '../../shared/api/apiTypes'
import { resolveNoteLinkPath } from './noteLinkResolution'

/** Outcome for one reference; uncertain results must not be silently rewritten. */
export type NoteReferenceImpact =
  | { kind: 'unchanged' }
  | { kind: 'rewrite'; target: string }
  | { kind: 'uncertain'; reason: 'ambiguous_paths' | 'unresolved_target' | 'unsupported_target' }

/** Inputs for checking one wiki or relative Markdown link without touching files. */
export type NoteReferenceImpactInput = {
  workspacePath: string
  sourcePath: string
  target: string
  kind: 'wikilink' | 'markdown'
  markdownPaths: string[]
  moves: PathMove[]
}

function cleanPath(path: string): string {
  return normalizeWorkspacePath(path).replace(/\/+$/, '')
}

function movedPath(path: string, moves: PathMove[]): string {
  const current = cleanPath(path)
  const ordered = moves.map((move) => ({ from: cleanPath(move.from), to: cleanPath(move.to) }))
    .filter((move) => move.from && move.to)
    .sort((a, b) => b.from.length - a.from.length)
  for (const move of ordered) {
    if (current === move.from || current.startsWith(`${move.from}/`)) return `${move.to}${current.slice(move.from.length)}`
  }
  return current
}

function absolutePath(path: string, root: string): string {
  const normalized = cleanPath(path)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) ? normalized : `${root}/${normalized}`
}

function hasAmbiguousIdentities(paths: string[]): boolean {
  const identities = new Set<string>()
  for (const path of paths) {
    const identity = normalizeWikilinkNotePath(path)
    if (identities.has(identity)) return true
    identities.add(identity)
  }
  return false
}

function relativePath(fromFile: string, target: string, root: string): string | null {
  if (!fromFile.startsWith(`${root}/`) || !target.startsWith(`${root}/`)) return null
  const from = fromFile.slice(root.length + 1).split('/').slice(0, -1)
  const to = target.slice(root.length + 1).split('/')
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift() }
  const relative = [...from.map(() => '..'), ...to].join('/')
  return relative.startsWith('../') ? relative : `./${relative}`
}

function physicalRelativeTarget(source: string, target: string, root: string): string | null {
  if (!source.startsWith(`${root}/`) || target.startsWith('/')) return null
  const segments = source.slice(root.length + 1).split('/').slice(0, -1)
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!segments.length) return null
      segments.pop()
    } else segments.push(part)
  }
  return `${root}/${segments.join('/')}`
}

/** Computes whether an individual note link still resolves after proposed moves. */
export function planNoteReferenceImpact(input: NoteReferenceImpactInput): NoteReferenceImpact {
  const root = cleanPath(input.workspacePath)
  const source = cleanPath(input.sourcePath)
  const target = input.target.trim()
  if (!root || !source || !target) return { kind: 'uncertain', reason: 'unsupported_target' }
  const suffixIndex = input.kind === 'wikilink' ? target.search(/[#|]/) : target.indexOf('#')
  const pathPart = suffixIndex < 0 ? target : target.slice(0, suffixIndex)
  const suffix = suffixIndex < 0 ? '' : target.slice(suffixIndex)
  if (!pathPart) return { kind: 'unchanged' }
  // Date-only links have a dedicated journal resolution path, e.g. [[2026-11-01]].
  if (/^\d{4}-\d{2}-\d{2}$/.test(pathPart) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(pathPart)) {
    return { kind: 'uncertain', reason: 'unsupported_target' }
  }
  const before = input.markdownPaths.map((path) => absolutePath(path, root))
  const after = before.map((path) => movedPath(path, input.moves))
  if (hasAmbiguousIdentities(before) || hasAmbiguousIdentities(after)) return { kind: 'uncertain', reason: 'ambiguous_paths' }
  const original = resolveNoteLinkPath(pathPart, root, source, before, resolveExistingWikilinkPath)?.existing
  if (!original) return { kind: 'uncertain', reason: 'unresolved_target' }
  const expected = movedPath(absolutePath(original, root), input.moves)
  const newSource = movedPath(source, input.moves)
  const current = resolveNoteLinkPath(pathPart, root, newSource, after, resolveExistingWikilinkPath)?.existing
  const physical = input.kind === 'markdown' || pathPart.startsWith('./') || pathPart.startsWith('../')
    ? physicalRelativeTarget(newSource, pathPart, root)
    : null
  const keepsPhysicalTarget = input.kind !== 'markdown' && !pathPart.startsWith('./') && !pathPart.startsWith('../')
    || Boolean(physical && normalizeWikilinkNotePath(physical) === normalizeWikilinkNotePath(expected))
  if (current && cleanPath(absolutePath(current, root)) === expected && keepsPhysicalTarget) return { kind: 'unchanged' }
  if (!expected.startsWith(`${root}/`)) return { kind: 'uncertain', reason: 'unsupported_target' }
  let replacement: string | null
  if (input.kind === 'wikilink') {
    replacement = expected.slice(root.length + 1)
    if (!/\.(md|markdown)$/i.test(pathPart)) replacement = replacement.replace(/\.(md|markdown)$/i, '')
  } else {
    replacement = relativePath(newSource, expected, root)
    // Complex Markdown destinations require source-aware parsing/escaping.
    if (replacement && /[\s()<>%#]/.test(replacement)) replacement = null
    if (replacement && !/\.(md|markdown)$/i.test(pathPart)) replacement = replacement.replace(/\.(md|markdown)$/i, '')
  }
  if (!replacement) return { kind: 'uncertain', reason: 'unsupported_target' }
  const verified = resolveNoteLinkPath(replacement, root, newSource, after, resolveExistingWikilinkPath)?.existing
  if (!verified || cleanPath(absolutePath(verified, root)) !== expected) return { kind: 'uncertain', reason: 'unsupported_target' }
  return { kind: 'rewrite', target: `${replacement}${suffix}` }
}
