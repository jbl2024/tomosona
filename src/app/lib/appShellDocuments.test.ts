import { describe, expect, it } from 'vitest'
import {
  extractHeadingsFromMarkdown,
  hasForbiddenEntryNameChars,
  isReservedEntryName,
  markdownExtensionFromPath,
  noteTitleFromPath,
  parentPrefixForModal,
  resolveExistingWikilinkPath,
  sanitizeTitleForFileName
} from './appShellDocuments'

describe('appShellDocuments', () => {
  it('derives note titles and markdown extensions from paths', () => {
    expect(noteTitleFromPath('/vault/notes/Hello.md')).toBe('Hello')
    expect(markdownExtensionFromPath('/vault/notes/Hello.markdown')).toBe('.markdown')
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

  it('resolves existing wikilink targets by exact and basename match', () => {
    const files = ['notes/a.md', 'journal/2026-03-06.md', 'deep/nested/topic.md']
    expect(resolveExistingWikilinkPath('notes/a', files)).toBe('notes/a.md')
    expect(resolveExistingWikilinkPath('topic', files)).toBe('deep/nested/topic.md')
  })

  it('derives a modal prefix from a workspace parent path', () => {
    expect(parentPrefixForModal('/vault/notes/projects', '/vault')).toBe('notes/projects/')
    expect(parentPrefixForModal('/vault', '/vault')).toBe('')
  })
})
