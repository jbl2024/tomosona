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
