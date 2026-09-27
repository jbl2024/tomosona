/** Builds ranked wikilink suggestions; existing note identities take priority over creation. */
import { matchesWikilinkNotePath, normalizeWikilinkNotePath, resolveExistingWikilinkPath } from '../wikilinkResolution'
import type { WikilinkCandidate } from './plugins/wikilinkState'

/** Data loaders and the current draft used to build completion rows. */
export type BuildWikilinkCandidatesOptions = {
  query: string
  loadTargets: () => Promise<string[]>
  loadHeadings: (target: string) => Promise<string[]>
  currentHeadings: () => string[]
  resolve: (target: string) => Promise<boolean>
}

function parseQuery(raw: string): { notePart: string; headingPart: string | null } {
  const targetPart = raw.split('|', 1)[0]?.trim() ?? ''
  if (!targetPart) return { notePart: '', headingPart: null }
  if (targetPart.startsWith('#')) return { notePart: '', headingPart: targetPart.slice(1).trim() }
  const hashIndex = targetPart.indexOf('#')
  if (hashIndex < 0) return { notePart: targetPart, headingPart: null }
  return {
    notePart: targetPart.slice(0, hashIndex).trim(),
    headingPart: targetPart.slice(hashIndex + 1).trim()
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/** Ranks existing notes before creation and checks identity before limiting results. */
export async function buildWikilinkCandidates(options: BuildWikilinkCandidatesOptions): Promise<WikilinkCandidate[]> {
  const parsed = parseQuery(options.query)

  if (parsed.headingPart !== null) {
    const headings = parsed.notePart ? await options.loadHeadings(parsed.notePart) : options.currentHeadings()
    const query = parsed.headingPart.toLowerCase()
    return unique(headings)
      .filter((heading) => !query || heading.toLowerCase().includes(query))
      .slice(0, 24)
      .map((heading) => {
        const target = parsed.notePart ? `${parsed.notePart}#${heading}` : `#${heading}`
        return { target, label: `#${heading}`, exists: true }
      })
  }

  const targets = await options.loadTargets()
  const query = normalizeWikilinkNotePath(parsed.notePart)
  const resolved = query ? resolveExistingWikilinkPath(parsed.notePart, targets) : null
  const exactMatches = targets.filter((target) => matchesWikilinkNotePath(target, parsed.notePart))
  const rank = (target: string) => target === resolved ? 0 : matchesWikilinkNotePath(target, parsed.notePart) ? 1 : 2
  const filtered = targets
    .filter((target) => target === resolved || !query || normalizeWikilinkNotePath(target).includes(query))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 24)

  const out: WikilinkCandidate[] = await Promise.all(filtered.map(async (target) => ({
    target,
    exists: await options.resolve(target)
  })))

  // Ambiguous titles need a path choice, not an invitation to create a duplicate.
  if (query && !resolved && !exactMatches.length) {
    out.push({
      target: parsed.notePart,
      label: `Create "${parsed.notePart}"`,
      exists: false,
      isCreate: true
    })
  }

  return out
}
