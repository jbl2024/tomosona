import { Node, mergeAttributes } from '@tiptap/core'
import { TIPTAP_NODE_TYPES } from '../types'
import { createWikilinkStatePlugin, type WikilinkCandidate } from '../plugins/wikilinkState'

export type WikilinkExtensionOptions = {
  getCandidates: (query: string) => Promise<WikilinkCandidate[]>
  onNavigate: (target: string) => void | Promise<void>
  onCreate: (target: string) => void | Promise<void>
  resolve: (target: string) => Promise<boolean>
}

export const WikilinkNode = Node.create<WikilinkExtensionOptions>({
  name: TIPTAP_NODE_TYPES.wikilink,
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  group: 'inline',

  addOptions() {
    return {
      getCandidates: async () => [],
      onNavigate: async () => {},
      onCreate: async () => {},
      resolve: async () => true
    }
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element) =>
          (element as HTMLElement).getAttribute('data-target') ??
          (element as HTMLElement).getAttribute('data-wikilink-target') ??
          ''
      },
      label: {
        default: null,
        parseHTML: (element) => {
          const explicit = (element as HTMLElement).getAttribute('data-label')
          if (explicit !== null) return explicit
          return ((element as HTMLElement).textContent ?? '').trim() || null
        }
      },
      exists: {
        default: true,
        parseHTML: (element) => {
          const raw = (element as HTMLElement).getAttribute('data-exists')
          if (!raw) return true
          return raw !== 'false'
        }
      }
    }
  },

  parseHTML() {
    return [
      { tag: 'a[data-wikilink="true"]' },
      { tag: 'a[data-wikilink-target]' }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = String(node.attrs.target ?? '').trim()
    const label = String(node.attrs.label ?? '').trim() || null
    const exists = Boolean(node.attrs.exists)
    const display = label || target

    return ['a', mergeAttributes(HTMLAttributes, {
      'data-wikilink': 'true',
      'data-target': target,
      'data-wikilink-target': target,
      'data-label': label ?? '',
      'data-exists': exists ? 'true' : 'false',
      href: '#',
      class: `wikilink${exists ? '' : ' is-missing'}`,
      contenteditable: 'false'
    }), display]
  },

  addProseMirrorPlugins() {
    if (!this.editor) return []
    return [createWikilinkStatePlugin(this.editor, this.options)]
  }
})
