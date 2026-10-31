import { ref } from 'vue'

/**
 * Module: useAppEditorPreferences
 *
 * Owns the persisted, app-wide cursor preferences for note editing surfaces
 * (rich text editor and source mode). Editor components consume this state
 * but do not own it, so changes survive sessions.
 */

/** Cursor shapes shared by the rich text editor and source mode. */
export type EditorCursorStyle = 'block' | 'bar' | 'underline'

/** User-configurable editor display options exposed by Settings. */
export type EditorPreferences = {
  cursorStyle: EditorCursorStyle
  cursorBlink: boolean
}

export const EDITOR_PREFERENCES_STORAGE_KEY = 'tomosona.editor.preferences'

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  cursorStyle: 'block',
  cursorBlink: true
}

function normalizePreferences(value: unknown): EditorPreferences {
  const raw = value && typeof value === 'object' ? value as Partial<EditorPreferences> : {}
  return {
    cursorStyle: raw.cursorStyle === 'bar' || raw.cursorStyle === 'underline' ? raw.cursorStyle : DEFAULT_EDITOR_PREFERENCES.cursorStyle,
    cursorBlink: typeof raw.cursorBlink === 'boolean' ? raw.cursorBlink : DEFAULT_EDITOR_PREFERENCES.cursorBlink
  }
}

/** Loads, validates, persists, and updates global editor cursor preferences. */
export function useAppEditorPreferences(storageKey = EDITOR_PREFERENCES_STORAGE_KEY) {
  const editorPreferences = ref<EditorPreferences>({ ...DEFAULT_EDITOR_PREFERENCES })

  function loadEditorPreferences() {
    if (typeof window === 'undefined') return
    try {
      editorPreferences.value = normalizePreferences(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
    } catch {
      editorPreferences.value = { ...DEFAULT_EDITOR_PREFERENCES }
    }
  }

  function setEditorPreferences(next: Partial<EditorPreferences>) {
    editorPreferences.value = normalizePreferences({ ...editorPreferences.value, ...next })
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, JSON.stringify(editorPreferences.value))
  }

  function resetEditorPreferences() {
    setEditorPreferences(DEFAULT_EDITOR_PREFERENCES)
  }

  return { editorPreferences, loadEditorPreferences, setEditorPreferences, resetEditorPreferences }
}
