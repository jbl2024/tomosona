import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockNodeView from '../../../components/editor/tiptap/CodeBlockNodeView.vue'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

export const CodeBlockNode = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: 'plaintext',
  enableTabIndentation: true,
  tabSize: 2
}).extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockNodeView as never, {
      contentDOMElementTag: 'code'
    })
  }
})
