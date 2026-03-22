import { describe, expect, it } from 'vitest'
import { getBlockStructureLabel, toBlockMenuTarget, toSelectionBlockMenuTarget } from './guards'
import type { BlockMenuTarget } from './types'

function target(overrides: Partial<BlockMenuTarget>): BlockMenuTarget {
  return {
    pos: 0,
    nodeType: 'paragraph',
    nodeSize: 1,
    canDelete: true,
    canConvert: true,
    text: '',
    ...overrides
  }
}

describe('getBlockStructureLabel', () => {
  it('returns short labels for common block types', () => {
    expect(getBlockStructureLabel(target({ nodeType: 'paragraph' }))).toBe('P')
    expect(getBlockStructureLabel(target({ nodeType: 'codeBlock' }))).toBe('Code')
    expect(getBlockStructureLabel(target({ nodeType: 'taskList' }))).toBe('List')
    expect(getBlockStructureLabel(target({ nodeType: 'quoteBlock' }))).toBe('Quote')
    expect(getBlockStructureLabel(target({ nodeType: 'calloutBlock' }))).toBe('Callout')
    expect(getBlockStructureLabel(target({ nodeType: 'mermaidBlock' }))).toBe('Mermaid')
    expect(getBlockStructureLabel(target({ nodeType: 'htmlBlock' }))).toBe('HTML')
    expect(getBlockStructureLabel(target({ nodeType: 'tableCell' }))).toBe('Table')
  })

  it('includes heading level when present', () => {
    expect(getBlockStructureLabel(target({ nodeType: 'heading', attrs: { level: 1 } }))).toBe('H1')
    expect(getBlockStructureLabel(target({ nodeType: 'heading', attrs: { level: 2 } }))).toBe('H2')
    expect(getBlockStructureLabel(target({ nodeType: 'heading', attrs: { level: 3 } }))).toBe('H3')
    expect(getBlockStructureLabel(target({ nodeType: 'heading', attrs: { level: 6 } }))).toBe('H6')
  })

  it('falls back to a humanized node type for uncommon blocks', () => {
    expect(getBlockStructureLabel(target({ nodeType: 'customBlock' }))).toBe('Custom')
  })

  it('returns an empty label when no target is active', () => {
    expect(getBlockStructureLabel(null)).toBe('')
  })
})

describe('toBlockMenuTarget', () => {
  it('copies node attrs so downstream UI can read the heading level', () => {
    const node = {
      type: { name: 'heading' },
      nodeSize: 3,
      attrs: { level: 2 },
      textContent: 'Title'
    } as any

    expect(toBlockMenuTarget(node, 5)).toEqual({
      pos: 5,
      nodeType: 'heading',
      nodeSize: 3,
      canDelete: true,
      canConvert: true,
      text: 'Title',
      attrs: { level: 2 }
    })
  })
})

describe('toSelectionBlockMenuTarget', () => {
  it('maps a collapsed heading or paragraph selection to its containing block', () => {
    const headingNode = {
      type: { name: 'heading' },
      nodeSize: 4,
      attrs: { level: 2 },
      textContent: 'Title'
    } as any
    const paragraphNode = {
      type: { name: 'paragraph' },
      nodeSize: 3,
      attrs: {},
      textContent: 'Body'
    } as any

    const headingSelection = {
      state: {
        selection: {
          $from: {
            depth: 1,
            parent: headingNode,
            before: () => 1
          }
        }
      }
    } as any
    const paragraphSelection = {
      state: {
        selection: {
          $from: {
            depth: 1,
            parent: paragraphNode,
            before: () => 5
          }
        }
      }
    } as any

    expect(toSelectionBlockMenuTarget(headingSelection)).toMatchObject({
      nodeType: 'heading',
      attrs: { level: 2 },
      text: 'Title'
    })
    expect(toSelectionBlockMenuTarget(paragraphSelection)).toMatchObject({
      nodeType: 'paragraph',
      text: 'Body'
    })
  })

  it('returns null for non-textblock selections', () => {
    const editor = {
      state: {
        selection: {
          $from: {
            depth: 1,
            parent: { type: { name: 'bulletList' } },
            before: () => 1
          }
        }
      }
    } as any

    expect(toSelectionBlockMenuTarget(editor)).toBeNull()
  })
})
