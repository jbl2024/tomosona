import { ref } from 'vue'

/** Global editor-minimap visibility, shared by every pane and persisted across launches. */
export const EDITOR_MINIMAP_VISIBLE_STORAGE_KEY = 'tomosona.editor.minimap.visible'

/** Owns the app-wide minimap preference; absence defaults to hidden. */
export function useAppEditorMinimapPreference(storageKey = EDITOR_MINIMAP_VISIBLE_STORAGE_KEY) {
  const editorMinimapVisible = ref(false)

  function loadEditorMinimapPreference() {
    if (typeof window === 'undefined') return
    editorMinimapVisible.value = window.localStorage.getItem(storageKey) === '1'
  }

  function setEditorMinimapVisible(next: boolean) {
    editorMinimapVisible.value = Boolean(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, editorMinimapVisible.value ? '1' : '0')
    }
  }

  function toggleEditorMinimapVisible() {
    setEditorMinimapVisible(!editorMinimapVisible.value)
    return editorMinimapVisible.value
  }

  return { editorMinimapVisible, loadEditorMinimapPreference, setEditorMinimapVisible, toggleEditorMinimapVisible }
}
