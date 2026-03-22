import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SearchSidebarPanel from './SearchSidebarPanel.vue'

const readPropertyKeys = vi.fn(async () => ['category', 'created', 'semantic', 'hybrid', 'status', 'tags'])
const readPropertyValueSuggestions = vi.fn(async (key: string) => {
  if (key === 'created') return ['2026-03-06', '2026-03-07']
  if (key === 'status') return ['draft', 'published']
  if (key === 'category') return ['design', 'research']
  if (key === 'tags') return ['roadmap', 'ux']
  return []
})

vi.mock('../../../shared/api/indexApi', () => ({
  readPropertyKeys: () => readPropertyKeys(),
  readPropertyValueSuggestions: (key: string) => readPropertyValueSuggestions(key)
}))

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

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
          workingFolderPath: '/vault',
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
    readPropertyKeys.mockClear()
    readPropertyValueSuggestions.mockClear()
  })

  it('renders property suggestions, quick filters, and searchable values', async () => {
    const mounted = mountHarness()
    const input = mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')
    input?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    await nextTick()
    await flushPromises()
    await nextTick()

    const optionTexts = Array.from(document.querySelectorAll<HTMLButtonElement>('.ui-filterable-dropdown-option'))
      .map((button) => button.textContent ?? '')
    expect(optionTexts.some((text) => text.includes('Tags'))).toBe(true)
    expect(optionTexts.some((text) => text.includes('category'))).toBe(true)
    expect(optionTexts.some((text) => text.includes('status'))).toBe(true)
    expect(optionTexts.some((text) => text.includes('created'))).toBe(true)
    expect(optionTexts.some((text) => text.includes('semantic'))).toBe(false)
    expect(optionTexts.some((text) => text.includes('hybrid'))).toBe(false)
    expect(document.body.textContent).toContain('Quick filters')

    const categorySuggestion = Array.from(document.querySelectorAll<HTMLButtonElement>('.ui-filterable-dropdown-option'))
      .find((button) => button.textContent?.includes('category'))
    categorySuggestion?.click()
    await nextTick()

    expect(mounted.query.value).toBe('category:')

    const reopenedInput = mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')
    if (reopenedInput) {
      reopenedInput.value = 'category:'
      reopenedInput.dispatchEvent(new Event('input', { bubbles: true }))
      reopenedInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    }
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(document.body.textContent).toContain('design')

    const draftSuggestion = Array.from(document.querySelectorAll<HTMLButtonElement>('.ui-filterable-dropdown-option'))
      .find((button) => button.textContent?.includes('design'))
    draftSuggestion?.click()
    await nextTick()

    expect(mounted.query.value).toBe('category:design')

    mounted.query.value = 'status:'
    await nextTick()
    mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')?.dispatchEvent(
      new Event('input', { bubbles: true })
    )
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(document.body.textContent).toContain('draft')

    mounted.query.value = 'created:'
    await nextTick()
    mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')?.dispatchEvent(
      new Event('input', { bubbles: true })
    )
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(document.body.textContent).toContain('2026-03-06')

    mounted.query.value = 'multi'
    await nextTick()
    const plainTextInput = mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')
    if (plainTextInput) {
      plainTextInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(document.querySelectorAll('.ui-filterable-dropdown-option').length).toBe(0)

    mounted.query.value = 'semantic:'
    await nextTick()
    mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')?.dispatchEvent(
      new Event('input', { bubbles: true })
    )
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(document.querySelectorAll('.ui-filterable-dropdown-option').length).toBe(0)

    mounted.query.value = 'hybrid:'
    await nextTick()
    mounted.root.querySelector<HTMLInputElement>('[data-search-input="true"]')?.dispatchEvent(
      new Event('input', { bubbles: true })
    )
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(document.querySelectorAll('.ui-filterable-dropdown-option').length).toBe(0)

    mounted.query.value = ''
    await nextTick()
    mounted.root.querySelector<HTMLButtonElement>('.search-quick-filter')?.click()
    await nextTick()

    expect(mounted.query.value).toBe('tags:')

    mounted.app.unmount()
  })
})
