import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useDocumentEditorSessions } from './useDocumentEditorSessions'

function createEditorStub() {
  const destroy = vi.fn()
  return {
    editor: { destroy } as unknown as Editor,
    destroy
  }
}

describe('useDocumentEditorSessions', () => {
  it('creates and reuses sessions by path', () => {
    const first = createEditorStub()
    const second = createEditorStub()
    const createEditor = vi
      .fn<(path: string) => Editor>()
      .mockReturnValueOnce(first.editor)
      .mockReturnValueOnce(second.editor)

    const store = useDocumentEditorSessions({ createEditor })

    const a1 = store.ensureSession('a.md')
    const a2 = store.ensureSession('a.md')
    const b = store.ensureSession('b.md')

    expect(a2.path).toBe('a.md')
    expect(a1.path).toBe('a.md')
    expect(b.path).toBe('b.md')
    expect(createEditor).toHaveBeenCalledTimes(2)
  })

  it('tracks active pane path and rewires on rename', () => {
    const stub = createEditorStub()
    const store = useDocumentEditorSessions({
      createEditor: () => stub.editor
    })

    store.ensureSession('old.md')
    store.setActivePath('main', 'old.md')
    store.setActivePath('secondary', 'old.md')
    store.renamePath('old.md', 'new.md')

    expect(store.getSession('old.md')).toBeNull()
    expect(store.getSession('new.md')?.path).toBe('new.md')
    expect(store.getActivePath('main')).toBe('new.md')
    expect(store.getActivePath('secondary')).toBe('new.md')
  })

  it('closes a single path and clears timers', () => {
    vi.useFakeTimers()
    try {
      const stub = createEditorStub()
      const store = useDocumentEditorSessions({
        createEditor: () => stub.editor
      })
      const session = store.ensureSession('note.md')
      session.autosaveTimer = setTimeout(() => {}, 1_000)
      session.outlineTimer = setTimeout(() => {}, 2_000)

      store.closePath('note.md')

      expect(stub.destroy).toHaveBeenCalledTimes(1)
      expect(store.getSession('note.md')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes all sessions', () => {
    const a = createEditorStub()
    const b = createEditorStub()
    const createEditor = vi
      .fn<(path: string) => Editor>()
      .mockReturnValueOnce(a.editor)
      .mockReturnValueOnce(b.editor)

    const store = useDocumentEditorSessions({ createEditor })
    store.ensureSession('a.md')
    store.ensureSession('b.md')

    store.closeAll()

    expect(a.destroy).toHaveBeenCalledTimes(1)
    expect(b.destroy).toHaveBeenCalledTimes(1)
    expect(store.listPaths()).toEqual([])
  })

  it('clears active pane when closing active path', () => {
    const stub = createEditorStub()
    const store = useDocumentEditorSessions({
      createEditor: () => stub.editor
    })

    store.ensureSession('active.md')
    store.setActivePath('main', 'active.md')
    store.setActivePath('secondary', 'active.md')
    store.closePath('active.md')

    expect(store.getActivePath('main')).toBe('')
    expect(store.getActivePath('secondary')).toBe('')
  })

  it('throws when ensuring a blank path', () => {
    const store = useDocumentEditorSessions({
      createEditor: () => createEditorStub().editor
    })

    expect(() => store.ensureSession('   ')).toThrow('Path is required to create a document session.')
  })

  it('ignores rename for missing path', () => {
    const store = useDocumentEditorSessions({
      createEditor: () => createEditorStub().editor
    })

    const result = store.renamePath('missing.md', 'next.md')

    expect(result).toBeNull()
    expect(store.listPaths()).toEqual([])
  })
})
