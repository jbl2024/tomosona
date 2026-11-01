import { createApp, h, nextTick } from 'vue'
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

  it('explains a protected page', async () => {
    const root = document.createElement('div')
    const app = createApp(() => h(ExplorerItem, {
      node: { ...fileNode('/vault/a.md'), isProtected: true }, depth: 0,
      expanded: false, selected: false, active: false, focused: false,
      cutPending: false, editing: false, renameValue: ''
    }))
    app.mount(root)
    const lock = root.querySelector('[aria-label="Password protected"]') as HTMLButtonElement
    expect(lock).not.toBeNull()
    lock.click()
    await nextTick()
    expect(root.textContent).toContain('encrypted')
    app.unmount()
  })

  it('provides an accessible folder chevron and preserves the full path on a truncated label', () => {
    const root = document.createElement('div')
    const app = createApp(() => h(ExplorerItem, {
      node: { ...fileNode('/vault/a very long folder'), is_dir: true, is_markdown: false }, depth: 0,
      expanded: false, selected: true, active: true, focused: true,
      cutPending: false, editing: false, renameValue: ''
    }))
    app.mount(root)
    const chevron = root.querySelector('button[aria-label="Expand folder"]')
    expect(chevron?.getAttribute('aria-expanded')).toBe('false')
    const label = root.querySelector('.explorer-item-label')
    expect(label?.classList.contains('truncate')).toBe(true)
    expect(label?.getAttribute('title')).toBe('/vault/a very long folder')
    expect(root.querySelector('.explorer-item--active.explorer-item--selected.explorer-item--focused')).toBeTruthy()
    app.unmount()
  })

  it('stops non-primary pointerdown events so right click cannot start drag', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(() => h(ExplorerItem, {
      node: fileNode('/vault/a.md'),
      depth: 0,
      expanded: false,
      selected: false,
      active: false,
      focused: false,
      cutPending: false,
      editing: false,
      renameValue: ''
    }))
    app.mount(root)

    const row = root.querySelector('[data-explorer-path="/vault/a.md"]') as HTMLElement
    // A plain ancestor listener stands in for the DnD provider, which attaches
    // native listeners above the row. It must never see a non-primary press.
    //
    // The listener is deliberately not a Vue `onPointerdown` handler: Vue 3.5
    // skips an invoker when `event._vts <= invoker.attached`, so a handler
    // attached in the same millisecond as the dispatch is silently dropped and
    // the assertion would flake.
    const ancestorPointerDowns = vi.fn()
    root.addEventListener('pointerdown', ancestorPointerDowns)

    const right = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 2 })
    row.dispatchEvent(right)
    expect(right.defaultPrevented).toBe(true)
    expect(ancestorPointerDowns).not.toHaveBeenCalled()

    const left = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    row.dispatchEvent(left)
    expect(left.defaultPrevented).toBe(false)
    expect(ancestorPointerDowns).toHaveBeenCalledTimes(1)

    root.removeEventListener('pointerdown', ancestorPointerDowns)
    app.unmount()
  })
})
