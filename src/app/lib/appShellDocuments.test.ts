import { describe, expect, it } from 'vitest'
import {
  editorSurfaceModeForPath,
  extractHeadingsFromMarkdown,
  hasForbiddenEntryNameChars,
  isReservedEntryName,
  isSourceTextPath,
  markdownExtensionFromPath,
  noteLinkToken,
  noteTitleFromPath,
  parentPrefixForModal,
  sourceEditorLanguageLabelForPath,
  resolveExistingWikilinkPath,
  sanitizeTitleForFileName
} from './appShellDocuments'

describe('appShellDocuments', () => {
  it('derives note titles and markdown extensions from paths', () => {
    expect(noteTitleFromPath('/vault/notes/Hello.md')).toBe('Hello')
    expect(markdownExtensionFromPath('/vault/notes/Hello.markdown')).toBe('.markdown')
  })

  it('builds a note link from the workspace-relative path, not the bare title', () => {
    expect(noteLinkToken('/vault', '/vault/bar/foo.md')).toBe('[[bar/foo|foo]]')
    expect(noteLinkToken('/vault', '/vault/bar/baz/foo.markdown')).toBe('[[bar/baz/foo|foo]]')
  })

  it('keeps a root-level note link free of a folder segment', () => {
    expect(noteLinkToken('/vault', '/vault/foo.md')).toBe('[[foo]]')
  })

  it('falls back to the bare title for a note outside the workspace', () => {
    expect(noteLinkToken('/vault', '/elsewhere/foo.md')).toBe('[[foo]]')
    expect(noteLinkToken('', '/elsewhere/foo.md')).toBe('[[foo]]')
  })

  it('classifies source text files and editor surfaces by extension', () => {
    expect(isSourceTextPath('/vault/note.txt')).toBe(true)
    expect(isSourceTextPath('/vault/note.md')).toBe(false)
    expect(isSourceTextPath('/vault/app.ts')).toBe(true)
    expect(isSourceTextPath('/vault/App.vue')).toBe(true)
    expect(isSourceTextPath('/vault/style.css')).toBe(true)
    expect(isSourceTextPath('/vault/main.cpp')).toBe(true)
    expect(isSourceTextPath('/vault/something.desktop')).toBe(true)
    expect(isSourceTextPath('/vault/Dockerfile')).toBe(true)
    expect(isSourceTextPath('/vault/Makefile')).toBe(true)
    expect(isSourceTextPath('/vault/README')).toBe(true)
    expect(isSourceTextPath('/vault/image.png')).toBe(false)
    expect(isSourceTextPath('/vault/archive.zip')).toBe(false)
    expect(editorSurfaceModeForPath('/vault/note.md')).toBe('rich')
    expect(editorSurfaceModeForPath('/vault/note.txt')).toBe('source')
    expect(sourceEditorLanguageLabelForPath('/vault/config.toml')).toBe('toml')
    expect(sourceEditorLanguageLabelForPath('/vault/note.md')).toBe('markdown')
    expect(sourceEditorLanguageLabelForPath('/vault/Dockerfile')).toBe('dockerfile')
  })

  it('sanitizes titles and validates entry names', () => {
    expect(sanitizeTitleForFileName('  con<>:"  ')).toBe('con-note')
    expect(hasForbiddenEntryNameChars('bad:name')).toBe(true)
    expect(isReservedEntryName('nul')).toBe(true)
  })

  it('extracts unique headings from markdown', () => {
    expect(
      extractHeadingsFromMarkdown('# Hello\n## [[Target|Alias]]\n## Alias\n### `Code`')
    ).toEqual(['Hello', 'Alias', 'Code'])
  })

  it('resolves existing wikilink targets by exact, index, and basename match', () => {
    const files = [
      'notes/a.md',
      'journal/2026/03/2026-03-06.md',
      'deep/nested/topic.md',
      'notes/tools/index.md',
      'notes/tools.md'
    ]
    expect(resolveExistingWikilinkPath('notes/a', files)).toBe('notes/a.md')
    expect(resolveExistingWikilinkPath('topic', files)).toBe('deep/nested/topic.md')
    expect(resolveExistingWikilinkPath('notes/tools', files)).toBe('notes/tools.md')
  })

  it('prefers a directory index when the exact markdown file is missing', () => {
    const files = ['notes/tools/index.md']
    expect(resolveExistingWikilinkPath('notes/tools', files)).toBe('notes/tools/index.md')
  })

  it('returns null when neither the file nor its index exists', () => {
    expect(resolveExistingWikilinkPath('notes/tools', [])).toBeNull()
  })

  it('derives a modal prefix from a workspace parent path', () => {
    expect(parentPrefixForModal('/vault/notes/projects', '/vault')).toBe('notes/projects/')
    expect(parentPrefixForModal('/vault', '/vault')).toBe('')
  })

  it('normalizes Windows device-prefixed parent paths before deriving modal prefixes', () => {
    expect(parentPrefixForModal('\\\\?\\D:\\vault\\notes\\projects', 'D:/vault')).toBe('notes/projects/')
  })

  it('derives modal prefixes case-insensitively for matching workspace paths', () => {
    expect(parentPrefixForModal('d:/vault/notes/projects', 'D:/Vault')).toBe('notes/projects/')
  })
})
