/**
 * Supported explicit search mode prefixes.
 */
export type SearchMode = 'hybrid' | 'semantic' | 'lexical'

type SearchModeApplyResult = {
  value: string
  caret: number
}

const MODE_PREFIXES: Array<{ mode: SearchMode; prefix: string }> = [
  { mode: 'semantic', prefix: 'semantic:' },
  { mode: 'lexical', prefix: 'lexical:' },
  { mode: 'hybrid', prefix: 'hybrid:' }
]

function detectLeadingModePrefix(value: string): { mode: SearchMode; rest: string } | null {
  const trimmedStart = value.trimStart()
  const lowered = trimmedStart.toLowerCase()
  for (const entry of MODE_PREFIXES) {
    if (!lowered.startsWith(entry.prefix)) continue
    return {
      mode: entry.mode,
      rest: trimmedStart.slice(entry.prefix.length).trimStart()
    }
  }
  return null
}

/**
 * Resolves search mode from the current query string.
 *
 * The mode prefix is recognized only when it is the leading token.
 */
export function detectSearchMode(value: string): SearchMode {
  const parsed = detectLeadingModePrefix(value)
  return parsed?.mode ?? 'hybrid'
}

/**
 * Removes known mode prefix from the beginning of query text.
 */
export function stripSearchModePrefix(value: string): string {
  const parsed = detectLeadingModePrefix(value)
  if (!parsed) return value.trim()
  return parsed.rest
}

/**
 * Applies/replaces query mode prefix and returns suggested caret position.
 */
export function applySearchMode(value: string, mode: SearchMode): SearchModeApplyResult {
  const base = stripSearchModePrefix(value)
  if (mode === 'hybrid') {
    return { value: base, caret: 0 }
  }
  const prefix = `${mode}: `
  return {
    value: `${prefix}${base}`.trimEnd(),
    caret: prefix.length
  }
}
