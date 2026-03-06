import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SearchSidebarPanel from './SearchSidebarPanel.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const query = ref('')
  const selectedModes: string[] = []
  const openedResults: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(SearchSidebarPanel, {
          disabled: false,
          query: query.value,
          mode: 'hybrid',
          modeOptions: [{ mode: 'hybrid', label: 'Hybrid' }, { mode: 'semantic', label: 'Semantic' }],
          showSearchScore: true,
          hasSearched: true,
          searchLoading: false,
          groupedResults: [{ path: '/vault/a.md', items: [{ path: '/vault/a.md', snippet: 'hello', score: 0.9 }] }],
          toRelativePath: (path: string) => path.replace('/vault/', ''),
          formatSearchScore: (value: number) => value.toFixed(3),
          snippetParts: (snippet: string) => [{ text: snippet, highlighted: false }],
          'onUpdate:query': (value: string) => { query.value = value },
          onSelectMode: (mode: string) => selectedModes.push(mode),
          onOpenResult: (hit: { path: string }) => openedResults.push(hit.path),
          onEnter: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, query, selectedModes, openedResults }
}

describe('SearchSidebarPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits updates for query, mode changes, and result opens', async () => {
    const mounted = mountHarness()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')
    if (input) {
      input.value = 'graph'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()

    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.search-mode-chip')
    buttons[1]?.click()
    mounted.root.querySelector<HTMLButtonElement>('.result-item')?.click()

    expect(mounted.query.value).toBe('graph')
    expect(mounted.selectedModes).toEqual(['semantic'])
    expect(mounted.openedResults).toEqual(['/vault/a.md'])

    mounted.app.unmount()
  })
})
