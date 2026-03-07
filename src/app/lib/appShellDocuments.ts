import { fileName } from './appShellPaths'

/**
 * Module: appShellDocuments
 *
 * Purpose:
 * - Centralize pure helpers used by the app shell for note names, wikilink
 *   target resolution, heading extraction, and entry modal path defaults.
 */

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN_FILE_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g
const FORBIDDEN_FILE_NAME_CHARS_RE = /[<>:"\\|?*\u0000-\u001f]/
const MAX_FILE_STEM_LENGTH = 120

/** Returns the human-readable note title derived from a markdown file path. */
export function noteTitleFromPath(path: string): string {
  const filename = fileName(path).replace(/\.(md|markdown)$/i, '')
  return filename || 'Untitled'
}

/** Returns the markdown extension preserved for rename operations. */
export function markdownExtensionFromPath(path: string): string {
  const name = fileName(path)
  const match = name.match(/\.(md|markdown)$/i)
  return match ? match[0] : '.md'
}

/** Sanitizes a note title into a cross-platform filename-safe stem. */
export function sanitizeTitleForFileName(raw: string): string {
  const cleaned = raw
    .replace(FORBIDDEN_FILE_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  const base = cleaned.slice(0, MAX_FILE_STEM_LENGTH).trim()
  if (!base) return 'Untitled'
  if (base === '.' || base === '..') return 'Untitled'
  if (WINDOWS_RESERVED_NAME_RE.test(base)) return `${base}-note`
  return base
}

/** Returns true when a single entry segment contains forbidden filesystem characters. */
export function hasForbiddenEntryNameChars(name: string): boolean {
  return FORBIDDEN_FILE_NAME_CHARS_RE.test(name)
}

/** Returns true when an entry name is reserved by Windows filesystems. */
export function isReservedEntryName(name: string): boolean {
  return WINDOWS_RESERVED_NAME_RE.test(name)
}

/** Extracts deduplicated headings from markdown for wikilink heading completion. */
export function extractHeadingsFromMarkdown(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)$/)
    if (!match) continue
    const raw = match[1].trim()
    if (!raw) continue
    const text = raw
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => (alias ?? target))
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_~]/g, '')
      .trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }

  return out
}

/** Resolves a wikilink target against known markdown files using exact, basename, then suffix matching. */
export function resolveExistingWikilinkPath(normalizedTarget: string, markdownFiles: string[]): string | null {
  const withoutExtension = normalizedTarget.replace(/\.(md|markdown)$/i, '').toLowerCase()
  const exact = markdownFiles.find((path) => path.replace(/\.(md|markdown)$/i, '').toLowerCase() === withoutExtension)
  if (exact) return exact

  const basenameMatches = markdownFiles.filter((path) => {
    const normalized = path.replace(/\.(md|markdown)$/i, '').toLowerCase()
    const stem = normalized.split('/').pop() ?? normalized
    return stem === withoutExtension
  })
  if (basenameMatches.length === 1) return basenameMatches[0]

  const suffixMatches = markdownFiles.filter((path) => {
    const normalized = path.replace(/\.(md|markdown)$/i, '').toLowerCase()
    return normalized.endsWith(`/${withoutExtension}`)
  })
  if (suffixMatches.length === 1) return suffixMatches[0]

  return null
}

/** Derives a workspace-relative path prefix from a parent directory path. */
export function parentPrefixForModal(parentPath: string, root: string): string {
  if (!root) return ''
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedParent || normalizedParent === normalizedRoot) return ''
  if (!normalizedParent.startsWith(`${normalizedRoot}/`)) return ''
  const relative = normalizedParent.slice(normalizedRoot.length + 1)
  return relative ? `${relative}/` : ''
}
