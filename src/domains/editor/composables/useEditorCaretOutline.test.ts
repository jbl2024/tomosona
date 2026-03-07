import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from './useDocumentEditorSessions'
import { useEditorCaretOutline } from './useEditorCaretOutline'

function createSession(path: string): DocumentSession {
  return {
    path,
    editor: {} as any,
    loadedText: '',
    isLoaded: true,
    dirty: false,
    saving: false,
    saveError: '',
    scrollTop: 0,
    caret: null,
    autosaveTimer: null,
    outlineTimer: null
  }
}

describe('useEditorCaretOutline', () => {
  it('captures and restores clamped caret selection', () => {
    const session = createSession('notes/a.md')
    const setTextSelection = vi.fn()
    const editor = {
      state: {
        selection: { from: 2, to: 8 },
        doc: { content: { size: 6 } }
      },
      commands: { setTextSelection }
    }

    const controls = useEditorCaretOutline({
      currentPath: ref(session.path),
      getSession: (path) => (path === session.path ? session : null),
      getEditor: () => editor as any,
      emitOutline: vi.fn(),
      parseOutlineFromDoc: () => []
    })

    controls.captureCaret(session.path)
    expect(session.caret).toEqual({ kind: 'pm-selection', from: 2, to: 8 })

    const restored = controls.restoreCaret(session.path)
    expect(restored).toBe(true)
    expect(setTextSelection).toHaveBeenCalledWith({ from: 2, to: 6 })
  })

  it('debounces outline emits and drops stale path transitions', () => {
    vi.useFakeTimers()
    const session = createSession('notes/a.md')
    const emitOutline = vi.fn()
    const currentPath = ref(session.path)
    const controls = useEditorCaretOutline({
      currentPath,
      getSession: (path) => (path === session.path ? session : null),
      getEditor: () => null,
      emitOutline,
      parseOutlineFromDoc: () => [{ level: 1, text: 'Title' }],
      outlineDelayMs: 50
    })

    controls.emitOutlineSoon(session.path)
    currentPath.value = 'notes/b.md'
    vi.advanceTimersByTime(60)
    expect(emitOutline).not.toHaveBeenCalled()

    currentPath.value = session.path
    controls.emitOutlineSoon(session.path)
    vi.advanceTimersByTime(60)
    expect(emitOutline).toHaveBeenCalledWith({
      path: session.path,
      headings: [{ level: 1, text: 'Title' }]
    })
    vi.useRealTimers()
  })

  it('clears existing session outline timers', () => {
    vi.useFakeTimers()
    const session = createSession('notes/a.md')
    const emitOutline = vi.fn()
    const controls = useEditorCaretOutline({
      currentPath: ref(session.path),
      getSession: () => session,
      getEditor: () => null,
      emitOutline,
      parseOutlineFromDoc: () => [],
      outlineDelayMs: 100
    })

    controls.emitOutlineSoon(session.path)
    controls.clearOutlineTimer(session.path)
    vi.advanceTimersByTime(120)
    expect(emitOutline).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
