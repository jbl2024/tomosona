/**
 * Embedded note restoration helpers.
 *
 * Purpose:
 * - Resolve embedded note markdown to the exact fragment requested by its target.
 * - Rebuild that fragment into a Tiptap doc for inline restoration.
 *
 * Boundary:
 * - This module only performs pure markdown selection/rebuild work.
 * - File IO and editor transactions stay in the host composable/component.
 */
import type { JSONContent } from '@tiptap/vue-3'
import { markdownToEditorData, type EditorBlock } from './markdownBlocks'
import { parseFrontmatterEnvelope } from '../../../shared/lib/markdownFrontmatter'
import { normalizeBlockId, normalizeHeadingAnchor, parseWikilinkTarget, slugifyHeading } from './wikilinks'
import { toTiptapDoc } from './tiptap/editorBlocksToTiptapDoc'

const HEADING_RE = /^(#{1,6})\s+(.*)$/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function headingMatchesAnchor(lineHeading: string, anchorHeading: string): boolean {
  return normalizeHeadingAnchor(lineHeading) === normalizeHeadingAnchor(anchorHeading)
    || slugifyHeading(lineHeading) === slugifyHeading(anchorHeading)
}

function extractHeadingSectionMarkdown(body: string, heading: string): string | null {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n')
  const headingLineIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE)
    return Boolean(match && headingMatchesAnchor(match[2] ?? '', heading))
  })
  if (headingLineIndex < 0) return null

  const currentLevel = Number(lines[headingLineIndex].match(HEADING_RE)?.[1]?.length ?? 0)
  let end = lines.length
  for (let index = headingLineIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(HEADING_RE)
    if (!match) continue
    if (match[1].length <= currentLevel) {
      end = index
      break
    }
  }

  return lines.slice(headingLineIndex, end).join('\n').trimEnd()
}

function extractBlockIdSectionMarkdown(body: string, blockId: string): string | null {
  const wanted = normalizeBlockId(blockId)
  if (!wanted) return null

  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n')
  const matcher = new RegExp(`(^|\\s)\\^${escapeRegExp(wanted)}(\\s|$)`, 'i')
  const lineIndex = lines.findIndex((line) => matcher.test(line))
  if (lineIndex < 0) return null

  let end = lineIndex + 1
  while (end < lines.length && lines[end].trim().length > 0) {
    end += 1
  }

  const blockLines = lines.slice(lineIndex, end)
  blockLines[0] = blockLines[0]
    .replace(new RegExp(`\\s*\\^${escapeRegExp(wanted)}\\s*$`, 'i'), '')
    .replace(/\s+$/g, '')
  return blockLines.join('\n').trimEnd()
}

function stripWikilinkAlias(target: string): string {
  const value = String(target ?? '').trim()
  if (!value) return ''

  const aliasIndex = value.indexOf('|')
  if (aliasIndex < 0) return value

  return value.slice(0, aliasIndex).trim()
}

/**
 * Resolves the markdown fragment represented by a note embed target.
 *
 * Returns:
 * - the full note body when the target has no anchor
 * - the matching heading section for `#heading`
 * - a best-effort block slice for `^block-id`
 * - `null` when the target cannot be resolved
 */
export function resolveEmbeddedNoteMarkdown(markdown: string, target: string): string | null {
  const body = parseFrontmatterEnvelope(markdown).body
  const parsed = parseWikilinkTarget(stripWikilinkAlias(target))

  if (!parsed.anchor) return body
  if (parsed.anchor.heading) return extractHeadingSectionMarkdown(body, parsed.anchor.heading)
  if (parsed.anchor.blockId) return extractBlockIdSectionMarkdown(body, parsed.anchor.blockId)
  return body
}

/**
 * Rebuilds the requested embedded note fragment as a Tiptap doc.
 *
 * Returns `null` when the target cannot be resolved against the markdown.
 */
export function embeddedNoteMarkdownToTiptapDoc(markdown: string, target?: string): JSONContent | null {
  const resolvedMarkdown = target ? resolveEmbeddedNoteMarkdown(markdown, target) : parseFrontmatterEnvelope(markdown).body
  if (resolvedMarkdown === null) return null
  if (!resolvedMarkdown.trim()) return { type: 'doc', content: [] }

  const parsed = markdownToEditorData(resolvedMarkdown)
  // Embeds are compact projections inside a host document. Their structural
  // spacing is represented by the host, not by empty paragraphs in the slice.
  const blocks = (parsed.blocks as EditorBlock[]).filter((block) =>
    block.type !== 'paragraph' || String(block.data.text ?? '').trim().length > 0
  )
  return toTiptapDoc(blocks)
}
