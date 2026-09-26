import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/api/apiTypes'
import { filterExplorerRows } from './explorerFilter'

function dirNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    is_markdown: false,
    has_children: true
  }
}

function fileNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    is_markdown: true,
    has_children: false
  }
}

describe('filterExplorerRows', () => {
  const childrenByDir = {
    '/vault': [
      dirNode('/vault/features'),
      dirNode('/vault/journal'),
      dirNode('/vault/Résumés'),
      fileNode('/vault/inbox.md'),
      fileNode('/vault/Project Notes.md')
    ],
    '/vault/features': [
      fileNode('/vault/features/related.md')
    ],
    '/vault/journal': [
      fileNode('/vault/journal/2026/03/2026-03-12.md'),
      fileNode('/vault/journal/2026/03/2026-03-13.md')
    ],
    '/vault/Résumés': [
      fileNode('/vault/Résumés/thèmes.md')
    ]
  }

  const visibleRows = [
    { path: '/vault/features', depth: 0 },
    { path: '/vault/journal', depth: 0 },
    { path: '/vault/Résumés', depth: 0 },
    { path: '/vault/inbox.md', depth: 0 },
    { path: '/vault/Project Notes.md', depth: 0 }
  ]

  it('keeps the current rows when the filter is empty', () => {
    expect(filterExplorerRows('', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual(visibleRows)
  })

  it('keeps the current rows when the filter normalizes to empty whitespace', () => {
    expect(filterExplorerRows('   ', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual(visibleRows)
  })

  it('keeps ancestor directories for fuzzy child matches', () => {
    expect(filterExplorerRows('rel', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/features', depth: 0 },
      { path: '/vault/features/related.md', depth: 1 }
    ])
  })

  it('matches non-contiguous fuzzy queries against names and paths', () => {
    expect(filterExplorerRows('jr13', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/journal', depth: 0 },
      { path: '/vault/journal/2026/03/2026-03-13.md', depth: 1 }
    ])
  })

  it('matches case-insensitively', () => {
    expect(filterExplorerRows('PROJECT', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/Project Notes.md', depth: 0 }
    ])
  })

  it('matches direct substrings before needing fuzzy fallback', () => {
    expect(filterExplorerRows('notes', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/Project Notes.md', depth: 0 }
    ])
  })

  it('matches accent-insensitively', () => {
    expect(filterExplorerRows('theme', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/Résumés', depth: 0 },
      { path: '/vault/Résumés/thèmes.md', depth: 1 }
    ])
  })

  it('matches accent-insensitively on directory names too', () => {
    expect(filterExplorerRows('resume', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/Résumés', depth: 0 },
      { path: '/vault/Résumés/thèmes.md', depth: 1 }
    ])
  })

  it('matches through the full normalized path, not only the basename', () => {
    expect(filterExplorerRows('resumetheme', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/Résumés', depth: 0 },
      { path: '/vault/Résumés/thèmes.md', depth: 1 }
    ])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterExplorerRows('zzz', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([])
  })

  it('includes a matching directory and path-matching children beneath it', () => {
    expect(filterExplorerRows('journal', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/journal', depth: 0 },
      { path: '/vault/journal/2026/03/2026-03-12.md', depth: 1 },
      { path: '/vault/journal/2026/03/2026-03-13.md', depth: 1 }
    ])
  })

  it('includes all matching descendants under a matching directory', () => {
    expect(filterExplorerRows('journal2', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/journal', depth: 0 },
      { path: '/vault/journal/2026/03/2026-03-12.md', depth: 1 },
      { path: '/vault/journal/2026/03/2026-03-13.md', depth: 1 }
    ])
  })

  it('works with partially loaded trees by only searching loaded directories', () => {
    const partiallyLoadedTree = {
      '/vault': [
        dirNode('/vault/features'),
        fileNode('/vault/inbox.md')
      ]
    }

    expect(filterExplorerRows('related', visibleRows, { rootPath: '/vault', childrenByDir: partiallyLoadedTree })).toEqual([])
  })

  it('preserves row order from the tree traversal', () => {
    expect(filterExplorerRows('2', visibleRows, { rootPath: '/vault', childrenByDir })).toEqual([
      { path: '/vault/journal', depth: 0 },
      { path: '/vault/journal/2026/03/2026-03-12.md', depth: 1 },
      { path: '/vault/journal/2026/03/2026-03-13.md', depth: 1 }
    ])
  })
})
