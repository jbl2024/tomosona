import { ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'

export type PaneId = string

export type PmSelectionSnapshot = {
  kind: 'pm-selection'
  from: number
  to: number
}

export type DocumentSession = {
  path: string
  editor: Editor
  loadedText: string
  isLoaded: boolean
  dirty: boolean
  saving: boolean
  saveError: string
  scrollTop: number
  caret: PmSelectionSnapshot | null
  autosaveTimer: ReturnType<typeof setTimeout> | null
  outlineTimer: ReturnType<typeof setTimeout> | null
}

type UseDocumentEditorSessionsOptions = {
  createEditor: (path: string) => Editor
}

function clearSessionTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer)
  return null
}

export function useDocumentEditorSessions(options: UseDocumentEditorSessionsOptions) {
  const sessionsByPath = ref<Record<string, DocumentSession>>({})
  const activePathByPane = ref<Record<PaneId, string>>({ main: '' })

  function getSession(path: string): DocumentSession | null {
    if (!path) return null
    return sessionsByPath.value[path] ?? null
  }

  function ensureSession(path: string): DocumentSession {
    const trimmed = path.trim()
    if (!trimmed) {
      throw new Error('Path is required to create a document session.')
    }

    const existing = sessionsByPath.value[trimmed]
    if (existing) return existing

    const created: DocumentSession = {
      path: trimmed,
      editor: options.createEditor(trimmed),
      loadedText: '',
      isLoaded: false,
      dirty: false,
      saving: false,
      saveError: '',
      scrollTop: 0,
      caret: null,
      autosaveTimer: null,
      outlineTimer: null
    }

    sessionsByPath.value = {
      ...sessionsByPath.value,
      [trimmed]: created
    }

    return created
  }

  function setActivePath(paneId: PaneId, path: string) {
    activePathByPane.value = {
      ...activePathByPane.value,
      [paneId]: path.trim()
    }
  }

  function getActivePath(paneId: PaneId): string {
    return activePathByPane.value[paneId] ?? ''
  }

  function getActiveSession(paneId: PaneId): DocumentSession | null {
    const activePath = getActivePath(paneId)
    return getSession(activePath)
  }

  function renamePath(from: string, to: string): DocumentSession | null {
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

    const updatedActive: Record<PaneId, string> = {}
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
    session.editor.destroy()

    const next = { ...sessionsByPath.value }
    delete next[trimmed]
    sessionsByPath.value = next

    const nextActive = { ...activePathByPane.value }
    for (const [paneId, path] of Object.entries(nextActive)) {
      if (path === trimmed) {
        nextActive[paneId] = ''
      }
    }
    activePathByPane.value = nextActive
  }

  function closeAll() {
    const paths = Object.keys(sessionsByPath.value)
    for (const path of paths) {
      closePath(path)
    }
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
    closeAll,
    listPaths
  }
}
