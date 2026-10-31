export type SearchSnippetPart = {
  text: string
  highlighted: boolean
}

export function parseSearchSnippet(snippet: string): SearchSnippetPart[] {
  const source = String(snippet ?? '')
  if (!source) return [{ text: '', highlighted: false }]

  const parts: SearchSnippetPart[] = []
  const tokens = source.split(/(<\/?b>)/gi)
  let highlighted = false
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === '<b>') {
      highlighted = true
      continue
    }
    if (lower === '</b>') {
      highlighted = false
      continue
    }
    if (!token) continue
    parts.push({ text: token, highlighted })
  }

  return parts.length ? parts : [{ text: source, highlighted: false }]
}

/**
 * Strips index markup (`<b>`, other tags) and collapses whitespace into a
 * plain-text search string.
 */
function toPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Plain-text search strings for revealing a snippet inside the rendered
 * document, in priority order: the full snippet with index markers removed
 * and the FTS window ellipses stripped (the index truncates windows with
 * `...` at the boundaries, which never appear in the document), then each
 * highlighted match segment. Example: `"...des <b>notes</b> reliées..."`
 * yields `["des notes reliées", "notes"]`.
 */
export function snippetRevealTargets(snippet: string): string[] {
  const source = String(snippet ?? '')
  if (!source.trim()) return []

  const targets: string[] = []
  const push = (value: string) => {
    const plain = toPlainText(value)
    if (plain && !targets.includes(plain)) targets.push(plain)
  }

  push(source.replace(/^\s*\.{3}/, '').replace(/\.{3}\s*$/, ''))

  for (const part of parseSearchSnippet(source)) {
    if (part.highlighted) push(part.text)
  }

  return targets
}
