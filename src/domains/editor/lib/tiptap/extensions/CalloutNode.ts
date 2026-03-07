import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { normalizeCalloutKind } from '../../callouts'
import CalloutNodeView from '../../../components/editor/tiptap/CalloutNodeView.vue'
import { TIPTAP_NODE_TYPES } from '../types'

export const CalloutNode = Node.create({
  name: TIPTAP_NODE_TYPES.callout,
  group: 'block',
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: 'NOTE',
        parseHTML: (element) => normalizeCalloutKind(element.getAttribute('data-kind') ?? 'NOTE')
      },
      message: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-message') ?? ''
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout-node="true"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-callout-node': 'true',
      'data-kind': node.attrs.kind,
      'data-message': node.attrs.message
    })]
  },

  addNodeView() {
    return VueNodeViewRenderer(CalloutNodeView as never)
  }
})
