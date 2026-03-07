import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SidebarSurface from './SidebarSurface.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(SidebarSurface, {
          sidebarVisible: true,
          sidebarMode: 'search',
          workingFolderPath: '/vault',
          hasWorkspace: true,
          leftPaneWidth: 280,
          activeFilePath: '/vault/a.md',
          searchQuery: 'hello',
          globalSearchMode: 'hybrid',
          searchModeOptions: [{ mode: 'hybrid', label: 'Hybrid' }],
          showSearchScore: false,
          hasSearched: true,
          searchLoading: false,
          groupedSearchResults: [{ path: '/vault/a.md', items: [{ path: '/vault/a.md', snippet: 'hello', score: 0 }] }],
          toRelativePath: (path: string) => path.replace('/vault/', ''),
          formatSearchScore: (value: number) => String(value),
          parseSearchSnippet: (snippet: string) => [{ text: snippet, highlighted: false }],
          onSetSidebarMode: (mode: string) => events.push(`mode:${mode}`),
          onRunGlobalSearch: () => events.push('search'),
          onOpenSearchResult: (hit: { path: string }) => events.push(`open:${hit.path}`),
          onExplorerOpen: () => {},
          onExplorerPathRenamed: () => {},
          onExplorerRequestCreate: () => {},
          onExplorerSelection: () => {},
          onExplorerError: () => {},
          onSelectWorkingFolder: () => {},
          'onUpdateSearchQuery': () => {},
          onSelectGlobalSearchMode: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('SidebarSurface', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits sidebar and search interactions', () => {
    const mounted = mountHarness()

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Explorer"]')?.click()
    mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    mounted.root.querySelector<HTMLButtonElement>('.result-item')?.click()

    expect(mounted.events).toEqual(['mode:explorer', 'search', 'open:/vault/a.md'])

    mounted.app.unmount()
  })
})
