/**
 * Note title heading extraction and composition.
 *
 * A note whose body starts with a level-1 heading that repeats the file name
 * treats that heading as the note title: loading strips it from the editor
 * body and saving regenerates it from the file name. These helpers own that
 * text contract; the document lifecycle decides when they apply.
 *
 * Does:
 * - match an ATX level-1 heading (`# Title`) on the first non-empty line
 *   against a note title, comparing trimmed text
 * - strip the matched heading plus any leading blank lines from the body
 * - compose the canonical stored form (heading, one blank line, body)
 *
 * Does not:
 * - decide whether a note is in the synced state (lifecycle owns that)
 * - handle frontmatter (the caller passes the body after frontmatter parsing)
 * - support setext headings (`Title` + `===` underline) — ATX only, per design
 */

/** ATX level-1 heading with mandatory inner spacing, e.g. "# My Note" (not "#NoSpace"). */
const ATX_H1_RE = /^#\s+(.+?)\s*$/

export type TitleHeadingMatch = {
  /** The matched heading text, trimmed. */
  text: string
}

function toLines(body: string): string[] {
  return body.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Returns the first non-empty line index of a body, or -1 when the body has
 * no content lines.
 */
function firstContentLineIndex(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim()) return index
  }
  return -1
}

/**
 * Matches the body's first non-empty line as a level-1 heading against the
 * note title. Comparison is exact on trimmed text.
 *
 * Example: matchTitleHeading('# My Note\nBody', 'My Note') → { text: 'My Note' }.
 */
export function matchTitleHeading(body: string, title: string): TitleHeadingMatch | null {
  const lines = toLines(body)
  const index = firstContentLineIndex(lines)
  if (index < 0) return null
  const match = lines[index].match(ATX_H1_RE)
  if (!match) return null
  const headingText = match[1].trim()
  if (headingText !== title.trim()) return null
  return { text: headingText }
}

/**
 * Removes the leading blank lines plus the matched heading line from a body
 * already known to match. The remainder becomes the editor body.
 */
export function stripTitleHeading(body: string): string {
  const lines = toLines(body)
  const index = firstContentLineIndex(lines)
  if (index < 0) return ''
  const remainder = lines.slice(index + 1)
  while (remainder.length && !remainder[0].trim()) remainder.shift()
  return remainder.join('\n')
}

/**
 * Composes the canonical stored form: `# <title>`, one blank line, then the
 * body. An empty body composes to the heading alone.
 */
export function composeTitleHeading(title: string, body: string): string {
  const heading = `# ${title.trim()}`.trimEnd()
  const trimmedBody = body.replace(/\r\n?/g, '\n').replace(/^\n+/, '')
  if (!trimmedBody.trim()) return heading
  return `${heading}\n\n${trimmedBody}`
}
