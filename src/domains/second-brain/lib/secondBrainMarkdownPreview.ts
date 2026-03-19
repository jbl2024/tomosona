import { marked } from 'marked'
import { sanitizeHtmlForPreview } from '../../../shared/lib/htmlSanitizer'

/**
 * Shared Second Brain preview renderer.
 *
 * This keeps the preview HTML generation local to the app, but delegates the
 * markdown parsing itself to `marked` so block handling stays consistent for
 * lists, tables, line breaks, and inline formatting.
 */
const SECOND_BRAIN_MARKED_OPTIONS = {
  gfm: true,
  breaks: true
} as const

/**
 * Converts markdown into sanitized HTML for Second Brain message previews.
 */
export function renderSecondBrainMarkdownPreview(source: string): string {
  const markdown = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!markdown.trim()) return ''

  const html = marked.parse(markdown, SECOND_BRAIN_MARKED_OPTIONS)
  return sanitizeHtmlForPreview(String(html ?? ''))
}
