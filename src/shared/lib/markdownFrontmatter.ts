/**
 * Shared markdown frontmatter envelope extraction.
 *
 * Does:
 * - normalize line endings
 * - split a leading `--- ... ---` block from the markdown body
 * - return raw YAML text plus the remaining body
 *
 * Does not:
 * - parse YAML into fields
 * - validate frontmatter keys or values
 * - know anything about editor or alter domain rules
 */
function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n')
}

export type FrontmatterEnvelope = {
  hasFrontmatter: boolean
  rawYaml: string
  body: string
}

/**
 * Splits a markdown document into frontmatter YAML and body content.
 */
export function parseFrontmatterEnvelope(markdown: string): FrontmatterEnvelope {
  const normalized = normalizeNewlines(markdown)
  if (!normalized.startsWith('---\n')) {
    return { hasFrontmatter: false, rawYaml: '', body: normalized }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex < 0) {
    return { hasFrontmatter: false, rawYaml: '', body: normalized }
  }

  const rawYaml = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5)
  return { hasFrontmatter: true, rawYaml, body }
}
