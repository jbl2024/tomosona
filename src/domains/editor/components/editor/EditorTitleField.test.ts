import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorTitleField from './EditorTitleField.vue'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('EditorTitleField', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits input and commit events', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const updates = vi.fn()
    const commits = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        const title = ref('Alpha')
        return () => h(EditorTitleField, {
          modelValue: title.value,
          'onUpdate:modelValue': (value: string) => {
            title.value = value
            updates(value)
          },
          onCommit: commits
        })
      }
    }))

    app.mount(root)
    await flushUi()

    const titleEl = root.querySelector('.editor-title-field') as HTMLElement
    titleEl.textContent = 'Beta'
    titleEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    titleEl.dispatchEvent(new FocusEvent('blur', { bubbles: true }))

    expect(updates).toHaveBeenCalledWith('Beta')
    expect(commits).toHaveBeenCalled()

    app.unmount()
  })

  it('requests body focus on ArrowDown', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const focusBody = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorTitleField, {
          modelValue: 'Alpha',
          onFocusBodyRequest: focusBody
        })
      }
    }))

    app.mount(root)
    await flushUi()

    const titleEl = root.querySelector('.editor-title-field') as HTMLElement
    titleEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(focusBody).toHaveBeenCalled()

    app.unmount()
  })

  it('does not overwrite the in-progress draft while focused', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        const title = ref('Alpha')
        return () => h(EditorTitleField, {
          modelValue: title.value,
          'onUpdate:modelValue': (value: string) => {
            title.value = value
          }
        })
      }
    }))

    app.mount(root)
    await flushUi()

    const titleEl = root.querySelector('.editor-title-field') as HTMLElement
    titleEl.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    titleEl.textContent = 'AlphaB'
    titleEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    expect(titleEl.textContent).toBe('AlphaB')

    app.unmount()
  })
})
