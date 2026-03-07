import { computed, ref, watch, type Ref } from 'vue'

/**
 * Minimal contract used by the shared dropdown behavior layer.
 *
 * Why:
 * - Keep shared logic independent from app-specific payload shapes.
 * - Require stable identity (`id`) plus searchable text (`label`) only.
 */
export type FilterableItemBase = {
  id: string
  label: string
}

/**
 * Configuration for {@link useFilterableListbox}.
 *
 * Typical usage:
 * - Pass reactive items.
 * - Provide `match` when search should include aliases or hidden keywords.
 * - Provide `onSelect` to bridge generic selection back to feature actions.
 */
export type UseFilterableListboxOptions<T extends FilterableItemBase> = {
  items: Ref<readonly T[]>
  match?: (item: T, query: string) => boolean
  onSelect?: (item: T) => void
  clearQueryOnClose?: boolean
  loopNavigation?: boolean
}

/**
 * Headless API consumed by dropdown UI components.
 *
 * Design intent:
 * - Centralize keyboard/filter semantics once.
 * - Let rendering remain fully customizable by each consumer.
 */
export type UseFilterableListboxApi<T extends FilterableItemBase> = {
  open: Ref<boolean>
  query: Ref<string>
  activeIndex: Ref<number>
  filteredItems: Readonly<Ref<T[]>>
  activeItem: Readonly<Ref<T | null>>
  activeItemId: Readonly<Ref<string | null>>
  openMenu: () => void
  closeMenu: () => void
  setActiveIndex: (index: number) => void
  selectActive: () => T | null
  selectIndex: (index: number) => T | null
  handleKeydown: (event: KeyboardEvent) => boolean
}

function defaultMatch<T extends FilterableItemBase>(item: T, query: string): boolean {
  return item.label.toLowerCase().includes(query)
}

/**
 * Shared state machine for filterable listbox/dropdown interactions.
 *
 * Why:
 * - Avoid duplicated menu behavior across editor and panel surfaces.
 * - Keep keyboard handling consistent (`Up/Down`, `Enter`, `Escape`).
 *
 * How to use:
 * 1. Bind `open`, `query`, `activeIndex` to your component state.
 * 2. Render `filteredItems`, using `activeItemId` for ARIA wiring.
 * 3. Forward relevant keydown events to `handleKeydown`.
 * 4. Handle selected item via `onSelect` option.
 */
export function useFilterableListbox<T extends FilterableItemBase>(
  options: UseFilterableListboxOptions<T>
): UseFilterableListboxApi<T> {
  const open = ref(false)
  const query = ref('')
  const activeIndex = ref(0)

  const filteredItems = computed<T[]>(() => {
    const matcher = options.match ?? defaultMatch
    const needle = query.value.trim().toLowerCase()
    if (!needle) return [...options.items.value]
    return options.items.value.filter((item) => matcher(item, needle))
  })

  const activeItem = computed<T | null>(() => filteredItems.value[activeIndex.value] ?? null)
  const activeItemId = computed<string | null>(() => activeItem.value?.id ?? null)

  /**
   * Keeps index valid as query/items change.
   *
   * Invariant:
   * - If there are entries, `activeIndex` points to one.
   * - If there are none, index is reset to a safe default (`0`).
   */
  function rebalanceActiveIndex() {
    if (!filteredItems.value.length) {
      activeIndex.value = 0
      return
    }
    if (activeIndex.value < 0) {
      activeIndex.value = 0
      return
    }
    if (activeIndex.value >= filteredItems.value.length) {
      activeIndex.value = filteredItems.value.length - 1
    }
  }

  function openMenu() {
    open.value = true
  }

  /**
   * Closes and resets transient interaction state.
   *
   * Note:
   * - Query clearing is configurable for menus that need sticky search.
   */
  function closeMenu() {
    open.value = false
    activeIndex.value = 0
    if (options.clearQueryOnClose !== false) {
      query.value = ''
    }
  }

  function setActiveIndex(index: number) {
    activeIndex.value = index
    rebalanceActiveIndex()
  }

  function selectIndex(index: number): T | null {
    const item = filteredItems.value[index] ?? null
    if (!item) return null
    options.onSelect?.(item)
    return item
  }

  function selectActive(): T | null {
    return selectIndex(activeIndex.value)
  }

  function shiftActive(delta: 1 | -1) {
    const total = filteredItems.value.length
    if (!total) return

    const loop = options.loopNavigation !== false
    if (loop) {
      activeIndex.value = (activeIndex.value + delta + total) % total
      return
    }

    activeIndex.value = Math.max(0, Math.min(activeIndex.value + delta, total - 1))
  }

  /**
   * Applies standardized listbox keyboard semantics.
   *
   * Returns `true` when handled and default behavior was suppressed.
   */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      shiftActive(1)
      return true
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      shiftActive(-1)
      return true
    }

    if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIndex(0)
      return true
    }

    if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIndex(Math.max(0, filteredItems.value.length - 1))
      return true
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      selectActive()
      return true
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return true
    }

    return false
  }

  watch(filteredItems, rebalanceActiveIndex, { immediate: true })
  watch(query, () => {
    activeIndex.value = 0
  })

  return {
    open,
    query,
    activeIndex,
    filteredItems,
    activeItem,
    activeItemId,
    openMenu,
    closeMenu,
    setActiveIndex,
    selectActive,
    selectIndex,
    handleKeydown
  }
}
