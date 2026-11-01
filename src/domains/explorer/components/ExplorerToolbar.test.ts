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
    expect(list?.querySelectorAll('button')).toHaveLength(7)
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
})
