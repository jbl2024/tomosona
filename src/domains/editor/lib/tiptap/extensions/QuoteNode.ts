import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import QuoteNodeView from '../../../components/editor/tiptap/QuoteNodeView.vue'
import { TIPTAP_NODE_TYPES } from '../types'

export const QuoteNode = Node.create({
  name: TIPTAP_NODE_TYPES.quote,
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      text: {
        default: ''
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-quote-node="true"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-quote-node': 'true',
      'data-text': node.attrs.text
    })]
  },

  addNodeView() {
    return VueNodeViewRenderer(QuoteNodeView as never)
  }
})
