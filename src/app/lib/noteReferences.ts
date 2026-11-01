/**
 * Module: noteReferences
 *
 * Purpose:
 * - Extract wiki and Markdown note references from raw note content so callers
 *   can plan safe rewrites without touching files.
 *
 * Boundaries:
 * - Pure text scanning: no filesystem access and no resolution. Ambiguity and
 *   target validation happen in noteReferenceImpact.
 * - Wikilink scanning mirrors the backend rewriter: any `[[...]]` token is a
 *   candidate, including `![[...]]` embeds whose `!` prefix is preserved.
 * - Markdown links are kept only when parseRelativeMarkdownHref accepts them
 *   as relative note targets; URLs, pure anchors and assets are ignored.
 */

import { parseRelativeMarkdownHref } from '../../domains/editor/lib/markdownBlocks'

export type NoteReferenceKind = 'wikilink' | 'markdown'

/** One note reference found in content, with the span its target occupies. */
export type NoteReference = {
  kind: NoteReferenceKind
  /** Raw target text as written, including any `#fragment` or `|alias` suffix. */
  target: string
  /** Start offset of the replaceable target span inside the content. */
  start: number
  /** End offset (exclusive) of the replaceable target span. */
  end: number
}

// Wikilink or embed token, e.g. "[[notes/Topic#A|Alias]]" or "![[img.png]]".
// The inner target cannot contain brackets or newlines.
const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+)\]\]/g

// Markdown link, e.g. "[label](./notes/Topic.md#A \"Title\")"; group 3/4 is the href.
const MARKDOWN_LINK_RE = /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))[^)]*\)/g

/**
 * Extracts every note reference from markdown content in document order.
 *
 * The returned spans cover exactly the target text (inside `[[...]]` or the
 * `(...)` href), so replacing a span never touches labels, aliases or the
 * surrounding syntax.
 */
export function extractNoteReferences(content: string): NoteReference[] {
  const references: NoteReference[] = []
  const text = String(content ?? '')

  WIKILINK_RE.lastIndex = 0
  let match = WIKILINK_RE.exec(text)
  while (match) {
    const innerStart = match.index + match[0].indexOf('[[') + 2
    references.push({ kind: 'wikilink', target: match[2], start: innerStart, end: innerStart + match[2].length })
    match = WIKILINK_RE.exec(text)
  }

  MARKDOWN_LINK_RE.lastIndex = 0
  match = MARKDOWN_LINK_RE.exec(text)
  while (match) {
    // Images are assets, not note references.
    if (match[1] !== '!') {
      const href = (match[3] ?? match[4] ?? '').trim()
      if (href && parseRelativeMarkdownHref(href)) {
        const hrefStart = match[0].indexOf('](') + 2
        const start = match[0].indexOf(href, hrefStart)
        if (start >= 0) {
          references.push({ kind: 'markdown', target: href, start: match.index + start, end: match.index + start + href.length })
        }
      }
    }
    match = MARKDOWN_LINK_RE.exec(text)
  }

  return references.sort((left, right) => left.start - right.start)
}
