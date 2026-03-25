/**
 * Markdown-to-preview renderer for Second Brain message bodies.
 *
 * Keep preview rendering in a small dedicated module so the Vue surfaces can
 * reuse the same sanitization and markdown options everywhere assistant text is
 * displayed.
 */
import { marked } from 'marked'
import { sanitizeHtmlForPreview } from '../../../shared/lib/htmlSanitizer'

/**
 * `marked` options chosen for chat-style message rendering.
 *
 * `gfm` keeps tables and task lists working; `breaks` matches the chat UX where
 * line breaks should be visible without needing hard markdown paragraphs.
 */
const SECOND_BRAIN_MARKED_OPTIONS = {
  gfm: true,
  breaks: true
} as const

/**
 * Converts markdown into sanitized HTML for Second Brain message previews.
 *
 * Empty or whitespace-only input returns an empty string so the caller can keep
 * placeholder assistant messages visually quiet until streamed content arrives.
 */
export function renderSecondBrainMarkdownPreview(source: string): string {
  const markdown = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!markdown.trim()) return ''

  const html = marked.parse(markdown, SECOND_BRAIN_MARKED_OPTIONS)
  return sanitizeHtmlForPreview(String(html ?? ''))
}
