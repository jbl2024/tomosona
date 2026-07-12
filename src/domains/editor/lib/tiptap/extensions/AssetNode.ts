import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import AssetNodeView from '../../../components/editor/tiptap/AssetNodeView.vue'
import { TIPTAP_NODE_TYPES } from '../types'
import type { AssetPreviewPayload } from '../../../composables/useAssetPreviewDialog'
import type { AssetBrowserDropdownItem } from '../assetBrowser'

export type AssetNodeExtensionOptions = {
  resolvePreviewSrc?: (src: string) => string | null
  openPreview?: (payload: AssetPreviewPayload) => void
  getAssetBrowserItems?: () => AssetBrowserDropdownItem[]
  importAssetFiles?: () => Promise<string[]>
}

export const AssetNode = Node.create<AssetNodeExtensionOptions>({
  name: TIPTAP_NODE_TYPES.asset,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      resolvePreviewSrc: (src: string) => src,
      getAssetBrowserItems: () => []
    }
  },

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (element) => (element as HTMLElement).getAttribute('data-src') ?? ''
      },
      alt: {
        default: '',
        parseHTML: (element) => (element as HTMLElement).getAttribute('data-alt') ?? ''
      },
      title: {
        default: '',
        parseHTML: (element) => (element as HTMLElement).getAttribute('data-title') ?? ''
      },
      autoEdit: {
        default: false,
        renderHTML: () => ({})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-asset-node="true"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = String(node.attrs.src ?? '')
    const alt = String(node.attrs.alt ?? '')
    const title = String(node.attrs.title ?? '')

    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-asset-node': 'true',
        'data-src': src,
        'data-alt': alt,
        'data-title': title,
        contenteditable: 'false'
      })
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(AssetNodeView as never)
  }
})
