import { describe, expect, it } from 'vitest'
import { buildBreadcrumbSegments, condenseBreadcrumbSegments } from './breadcrumbSegments'

describe('buildBreadcrumbSegments', () => {
  it('splits a nested note into folder segments and a document segment', () => {
    expect(buildBreadcrumbSegments('/vault', '/vault/Projets/AsciiArts.md')).toEqual([
      { kind: 'folder', label: 'Projets', path: '/vault/Projets' },
      { kind: 'document', label: 'AsciiArts', path: '/vault/Projets/AsciiArts.md' }
    ])
  })

  it('keeps the extension out of the document label but not out of its path', () => {
    const segments = buildBreadcrumbSegments('/vault', '/vault/Notes.md')
    expect(segments).toEqual([
      { kind: 'document', label: 'Notes', path: '/vault/Notes.md' }
    ])
  })

  it('returns a single segment for a note at the workspace root', () => {
    expect(buildBreadcrumbSegments('/vault', '/vault/Notes.md')).toHaveLength(1)
  })

  it('returns nothing for an empty path', () => {
    expect(buildBreadcrumbSegments('/vault', '')).toEqual([])
  })

  it('keeps non-Markdown files intact', () => {
    expect(buildBreadcrumbSegments('/vault', '/vault/src/App.vue')).toEqual([
      { kind: 'folder', label: 'src', path: '/vault/src' },
      { kind: 'document', label: 'App.vue', path: '/vault/src/App.vue' }
    ])
  })
})

describe('condenseBreadcrumbSegments', () => {
  const segments = buildBreadcrumbSegments(
    '/vault',
    '/vault/Connaissances/Methodes/Organisation/Notes atomiques.md'
  )

  it('keeps the first and last segments and hides the middle', () => {
    const { visible, hidden } = condenseBreadcrumbSegments(segments)
    expect(visible.map((segment) => segment.label)).toEqual(['Connaissances', 'Notes atomiques'])
    expect(hidden.map((segment) => segment.label)).toEqual(['Methodes', 'Organisation'])
  })

  it('hides nothing when the breadcrumb already fits', () => {
    const short = buildBreadcrumbSegments('/vault', '/vault/Projets/AsciiArts.md')
    expect(condenseBreadcrumbSegments(short)).toEqual({ visible: short, hidden: [] })
  })
})
