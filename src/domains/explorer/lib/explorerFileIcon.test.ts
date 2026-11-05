import { describe, expect, it } from 'vitest'
import { explorerFileBadge, explorerFileKind } from './explorerFileIcon'

const file = (name: string) => ({ name, is_dir: false, is_markdown: false })

describe('explorerFileKind', () => {
  it.each([
    ['photo.JPEG', 'image'], ['report.pdf', 'pdf'], ['book.xlsx', 'spreadsheet'],
    ['talk.pptx', 'presentation'], ['song.flac', 'audio'], ['clip.mp4', 'video'],
    ['backup.tar.gz', 'archive'], ['app.ts', 'code'], ['config.yaml', 'data'],
    ['letter.docx', 'document'], ['readme.txt', 'text']
  ] as const)('classifies %s as %s', (name, kind) => {
    expect(explorerFileKind(file(name))).toBe(kind)
  })

  it('prioritizes folders and markdown and handles unknown names', () => {
    expect(explorerFileKind({ ...file('photo.png'), is_dir: true })).toBe('folder')
    expect(explorerFileKind({ ...file('note.md'), is_markdown: true })).toBe('markdown')
    for (const name of ['README', '.json', 'file.', 'file.unknown']) {
      expect(explorerFileKind(file(name))).toBe('file')
    }
  })
})

describe('explorerFileBadge', () => {
  it.each(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'ods', 'odt', 'odp', 'pdf', 'pages', 'numbers', 'keynote'])('labels %s files', (extension) => {
    expect(explorerFileBadge(file(`example.${extension.toUpperCase()}`))).toBe(extension.toUpperCase())
  })

  it('does not label folders or unrelated files', () => {
    expect(explorerFileBadge({ ...file('example.pdf'), is_dir: true })).toBeNull()
    expect(explorerFileBadge(file('example.png'))).toBeNull()
  })
})
