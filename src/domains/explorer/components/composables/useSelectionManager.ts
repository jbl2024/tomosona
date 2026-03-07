import { computed, ref } from 'vue'

export function useSelectionManager() {
  const selected = ref<Set<string>>(new Set())
  const anchor = ref<string>('')

  const selectedPaths = computed(() => Array.from(selected.value))

  function setSelection(paths: string[]) {
    selected.value = new Set(paths)
  }

  function clearSelection() {
    selected.value = new Set()
    anchor.value = ''
  }

  function isSelected(path: string) {
    return selected.value.has(path)
  }

  function selectSingle(path: string) {
    selected.value = new Set([path])
    anchor.value = path
  }

  function toggleSelection(path: string) {
    const next = new Set(selected.value)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    selected.value = next
    anchor.value = path
  }

  function selectRange(path: string, orderedPaths: string[]) {
    if (!orderedPaths.length) return

    const anchorPath = anchor.value || path
    const start = orderedPaths.indexOf(anchorPath)
    const end = orderedPaths.indexOf(path)

    if (start < 0 || end < 0) {
      selectSingle(path)
      return
    }

    const [from, to] = start <= end ? [start, end] : [end, start]
    const range = orderedPaths.slice(from, to + 1)
    selected.value = new Set(range)
  }

  return {
    selectedPaths,
    setSelection,
    clearSelection,
    isSelected,
    selectSingle,
    toggleSelection,
    selectRange,
    anchor
  }
}
