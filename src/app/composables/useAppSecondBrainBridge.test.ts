import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppSecondBrainBridge } from './useAppSecondBrainBridge'

function createBridge() {
  const workingFolderPath = ref('/vault')
  const activeFilePath = ref('/vault/notes/a.md')
  const errorMessage = ref('')
  const notifySuccess = vi.fn()
  const loadDeliberationSession = vi.fn(async (sessionId: string) => ({
    session_id: sessionId,
    context_items: [{ path: '/vault/notes/a.md' }]
  }))
  const replaceSessionContext = vi.fn(async () => {})

  const bridge = useAppSecondBrainBridge({
    workingFolderPath,
    activeFilePath,
    errorMessage,
    notifySuccess,
    storageKeyForWorkspace: (workspacePath) => `sb:${workspacePath}`,
    toAbsoluteWorkspacePath: (_workspacePath, path) => path,
    normalizeContextPathsForUpdate: (_workspacePath, paths) => Array.from(new Set(paths.filter(Boolean))),
    createDeliberationSession: vi.fn(async () => ({ sessionId: 'session-new' })),
    loadDeliberationSession,
    replaceSessionContext
  })

  return {
    workingFolderPath,
    activeFilePath,
    errorMessage,
    notifySuccess,
    loadDeliberationSession,
    replaceSessionContext,
    bridge
  }
}

describe('useAppSecondBrainBridge', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('does not auto-request the persisted session when the workspace changes', () => {
    window.localStorage.setItem('sb:/vault-2', 'session-2')
    const { workingFolderPath, bridge } = createBridge()

    workingFolderPath.value = '/vault-2'
    return nextTick().then(() => {
      expect(bridge.secondBrainRequestedSessionId.value).toBe('')
      expect(bridge.secondBrainRequestedSessionNonce.value).toBe(2)
    })
  })

  it('adds the active note to the requested session context', async () => {
    const { bridge, replaceSessionContext, notifySuccess } = createBridge()
    bridge.setSecondBrainSessionId('session-1')

    const ok = await bridge.addActiveNoteToSecondBrain()

    expect(ok).toBe(true)
    expect(replaceSessionContext).toHaveBeenCalledWith('session-1', ['/vault/notes/a.md'])
    expect(notifySuccess).toHaveBeenCalledWith('Active note added to Second Brain context.')
  })

  it('reuses the persisted session for targeted add-to-second-brain actions', async () => {
    window.localStorage.setItem('sb:/vault', 'session-persisted')
    const { bridge, replaceSessionContext, loadDeliberationSession } = createBridge()

    const ok = await bridge.addActiveNoteToSecondBrain()

    expect(ok).toBe(true)
    expect(loadDeliberationSession).toHaveBeenCalledWith('session-persisted')
    expect(replaceSessionContext).toHaveBeenCalledWith('session-persisted', ['/vault/notes/a.md'])
  })

  it('persists a session id received from the surface', () => {
    const { bridge } = createBridge()

    bridge.onSecondBrainSessionChanged('session-3')

    expect(bridge.secondBrainRequestedSessionId.value).toBe('session-3')
    expect(window.localStorage.getItem('sb:/vault')).toBe('session-3')
  })
})
