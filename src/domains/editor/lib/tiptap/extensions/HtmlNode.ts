import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import HtmlNodeView from '../../../components/editor/tiptap/HtmlNodeView.vue'
import { TIPTAP_NODE_TYPES } from '../types'

export const HtmlNode = Node.create({
  name: TIPTAP_NODE_TYPES.html,
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      html: {
        default: ''
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-html-node="true"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-html-node': 'true',
      'data-html': node.attrs.html
    })]
  },

  addNodeView() {
    return VueNodeViewRenderer(HtmlNodeView as never)
  }
})
