import { createApp, h, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LockedPageSurface from './LockedPageSurface.vue'

afterEach(() => { document.body.innerHTML = '' })

describe('LockedPageSurface', () => {
  it('shows the note name, focuses the active pane, and supports reveal and Enter', async () => {
    const root = document.createElement('div'); document.body.appendChild(root)
    const submit = vi.fn()
    const app = createApp(() => h(LockedPageSurface, { path: '/vault/My Note.md', error: '', pending: false, active: true, onSubmit: submit }))
    app.mount(root); await nextTick(); await nextTick()
    const input = root.querySelector('input') as HTMLInputElement
    const button = root.querySelector('button[type=submit]') as HTMLButtonElement
    expect(root.textContent).toContain('“My Note” is protected')
    expect(document.activeElement).toBe(input)
    expect(button.disabled).toBe(true)
    input.value = 'secret'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    expect(button.disabled).toBe(false)
    const reveal = root.querySelector('button[aria-label="Show password"]') as HTMLButtonElement
    reveal.click(); await nextTick()
    expect(input.type).toBe('text')
    expect(root.querySelector('button[aria-label="Hide password"]')).toBeTruthy()
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(submit).toHaveBeenCalledWith('secret')
    app.unmount()
  })

  it('keeps errors near the field, selects the password for retry, and shows Caps Lock', async () => {
    const root = document.createElement('div'); document.body.appendChild(root)
    const props = reactive({ path: '/vault/a.md', error: '', pending: false, active: true })
    const app = createApp(() => h(LockedPageSurface, props))
    app.mount(root); await nextTick()
    const input = root.querySelector('input') as HTMLInputElement
    input.value = 'secret'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    const event = new KeyboardEvent('keyup', { key: 'A', bubbles: true })
    Object.defineProperty(event, 'getModifierState', { value: (key: string) => key === 'CapsLock' })
    input.dispatchEvent(event); await nextTick()
    expect(root.textContent).toContain('Caps Lock is on.')
    props.error = 'Incorrect password or damaged file.'
    await nextTick(); await nextTick()
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Incorrect password')
    expect(input.value).toBe('secret')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(6)
    app.unmount()
  })

  it('does not steal focus from another pane and prevents duplicate actions while pending', async () => {
    const root = document.createElement('div'); document.body.appendChild(root)
    const props = reactive({ path: '/vault/a.md', error: '', pending: false, active: false })
    const submit = vi.fn()
    const app = createApp(() => h(LockedPageSurface, { ...props, onSubmit: submit }))
    app.mount(root); await nextTick()
    const input = root.querySelector('input') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    props.active = true; await nextTick(); await nextTick()
    expect(document.activeElement).toBe(input)
    input.value = 'secret'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    props.pending = true; await nextTick()
    expect(root.textContent).toContain('Unlocking note…')
    expect(root.querySelector('button[type=submit]')?.getAttribute('aria-busy')).toBe('true')
    expect(root.querySelector('.ui-button__spinner')).toBeTruthy()
    expect(root.querySelector('.locked-page-progress')).toBeTruthy()
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(submit).not.toHaveBeenCalled()
    expect([...root.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Back')).toBe(false)
    app.unmount()
  })
})
