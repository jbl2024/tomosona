import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import UiFilterableDropdown, { type FilterableDropdownItem } from './UiFilterableDropdown.vue'

describe('UiFilterableDropdown', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountHarness(options?: { showFilter?: boolean; menuMode?: 'overlay' | 'inline' | 'portal' }) {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const open = ref(true)
    const query = ref('')
    const activeIndex = ref(0)
    const selected = ref<FilterableDropdownItem | null>(null)

    const items = ref<FilterableDropdownItem[]>([
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' }
    ])

    const Harness = defineComponent({
      setup() {
        return () =>
          h(
            UiFilterableDropdown,
            {
              items: items.value,
              modelValue: open.value,
              query: query.value,
              activeIndex: activeIndex.value,
              showFilter: options?.showFilter ?? true,
              menuMode: options?.menuMode ?? 'overlay',
              onOpenChange: (value: boolean) => {
                open.value = value
              },
              onQueryChange: (value: string) => {
                query.value = value
              },
              onActiveIndexChange: (value: number) => {
                activeIndex.value = value
              },
              onSelect: (item: FilterableDropdownItem) => {
                selected.value = item
              }
            },
            {
              trigger: ({ toggleMenu }: { toggleMenu: () => void }) =>
                h(
                  'button',
                  {
                    type: 'button',
                    'data-testid': 'trigger',
                    onClick: toggleMenu
                  },
                  'Trigger'
                )
            }
          )
      }
    })

    const app = createApp(Harness)
    app.mount(root)

    return { app, root, open, query, activeIndex, selected, items }
  }

  it('renders list items and empty state when no matches', async () => {
    const ctx = mountHarness()
    await nextTick()

    expect(ctx.root.querySelectorAll('.ui-filterable-dropdown-option')).toHaveLength(2)

    const input = ctx.root.querySelector('input') as HTMLInputElement
    input.value = 'zzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    expect(ctx.root.textContent).toContain('No matches')
    ctx.app.unmount()
  })

  it('emits select via click and Enter', async () => {
    const ctx = mountHarness()
    await nextTick()

    const options = Array.from(ctx.root.querySelectorAll('.ui-filterable-dropdown-option')) as HTMLButtonElement[]
    options[1].click()
    await nextTick()
    expect(ctx.selected.value?.id).toBe('beta')

    ctx.open.value = true
    ctx.activeIndex.value = 0
    await nextTick()
    const input = ctx.root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(ctx.selected.value?.id).toBe('alpha')

    ctx.app.unmount()
  })

  it('updates active index with arrow keys', async () => {
    const ctx = mountHarness()
    await nextTick()

    const input = ctx.root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(ctx.activeIndex.value).toBe(1)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(ctx.activeIndex.value).toBe(0)

    ctx.app.unmount()
  })

  it('sets combobox/listbox accessibility attributes', async () => {
    const ctx = mountHarness()
    await nextTick()

    const input = ctx.root.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-expanded')).toBe('true')

    const listbox = ctx.root.querySelector('[role=\"listbox\"]')
    expect(listbox).toBeTruthy()

    ctx.app.unmount()
  })

  it('supports inline menu rendering for clipped containers', async () => {
    const ctx = mountHarness({ menuMode: 'inline' })
    await nextTick()

    const menu = ctx.root.querySelector('.ui-filterable-dropdown-menu')
    expect(menu?.classList.contains('ui-filterable-dropdown-menu--inline')).toBe(true)
    expect(menu?.classList.contains('ui-filterable-dropdown-menu--overlay')).toBe(false)

    ctx.app.unmount()
  })

  it('supports portal menu rendering for floating overlays', async () => {
    const ctx = mountHarness({ menuMode: 'portal' })
    await nextTick()

    const menu = document.body.querySelector('.ui-filterable-dropdown-menu')
    expect(menu?.classList.contains('ui-filterable-dropdown-menu--portal')).toBe(true)

    ctx.app.unmount()
  })

  it('repositions portal menu to stay within viewport bounds', async () => {
    const ctx = mountHarness({ menuMode: 'portal' })
    await nextTick()

    const dropdownRoot = ctx.root.querySelector('.ui-filterable-dropdown') as HTMLElement
    const menu = document.body.querySelector('.ui-filterable-dropdown-menu') as HTMLElement
    expect(dropdownRoot).toBeTruthy()
    expect(menu).toBeTruthy()

    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })
    dropdownRoot.getBoundingClientRect = () => ({
      x: 260,
      y: 250,
      top: 250,
      left: 260,
      right: 340,
      bottom: 278,
      width: 80,
      height: 28,
      toJSON: () => ({})
    } as DOMRect)
    Object.defineProperty(menu, 'offsetWidth', { value: 260, configurable: true })
    Object.defineProperty(menu, 'offsetHeight', { value: 180, configurable: true })

    window.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(menu.style.left).toBe('48px')
    expect(menu.style.top).toBe('64px')

    ctx.app.unmount()
  })

  it('renders group labels when items declare groups', async () => {
    const ctx = mountHarness()
    ctx.items.value = [
      { id: 'alpha', label: 'Alpha', group: 'Text' },
      { id: 'beta', label: 'Beta', group: 'Relations' }
    ]
    await nextTick()

    const groups = Array.from(ctx.root.querySelectorAll('.ui-filterable-dropdown-group')).map((node) => node.textContent?.trim())
    expect(groups).toEqual(['Text', 'Relations'])

    ctx.app.unmount()
  })
})
