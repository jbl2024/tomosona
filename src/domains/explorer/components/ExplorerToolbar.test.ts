import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExplorerToolbar from './ExplorerToolbar.vue'

describe('ExplorerToolbar', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('renders options in the shared menu surface and closes after an action', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onExpandAll = vi.fn()
    const app = createApp(() => h(ExplorerToolbar, { disabled: false, onExpandAll }))
    app.mount(root)
    const details = root.querySelector('details') as HTMLDetailsElement
    const summary = details.querySelector('summary') as HTMLElement
    summary.click()
    await nextTick()
    const menu = details.querySelector('[role="menu"].ui-menu')
    const list = menu?.querySelector('.ui-menu-list')
    expect(details.open).toBe(true)
    expect(list?.querySelectorAll('button')).toHaveLength(8)
    ;(list?.querySelector('button') as HTMLButtonElement).click()
    expect(onExpandAll).toHaveBeenCalledOnce()
    expect(details.open).toBe(false)
    app.unmount()
  })

  it('closes on Escape and returns focus to its trigger', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(() => h(ExplorerToolbar, { disabled: false }))
    app.mount(root)
    const details = root.querySelector('details') as HTMLDetailsElement
    const summary = details.querySelector('summary') as HTMLElement
    details.open = true
    const item = details.querySelector('button') as HTMLButtonElement
    item.focus()
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(summary)
    app.unmount()
  })

  it('disables undo when nothing is recoverable and emits undo when available', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onUndo = vi.fn()
    const app = createApp(() => h(ExplorerToolbar, { disabled: false, canUndo: false, onUndo }))
    app.mount(root)
    const details = root.querySelector('details') as HTMLDetailsElement
    details.open = true
    await nextTick()
    const buttons = Array.from(details.querySelectorAll('button'))
    const undoButton = buttons.find((button) => button.textContent?.includes('Undo last operation')) as HTMLButtonElement
    expect(undoButton.disabled).toBe(true)
    app.unmount()

    const root2 = document.createElement('div')
    document.body.appendChild(root2)
    const app2 = createApp(() => h(ExplorerToolbar, { disabled: false, canUndo: true, onUndo }))
    app2.mount(root2)
    const details2 = root2.querySelector('details') as HTMLDetailsElement
    details2.open = true
    await nextTick()
    const undoButton2 = Array.from(details2.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Undo last operation')) as HTMLButtonElement
    expect(undoButton2.disabled).toBe(false)
    undoButton2.click()
    expect(onUndo).toHaveBeenCalledOnce()
    app2.unmount()
  })

  it('disables tree-only actions in the journal view but keeps undo and the view toggle', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(() => h(ExplorerToolbar, { disabled: false, canUndo: true, journalView: true }))
    app.mount(root)

    for (const label of ['New note', 'New folder', 'Toggle filter']) {
      expect((root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).disabled).toBe(true)
    }
    expect((root.querySelector('button[aria-label="Journal view"]') as HTMLButtonElement).disabled).toBe(false)

    const details = root.querySelector('details') as HTMLDetailsElement
    details.open = true
    await nextTick()
    const menuButton = (label: string) => Array.from(details.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(label)) as HTMLButtonElement

    for (const label of ['Expand all folders', 'Collapse all folders', 'Reveal active note', 'Sort A to Z', 'Sort Z to A', 'Show extensions', 'Refresh explorer']) {
      expect(menuButton(label).disabled).toBe(true)
    }
    expect(menuButton('Undo last operation').disabled).toBe(false)
    app.unmount()
  })

  it('keeps tree-only actions enabled in the tree view', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(() => h(ExplorerToolbar, { disabled: false, canUndo: true, journalView: false }))
    app.mount(root)

    for (const label of ['New note', 'New folder', 'Toggle filter']) {
      expect((root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).disabled).toBe(false)
    }
    app.unmount()
  })

  it('exposes the journal view as a pressed toggle', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onToggleJournalView = vi.fn()
    const app = createApp(() => h(ExplorerToolbar, { disabled: false, journalView: true, onToggleJournalView }))
    app.mount(root)

    const button = root.querySelector('button[aria-label="Journal view"]') as HTMLButtonElement
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.click()
    expect(onToggleJournalView).toHaveBeenCalledOnce()
    app.unmount()
  })
})
