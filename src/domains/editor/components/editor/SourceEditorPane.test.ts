import { createApp, defineComponent, h, nextTick, ref, type ComponentPublicInstance } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SourceEditorPane from './SourceEditorPane.vue'

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('SourceEditorPane', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders CodeMirror line numbers for raw text editing', async () => {
    const value = ref('first line\nsecond line')
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(SourceEditorPane, {
            modelValue: value.value,
            languageLabel: 'txt',
            'onUpdate:modelValue': (next: string) => {
              value.value = next
            }
          })
      }
    }))

    app.mount(root)
    await flushUi()

    expect(root.querySelector('.cm-gutters')).toBeTruthy()
    expect(root.querySelector('.cm-editor')).toBeTruthy()

    app.unmount()
  })

  it('opens CodeMirror search and reports the raw editor scroll position', async () => {
    const value = ref('first line\nsecond line')
    const positions: Array<{ top: number; left: number }> = []
    const sourcePane = ref<ComponentPublicInstance<{ openSearch: () => void }> | null>(null)
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(SourceEditorPane, {
          ref: sourcePane,
          modelValue: value.value,
          languageLabel: 'json',
          onScroll: (position: { top: number; left: number }) => positions.push(position)
        })
      }
    }))

    app.mount(root)
    await flushUi()

    sourcePane.value?.openSearch()
    await flushUi()
    expect(root.querySelector('.cm-search')).toBeTruthy()

    const scroller = root.querySelector('.cm-scroller') as HTMLElement
    scroller.scrollTop = 72
    scroller.scrollLeft = 18
    scroller.dispatchEvent(new Event('scroll'))
    await flushUi()
    expect(positions).toContainEqual({ top: 72, left: 18 })

    app.unmount()
  })

  it('emits a wrap toggle request', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const toggles = ref(0)
    const app = createApp(defineComponent({
      setup() {
        return () => h(SourceEditorPane, {
          modelValue: 'a long line',
          languageLabel: 'txt',
          wordWrap: false,
          onToggleWordWrap: () => { toggles.value += 1 }
        })
      }
    }))

    app.mount(root)
    await flushUi()
    ;(root.querySelector('.tomosona-source-editor-wrap-toggle') as HTMLButtonElement).click()
    expect(toggles.value).toBe(1)
    app.unmount()
  })

  it('opens search in the raw editor that received the shortcut event', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(defineComponent({
      setup() {
        return () => h('div', [
          h(SourceEditorPane, { modelValue: 'first editor', languageLabel: 'txt' }),
          h(SourceEditorPane, { modelValue: 'second editor', languageLabel: 'txt' })
        ])
      }
    }))

    app.mount(root)
    await flushUi()
    const editors = [...root.querySelectorAll('.cm-content')] as HTMLElement[]

    editors[0].dispatchEvent(new CustomEvent('tomosona:source-find', { bubbles: true }))
    await flushUi()
    expect(root.querySelectorAll('.cm-search')).toHaveLength(1)
    expect(root.querySelectorAll('.tomosona-source-editor')[0].querySelector('.cm-search')).toBeTruthy()
    expect(root.querySelectorAll('.tomosona-source-editor')[1].querySelector('.cm-search')).toBeNull()

    editors[1].dispatchEvent(new CustomEvent('tomosona:source-find', { bubbles: true }))
    await flushUi()
    expect(root.querySelectorAll('.cm-search')).toHaveLength(2)
    app.unmount()
  })
})
