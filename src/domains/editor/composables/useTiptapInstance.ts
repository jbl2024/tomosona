import { Editor, type EditorOptions } from '@tiptap/vue-3'
import type { Ref } from 'vue'

export type UseTiptapInstanceOptions = {
  holder: Ref<HTMLElement | null>
  getEditor: () => Editor | null
  setEditor: (editor: Editor | null) => void
  createOptions: (holder: HTMLElement, onEditorChange: () => void) => Partial<EditorOptions>
  onEditorChange: () => void
  beforeDestroy?: () => void
}

export function useTiptapInstance(options: UseTiptapInstanceOptions) {
  async function ensureEditor() {
    if (!options.holder.value || options.getEditor()) return
    const editor = new Editor({
      content: '',
      element: document.createElement('div'),
      ...options.createOptions(options.holder.value, options.onEditorChange)
    })
    options.setEditor(editor)
  }

  async function destroyEditor() {
    options.beforeDestroy?.()
    const editor = options.getEditor()
    if (!editor) return
    editor.destroy()
    options.setEditor(null)
  }

  return {
    ensureEditor,
    destroyEditor
  }
}
