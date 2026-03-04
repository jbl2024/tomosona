import { describe, expect, it, vi } from 'vitest'
import { useEditorSlashInsertion } from './useEditorSlashInsertion'

describe('useEditorSlashInsertion', () => {
  function createChain() {
    return {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      toggleOrderedList: vi.fn().mockReturnThis(),
      toggleTaskList: vi.fn().mockReturnThis(),
      toggleBulletList: vi.fn().mockReturnThis(),
      insertContent: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true)
    }
  }

  it('inserts ordered list and consumes slash token range', () => {
    const chain = createChain()
    const editor = { chain: vi.fn(() => chain) } as any
    const insertion = useEditorSlashInsertion({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({ text: '/li', nodeType: 'paragraph', from: 10, to: 13 }),
      readSlashContext: () => ({ from: 10, to: 13 })
    })

    const ok = insertion.insertBlockFromDescriptor('list', { style: 'ordered' })

    expect(ok).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 10, to: 13 })
    expect(chain.toggleOrderedList).toHaveBeenCalled()
  })

  it('inserts structural content when slash context is absent', () => {
    const chain = createChain()
    const editor = { chain: vi.fn(() => chain) } as any
    const insertion = useEditorSlashInsertion({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({ text: '/h2', nodeType: 'paragraph', from: 5, to: 8 }),
      readSlashContext: () => null
    })

    const ok = insertion.insertBlockFromDescriptor('header', { level: 2, text: 'Roadmap' }, { replaceRange: { from: 5, to: 8 } })

    expect(ok).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 5, to: 8 })
    expect(chain.insertContent).toHaveBeenCalledWith({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Roadmap' }]
    })
    expect(chain.run).toHaveBeenCalled()
  })

  it('returns false when editor is unavailable', () => {
    const insertion = useEditorSlashInsertion({
      getEditor: () => null,
      currentTextSelectionContext: () => ({ text: '', nodeType: 'paragraph', from: 1, to: 1 }),
      readSlashContext: () => null
    })

    expect(insertion.insertBlockFromDescriptor('code', {})).toBe(false)
  })

  it('inserts html block payload', () => {
    const chain = createChain()
    const editor = { chain: vi.fn(() => chain) } as any
    const insertion = useEditorSlashInsertion({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({ text: '/html', nodeType: 'paragraph', from: 2, to: 7 }),
      readSlashContext: () => ({ from: 2, to: 7 })
    })

    const ok = insertion.insertBlockFromDescriptor('html', { html: '<div>test</div>' })

    expect(ok).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 2, to: 7 })
    expect(chain.insertContent).toHaveBeenCalledWith({
      type: 'htmlBlock',
      attrs: { html: '<div>test</div>' }
    })
  })
})
