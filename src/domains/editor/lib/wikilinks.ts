export type WikilinkAnchor = {
  heading?: string
  blockId?: string
}

export type ParsedWikilinkTarget = {
  notePath: string
  anchor: WikilinkAnchor | null
}

export function parseWikilinkTarget(raw: string): ParsedWikilinkTarget {
  const value = String(raw ?? '').trim()
  if (!value) return { notePath: '', anchor: null }

  const hashIndex = value.indexOf('#')
  if (hashIndex < 0) {
    return { notePath: value, anchor: null }
  }

  const notePath = value.slice(0, hashIndex).trim()
  const fragment = value.slice(hashIndex + 1).trim()
  if (!fragment) {
    return { notePath, anchor: null }
  }

  if (fragment.startsWith('^')) {
    const blockId = normalizeBlockId(fragment)
    return { notePath, anchor: blockId ? { blockId } : null }
  }

  const heading = fragment.trim()
  return { notePath, anchor: heading ? { heading } : null }
}

export function normalizeBlockId(value: string): string {
  return value.trim().replace(/^\^+/, '').toLowerCase()
}

export function normalizeHeadingAnchor(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function slugifyHeading(value: string): string {
  return normalizeHeadingAnchor(value)
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(md|markdown)$/i, '')
}

export function inferDeepWikilinkAlias(target: string): string | null {
  const parsed = parseWikilinkTarget(target)
  const notePath = parsed.notePath.replace(/\\/g, '/').trim()
  if (!notePath || !notePath.includes('/')) return null

  const segments = notePath.split('/').filter(Boolean)
  const rawLast = segments[segments.length - 1]?.trim() ?? ''
  if (!rawLast) return null

  const alias = stripMarkdownExtension(rawLast).trim()
  return alias || null
}

export function buildWikilinkToken(target: string, alias?: string | null): string {
  const normalizedTarget = String(target ?? '').trim()
  const normalizedAlias = String(alias ?? '').trim()
  if (!normalizedTarget) return '[[]]'

  if (normalizedAlias) {
    return `[[${normalizedTarget}|${normalizedAlias}]]`
  }

  const inferred = inferDeepWikilinkAlias(normalizedTarget)
  if (inferred && inferred !== normalizedTarget) {
    return `[[${normalizedTarget}|${inferred}]]`
  }
  return `[[${normalizedTarget}]]`
}

export function buildWikilinkDraftToken(target: string): string {
  const normalizedTarget = String(target ?? '').trim()
  return `[[${normalizedTarget}`
}
