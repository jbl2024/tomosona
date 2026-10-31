import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PagePasswordDialog from './PagePasswordDialog.vue'

describe('page password dialog', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('submits a masked password and presents verification errors', async () => {
    const submit = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(() => h(PagePasswordDialog, {
      visible: true, title: 'Unlock page', error: 'Incorrect password or damaged file.', pending: false,
      onSubmit: submit
    }))
    app.mount(root)
    const input = root.querySelector<HTMLInputElement>('#page-password')!
    expect(input.type).toBe('password')
    input.value = 'example'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(submit).toHaveBeenCalledWith('example')
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Incorrect password or damaged file.')
    app.unmount()
  })

  it('requires a matching confirmation before submitting a new password', async () => {
    const submit = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(() => h(PagePasswordDialog, {
      visible: true, title: 'Choose a password', error: '', pending: false, confirm: true,
      onSubmit: submit
    }))
    app.mount(root)
    const [primary, confirmation] = Array.from(root.querySelectorAll<HTMLInputElement>('.password-input'))
    expect(primary!.type).toBe('password')
    expect(confirmation!.type).toBe('password')
    primary!.value = 'one'
    primary!.dispatchEvent(new Event('input', { bubbles: true }))
    confirmation!.value = 'two'
    confirmation!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(submit).not.toHaveBeenCalled()
    await nextTick()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Passwords do not match.')
    confirmation!.value = 'one'
    confirmation!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(submit).toHaveBeenCalledWith('one')
    app.unmount()
  })

  it('focuses the password input when the dialog becomes visible', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const visible = ref(false)
    const app = createApp(() => h(PagePasswordDialog, {
      visible: visible.value, title: 'Unlock page', error: '', pending: false,
      onSubmit: () => {}
    }))
    app.mount(root)
    expect(root.querySelector('#page-password')).toBeNull()
    visible.value = true
    await nextTick()
    expect(document.activeElement).toBe(root.querySelector('#page-password'))
    app.unmount()
  })

  it('focuses the password input on mount when already visible', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(() => h(PagePasswordDialog, {
      visible: true, title: 'Unlock page', error: '', pending: false,
      onSubmit: () => {}
    }))
    app.mount(root)
    expect(document.activeElement).toBe(root.querySelector('#page-password'))
    app.unmount()
  })
})
