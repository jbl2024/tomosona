import { describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from './useDocumentEditorSessions'
import { useEditorSessionStatus } from './useEditorSessionStatus'

function createSession(): DocumentSession {
  return {
    path: 'notes/a.md',
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

describe('useEditorSessionStatus', () => {
  it('mutates session flags and forwards status patch events', () => {
    const session = createSession()
    const patchStatus = vi.fn()
    const controls = useEditorSessionStatus({
      getSession: (path) => (path === session.path ? session : null),
      ensureSession: () => session,
      patchStatus,
      clearAutosaveTimer: vi.fn(),
      scheduleAutosave: vi.fn()
    })

    controls.setDirty(session.path, true)
    controls.setSaving(session.path, true)
    controls.setSaveError(session.path, 'boom')

    expect(session.dirty).toBe(true)
    expect(session.saving).toBe(true)
    expect(session.saveError).toBe('boom')
    expect(patchStatus).toHaveBeenNthCalledWith(1, session.path, { dirty: true })
    expect(patchStatus).toHaveBeenNthCalledWith(2, session.path, { saving: true })
    expect(patchStatus).toHaveBeenNthCalledWith(3, session.path, { saveError: 'boom' })
  })

  it('does not schedule autosave when target path session is missing', () => {
    const scheduleAutosave = vi.fn()
    const controls = useEditorSessionStatus({
      getSession: () => null,
      ensureSession: () => createSession(),
      patchStatus: vi.fn(),
      clearAutosaveTimer: vi.fn(),
      scheduleAutosave
    })

    controls.scheduleAutosave('missing.md')
    expect(scheduleAutosave).not.toHaveBeenCalled()
  })

  it('forwards timer actions for valid sessions', () => {
    const clearAutosaveTimer = vi.fn()
    const scheduleAutosave = vi.fn()
    const controls = useEditorSessionStatus({
      getSession: () => createSession(),
      ensureSession: () => createSession(),
      patchStatus: vi.fn(),
      clearAutosaveTimer,
      scheduleAutosave
    })

    controls.clearAutosaveTimer()
    controls.scheduleAutosave('notes/a.md')

    expect(clearAutosaveTimer).toHaveBeenCalledTimes(1)
    expect(scheduleAutosave).toHaveBeenCalledTimes(1)
  })
})
