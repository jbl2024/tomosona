import { createApp, defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExplorerItem from './ExplorerItem.vue'
import type { TreeNode } from '../../../shared/api/apiTypes'

vi.mock('@vue-dnd-kit/core', () => ({
  makeDraggable: vi.fn(),
  makeDroppable: vi.fn()
}))

function fileNode(path: string): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    is_markdown: true,
    has_children: false
  }
}

describe('ExplorerItem', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('marks a protected page', () => {
    const root = document.createElement('div')
    const app = createApp(() => h(ExplorerItem, {
      node: { ...fileNode('/vault/a.md'), isProtected: true }, depth: 0,
      expanded: false, selected: false, active: false, focused: false,
      cutPending: false, editing: false, renameValue: ''
    }))
    app.mount(root)
    expect(root.querySelector('[aria-label="Password protected"]')).not.toBeNull()
    app.unmount()
  })

  it('stops non-primary pointerdown events so right click cannot start drag', async () => {
    const pointerDowns = ref(0)
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(
            'div',
            {
              onPointerdown: () => {
                pointerDowns.value += 1
              }
            },
            [
              h(ExplorerItem, {
                node: fileNode('/vault/a.md'),
                depth: 0,
                expanded: false,
                selected: false,
                active: false,
                focused: false,
                cutPending: false,
                editing: false,
                renameValue: ''
              })
            ]
          )
      }
    }))

    app.mount(root)

    const row = root.querySelector('[data-explorer-path="/vault/a.md"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 2 }))

    expect(pointerDowns.value).toBe(0)

    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))

    expect(pointerDowns.value).toBe(1)

    app.unmount()
  })
})
