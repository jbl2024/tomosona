import type { WikilinkCandidate } from './plugins/wikilinkState'

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
  const query = parsed.notePart.toLowerCase()
  const filtered = targets
    .filter((target) => !query || target.toLowerCase().includes(query))
    .slice(0, 24)

  const candidates = await Promise.all(filtered.map(async (target) => ({
    target,
    exists: await options.resolve(target)
  })))

  const out: WikilinkCandidate[] = candidates
  const exact = out.some((entry) => entry.target.toLowerCase() === query)
  if (query && !exact) {
    out.unshift({
      target: parsed.notePart,
      label: `Create "${parsed.notePart}"`,
      exists: false,
      isCreate: true
    })
  }

  return out
}
