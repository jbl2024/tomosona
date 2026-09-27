import { normalizeWorkspacePath, toWorkspaceRelativePath } from '../../domains/explorer/lib/workspacePaths'
import { fileName, isMarkdownPath } from './appShellPaths'
export { resolveExistingWikilinkPath } from '../../domains/editor/lib/wikilinkResolution'

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
const BINARY_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
  '.svgz',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.epub',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.jar',
  '.apk',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.iso',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.wav',
  '.flac',
  '.aac',
  '.ogg',
  '.m4a',
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.webm'
])
const SOURCE_FILE_NAMES = new Set([
  'dockerfile',
  'makefile',
  'gnumakefile',
  'cmakelists.txt',
  'procfile',
  'readme',
  'readme.md',
  'readme.markdown',
  'license',
  'copying',
  'changelog',
  'authors',
  'contributors',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmignore',
  '.npmrc',
  '.yarnrc',
  '.dockerignore',
  '.env',
  '.env.example',
  'justfile',
  'brewfile',
  'rakefile',
  'gemfile',
  'podfile',
  'cargo.lock',
  'package.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'eslint.config.js'
])

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

/** Returns true when a file should default to raw text editing. */
export function isSourceTextPath(path: string): boolean {
  const name = fileName(path).trim().toLowerCase()
  if (!name) return false
  if (isMarkdownPath(name)) return false
  if (SOURCE_FILE_NAMES.has(name)) return true

  const match = name.match(/\.[^.]+$/)
  if (!match) return true
  return !BINARY_FILE_EXTENSIONS.has(match[0])
}

/** Returns the default editor surface for a path. */
export function editorSurfaceModeForPath(path: string): 'rich' | 'source' {
  return isMarkdownPath(path) ? 'rich' : 'source'
}

/** Returns a short label describing the source editor file type. */
export function sourceEditorLanguageLabelForPath(path: string): string {
  const name = fileName(path)
  const lower = name.toLowerCase()
  const ext = (name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
  if (!ext) return SOURCE_FILE_NAMES.has(lower) ? lower : 'text'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  return ext.slice(1)
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

/** Returns true when a virtual document save only contains the title line. */
export function isTitleOnlyContent(content: string, titleLine: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return normalized === '' || normalized === titleLine
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

/** Derives a workspace-relative path prefix from a parent directory path. */
export function parentPrefixForModal(parentPath: string, root: string): string {
  if (!root) return ''
  const normalizedRoot = normalizeWorkspacePath(root).replace(/\/+$/, '')
  const normalizedParent = normalizeWorkspacePath(parentPath).replace(/\/+$/, '')
  if (!normalizedRoot || !normalizedParent) return ''
  const relative = toWorkspaceRelativePath(normalizedRoot, normalizedParent)
  if (!relative || relative === '.' || relative === normalizedParent) return ''
  return `${relative.replace(/\/+$/, '')}/`
}
