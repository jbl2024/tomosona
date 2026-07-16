import { ref } from 'vue'

/** Global editor-ruler visibility shared by every pane. */
export const EDITOR_RULER_VISIBLE_STORAGE_KEY = 'tomosona.editor.ruler.visible'
export const LEGACY_EDITOR_MINIMAP_VISIBLE_STORAGE_KEY = 'tomosona.editor.minimap.visible'

/** Owns the ruler preference and migrates the former minimap choice once. */
export function useAppEditorRulerPreference(storageKey = EDITOR_RULER_VISIBLE_STORAGE_KEY) {
  const editorRulerVisible = ref(true)

  function loadEditorRulerPreference() {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(storageKey)
    if (stored !== null) {
      editorRulerVisible.value = stored === '1'
      return
    }

    const legacy = window.localStorage.getItem(LEGACY_EDITOR_MINIMAP_VISIBLE_STORAGE_KEY)
    editorRulerVisible.value = legacy === null ? true : legacy === '1'
    window.localStorage.setItem(storageKey, editorRulerVisible.value ? '1' : '0')
  }

  function setEditorRulerVisible(next: boolean) {
    editorRulerVisible.value = Boolean(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, editorRulerVisible.value ? '1' : '0')
    }
  }

  function toggleEditorRulerVisible() {
    setEditorRulerVisible(!editorRulerVisible.value)
    return editorRulerVisible.value
  }

  return { editorRulerVisible, loadEditorRulerPreference, setEditorRulerVisible, toggleEditorRulerVisible }
}
