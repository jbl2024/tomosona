import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import QuickOpenModal from './QuickOpenModal.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const query = ref('')
  const actionSelections: string[] = []
  const resultSelections: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(QuickOpenModal, {
          visible: true,
          query: query.value,
          isActionMode: true,
          actionResults: [{ id: 'open-settings', label: 'Open Settings', run: () => true }],
          fileResults: [],
          activeIndex: 0,
          'onUpdate:query': (value: string) => { query.value = value },
          onSelectAction: (id: string) => actionSelections.push(id),
          onSelectResult: (item: { path: string }) => resultSelections.push(item.path),
          onKeydown: () => {},
          onClose: () => {},
          onSetActiveIndex: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, query, actionSelections, resultSelections }
}

describe('QuickOpenModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits query updates and action selections', async () => {
    const mounted = mountHarness()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    if (input) {
      input.value = '>open settings'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()

    mounted.root.querySelector<HTMLButtonElement>('.modal-item')?.click()

    expect(mounted.query.value).toBe('>open settings')
    expect(mounted.actionSelections).toEqual(['open-settings'])
    expect(mounted.resultSelections).toEqual([])

    mounted.app.unmount()
  })
})
