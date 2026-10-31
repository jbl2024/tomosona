import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FavoritesListPanel from './FavoritesListPanel.vue'

vi.mock('../../../shared/api/pageProtectionApi', () => ({
  pageProtectionStatus: async (paths: string[]) => paths.map((path) => ({ path, isProtected: path === 'Alpha.md', isLocked: true }))
}))

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []
  const items = ref([
    { path: 'Alpha.md', added_at_ms: 1, exists: true },
    { path: 'ghost.md', added_at_ms: 2, exists: false }
  ])

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(FavoritesListPanel, {
          items: items.value,
          activePath: 'Alpha.md',
          loading: false,
          toRelativePath: (path: string) => path,
          onOpen: (path: string) => events.push(`open:${path}`),
          onRemove: (path: string) => events.push(`remove:${path}`)
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('FavoritesListPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('marks protected favorites without showing their content', async () => {
    const mounted = mountHarness()
    await Promise.resolve()
    await nextTick()
    expect(mounted.root.querySelector('[aria-label="Password protected"]')).not.toBeNull()
    expect(mounted.root.textContent).not.toContain('secret content')
    mounted.app.unmount()
  })

  it('opens existing favorites and removes missing ones', () => {
    const mounted = mountHarness()

    const rows = mounted.root.querySelectorAll<HTMLButtonElement>('.favorites-row')
    rows[0]?.click()
    rows[1]?.click()
    mounted.root.querySelector<HTMLButtonElement>('.favorites-row-remove')?.click()

    expect(mounted.events).toEqual(['open:Alpha.md', 'remove:ghost.md'])

    mounted.app.unmount()
  })

  it('filters favorites with the input', async () => {
    const mounted = mountHarness()
    const input = mounted.root.querySelector<HTMLInputElement>('input[placeholder="Filter favorites"]')
    expect(input).toBeTruthy()
    if (!input) return

    input.value = 'ghost'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()

    const rows = mounted.root.querySelectorAll('.favorites-row')
    expect(rows).toHaveLength(1)
    expect(mounted.root.textContent).toContain('ghost.md')

    mounted.app.unmount()
  })
})
