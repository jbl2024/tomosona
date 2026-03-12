import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import QuickOpenModal from './QuickOpenModal.vue'

function mountHarness(options?: { query?: string; isActionMode?: boolean; hasTextQuery?: boolean }) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const query = ref(options?.query ?? '')
  const actionSelections: string[] = []
  const resultSelections: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(QuickOpenModal, {
          visible: true,
          query: query.value,
          isActionMode: options?.isActionMode ?? true,
          hasTextQuery: options?.hasTextQuery ?? false,
          actionResults: [{ id: 'open-settings', label: 'Open Settings', run: () => true }],
          recentResults: [
            { kind: 'recent', path: '/vault/notes/alpha.md', label: 'notes/alpha.md', recencyLabel: '2m ago' }
          ],
          browseActionResults: [{ kind: 'action', id: 'open-home-view', label: 'Open Home' }],
          fileResults: [{ kind: 'file', path: '/vault/notes/beta.md', label: 'notes/beta.md' }],
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
    const mounted = mountHarness({ isActionMode: true })
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

  it('renders browse sections and emits recent/file selections', async () => {
    const mounted = mountHarness({ isActionMode: false, hasTextQuery: false })

    const sectionTitles = Array.from(mounted.root.querySelectorAll('.modal-section-title')).map((node) => node.textContent?.trim())
    expect(sectionTitles).toEqual(['Recent notes', 'Quick actions'])

    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.modal-item')
    buttons[0]?.click()
    buttons[1]?.click()
    await nextTick()

    expect(mounted.resultSelections).toEqual(['/vault/notes/alpha.md'])
    expect(mounted.actionSelections).toEqual(['open-home-view'])

    mounted.app.unmount()
  })

  it('renders file results for non-empty search queries', () => {
    const mounted = mountHarness({ isActionMode: false, hasTextQuery: true, query: 'beta' })

    expect(mounted.root.querySelector('.modal-section-title')).toBeNull()
    expect(mounted.root.textContent).toContain('notes/beta.md')

    mounted.app.unmount()
  })
})
