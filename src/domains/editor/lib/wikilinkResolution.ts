/** Shared note identity rules for wikilink completion, validation, and navigation. */

/** Normalizes path spelling for comparison while preserving meaningful accents. */
export function normalizeWikilinkNotePath(value: string): string {
  // Treat "notes/Topic.markdown" and "notes/Topic" as the same note.
  return value.trim().replace(/\\/g, '/').normalize('NFC').replace(/\.(md|markdown)$/i, '').toLowerCase()
}

/** Matches a full path or a path suffix, including a bare note title. */
export function matchesWikilinkNotePath(target: string, query: string): boolean {
  const path = normalizeWikilinkNotePath(target)
  const wanted = normalizeWikilinkNotePath(query)
  return Boolean(wanted) && (path === wanted || path.endsWith(`/${wanted}`))
}

/**
 * Resolves a wikilink target against known markdown files.
 *
 * Priority:
 * - exact file match, such as `tools.md`
 * - directory index match, such as `tools/index.md`
 * - unique basename match
 * - unique suffix match
 */
export function resolveExistingWikilinkPath(normalizedTarget: string, markdownFiles: string[]): string | null {
  const withoutExtension = normalizeWikilinkNotePath(normalizedTarget)
  const exact = markdownFiles.find((path) => normalizeWikilinkNotePath(path) === withoutExtension)
  if (exact) return exact

  const indexMatch = markdownFiles.find((path) => normalizeWikilinkNotePath(path) === `${withoutExtension}/index`)
  if (indexMatch) return indexMatch

  const basenameMatches = markdownFiles.filter((path) => {
    const normalized = normalizeWikilinkNotePath(path)
    const stem = normalized.split('/').pop() ?? normalized
    return stem === withoutExtension
  })
  if (basenameMatches.length === 1) return basenameMatches[0]

  const suffixMatches = markdownFiles.filter((path) => {
    const normalized = normalizeWikilinkNotePath(path)
    return normalized.endsWith(`/${withoutExtension}`)
  })
  if (suffixMatches.length === 1) return suffixMatches[0]

  return null
}

