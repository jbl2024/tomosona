import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useFilterableListbox, type FilterableItemBase } from './useFilterableListbox'

type Item = FilterableItemBase & {
  aliases?: string[]
}

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key })
}

describe('useFilterableListbox', () => {
  it('filters by query with default matcher', () => {
    const items = ref<Item[]>([
      { id: '1', label: 'Alpha' },
      { id: '2', label: 'Beta' }
    ])

    const api = useFilterableListbox({ items })
    api.query.value = 'be'

    expect(api.filteredItems.value.map((item) => item.label)).toEqual(['Beta'])
  })

  it('supports custom matcher for aliases', () => {
    const items = ref<Item[]>([
      { id: 'js', label: 'javascript', aliases: ['node'] },
      { id: 'ts', label: 'typescript', aliases: ['typed'] }
    ])

    const api = useFilterableListbox({
      items,
      match: (item, query) => item.label.includes(query) || (item.aliases ?? []).some((alias) => alias.includes(query))
    })

    api.query.value = 'node'
    expect(api.filteredItems.value.map((item) => item.id)).toEqual(['js'])
  })

  it('moves active index with arrow keys and wraps by default', () => {
    const items = ref<Item[]>([
      { id: '1', label: 'One' },
      { id: '2', label: 'Two' }
    ])

    const api = useFilterableListbox({ items })

    api.handleKeydown(keydown('ArrowUp'))
    expect(api.activeIndex.value).toBe(1)

    api.handleKeydown(keydown('ArrowDown'))
    expect(api.activeIndex.value).toBe(0)
  })

  it('selects active item on Enter', () => {
    const items = ref<Item[]>([
      { id: '1', label: 'One' },
      { id: '2', label: 'Two' }
    ])
    const onSelect = vi.fn()
    const api = useFilterableListbox({ items, onSelect })

    api.activeIndex.value = 1
    api.handleKeydown(keydown('Enter'))

    expect(onSelect).toHaveBeenCalledWith(items.value[1])
  })

  it('closes and clears query on Escape by default', () => {
    const items = ref<Item[]>([{ id: '1', label: 'One' }])
    const api = useFilterableListbox({ items })

    api.openMenu()
    api.query.value = 'one'
    api.handleKeydown(keydown('Escape'))

    expect(api.open.value).toBe(false)
    expect(api.query.value).toBe('')
  })

  it('keeps active index in bounds when filtering shrinks results', async () => {
    const items = ref<Item[]>([
      { id: '1', label: 'Alpha' },
      { id: '2', label: 'Beta' },
      { id: '3', label: 'Gamma' }
    ])

    const api = useFilterableListbox({ items })
    api.activeIndex.value = 2
    api.query.value = 'be'
    await nextTick()

    expect(api.filteredItems.value).toHaveLength(1)
    expect(api.activeIndex.value).toBe(0)
    expect(api.activeItem.value?.id).toBe('2')
  })

  it('is safe on empty lists', () => {
    const items = ref<Item[]>([])
    const onSelect = vi.fn()
    const api = useFilterableListbox({ items, onSelect })

    expect(() => api.handleKeydown(keydown('ArrowDown'))).not.toThrow()
    expect(() => api.handleKeydown(keydown('ArrowUp'))).not.toThrow()
    expect(() => api.handleKeydown(keydown('Enter'))).not.toThrow()

    expect(onSelect).not.toHaveBeenCalled()
    expect(api.activeItem.value).toBeNull()
  })
})
