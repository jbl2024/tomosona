import { ref } from 'vue'
import type { FileVersion } from '../../../shared/api/apiTypes'

export type TextEditorConflict = {
  kind: 'modified' | 'deleted'
  diskVersion?: FileVersion
  diskContent?: string
  detectedAt: number
} | null

export type TextEditorSession = {
  path: string
  text: string
  loadedText: string
  lineEnding: 'lf' | 'crlf'
  baseVersion: FileVersion | null
  currentDiskVersion: FileVersion | null
  conflict: TextEditorConflict
  isLoaded: boolean
  dirty: boolean
  saving: boolean
  saveError: string
  scrollTop: number
  scrollLeft: number
  wordWrap: boolean
  autosaveTimer: ReturnType<typeof setTimeout> | null
  outlineTimer: ReturnType<typeof setTimeout> | null
}

type UseTextEditorSessionsOptions = {
  createSessionText?: (path: string) => string
}

function clearSessionTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer)
  return null
}

export function useTextEditorSessions(options: UseTextEditorSessionsOptions = {}) {
  const sessionsByPath = ref<Record<string, TextEditorSession>>({})
  const activePathByPane = ref<Record<string, string>>({ main: '' })

  function createSession(path: string): TextEditorSession {
    const trimmed = path.trim()
    return {
      path: trimmed,
      text: options.createSessionText?.(trimmed) ?? '',
      loadedText: '',
      lineEnding: 'lf',
      baseVersion: null,
      currentDiskVersion: null,
      conflict: null,
      isLoaded: false,
      dirty: false,
      saving: false,
      saveError: '',
      scrollTop: 0,
      scrollLeft: 0,
      wordWrap: true,
      autosaveTimer: null,
      outlineTimer: null
    }
  }

  function getSession(path: string): TextEditorSession | null {
    if (!path) return null
    return sessionsByPath.value[path] ?? null
  }

  function ensureSession(path: string): TextEditorSession {
    const trimmed = path.trim()
    if (!trimmed) {
      throw new Error('Path is required to create a text session.')
    }

    const existing = sessionsByPath.value[trimmed]
    if (existing) return existing

    const created = createSession(trimmed)
    sessionsByPath.value = {
      ...sessionsByPath.value,
      [trimmed]: created
    }
    return created
  }

  function setActivePath(paneId: string, path: string) {
    activePathByPane.value = {
      ...activePathByPane.value,
      [paneId]: path.trim()
    }
  }

  function getActivePath(paneId: string): string {
    return activePathByPane.value[paneId] ?? ''
  }

  function getActiveSession(paneId: string): TextEditorSession | null {
    const activePath = getActivePath(paneId)
    return getSession(activePath)
  }

  function renamePath(from: string, to: string): TextEditorSession | null {
    const fromPath = from.trim()
    const toPath = to.trim()
    if (!fromPath || !toPath || fromPath === toPath) {
      return getSession(toPath)
    }

    const session = sessionsByPath.value[fromPath]
    if (!session) return null

    const next = { ...sessionsByPath.value }
    delete next[fromPath]
    session.path = toPath
    next[toPath] = session
    sessionsByPath.value = next

    const updatedActive: Record<string, string> = {}
    for (const [paneId, path] of Object.entries(activePathByPane.value)) {
      updatedActive[paneId] = path === fromPath ? toPath : path
    }
    activePathByPane.value = updatedActive

    return session
  }

  function closePath(path: string) {
    const trimmed = path.trim()
    if (!trimmed) return

    const session = sessionsByPath.value[trimmed]
    if (!session) return

    session.autosaveTimer = clearSessionTimer(session.autosaveTimer)
    session.outlineTimer = clearSessionTimer(session.outlineTimer)

    const next = { ...sessionsByPath.value }
    delete next[trimmed]
    sessionsByPath.value = next

    const nextActive = { ...activePathByPane.value }
    for (const [paneId, activePath] of Object.entries(nextActive)) {
      if (activePath === trimmed) {
        nextActive[paneId] = ''
      }
    }
    activePathByPane.value = nextActive
  }

  function listPaths(): string[] {
    return Object.keys(sessionsByPath.value)
  }

  return {
    sessionsByPath,
    activePathByPane,
    getSession,
    ensureSession,
    setActivePath,
    getActivePath,
    getActiveSession,
    renamePath,
    closePath,
    listPaths
  }
}
