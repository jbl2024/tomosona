import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import MermaidNodeView from '../../../components/editor/tiptap/MermaidNodeView.vue'
import { TIPTAP_NODE_TYPES } from '../types'

export const MermaidNode = Node.create({
  name: TIPTAP_NODE_TYPES.mermaid,
  group: 'block',
  atom: true,

  addOptions() {
    return {
      confirmReplace: undefined as ((payload: { templateLabel: string }) => Promise<boolean>) | undefined
    }
  },

  addAttributes() {
    return {
      code: {
        default: ''
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid-node="true"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-mermaid-node': 'true',
      'data-code': node.attrs.code
    })]
  },

  addNodeView() {
    return VueNodeViewRenderer(MermaidNodeView as never)
  }
})
