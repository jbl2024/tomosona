import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppQuickOpen, type PaletteAction } from './useAppQuickOpen'

function createActions(): PaletteAction[] {
  return [
    { id: 'open-settings', label: 'Open Settings', run: vi.fn(() => true) },
    { id: 'split-pane-right', label: 'Split Pane Right', run: vi.fn(() => true) }
  ]
}

describe('useAppQuickOpen', () => {
  it('returns file results and a daily note candidate', () => {
    const api = useAppQuickOpen({
      allWorkspaceFiles: ref(['/vault/notes/a.md', '/vault/journal/2026-03-06.md']),
      workingFolderPath: ref('/vault'),
      isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
      toRelativePath: (path) => path.replace('/vault/', ''),
      dailyNotePath: (root, date) => `${root}/journal/${date}.md`,
      paletteActions: ref(createActions()),
      paletteActionPriority: { 'open-settings': 1, 'split-pane-right': 2 }
    })

    api.quickOpenQuery.value = '2026-03-06'

    expect(api.quickOpenResults.value[0]).toEqual({
      kind: 'daily',
      date: '2026-03-06',
      path: '/vault/journal/2026-03-06.md',
      exists: true,
      label: 'Open daily note 2026-03-06'
    })
  })

  it('switches to action mode and sorts matches by rank then priority', () => {
    const api = useAppQuickOpen({
      allWorkspaceFiles: ref([]),
      workingFolderPath: ref('/vault'),
      isIsoDate: () => false,
      toRelativePath: (path) => path,
      dailyNotePath: (root, date) => `${root}/${date}`,
      paletteActions: ref(createActions()),
      paletteActionPriority: { 'open-settings': 5, 'split-pane-right': 1 }
    })

    api.quickOpenQuery.value = '>split'

    expect(api.quickOpenIsActionMode.value).toBe(true)
    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['split-pane-right'])
  })

  it('wraps selection movement based on visible item count', () => {
    const api = useAppQuickOpen({
      allWorkspaceFiles: ref(['/vault/a.md', '/vault/b.md']),
      workingFolderPath: ref('/vault'),
      isIsoDate: () => false,
      toRelativePath: (path) => path.replace('/vault/', ''),
      dailyNotePath: (root, date) => `${root}/${date}`,
      paletteActions: ref(createActions()),
      paletteActionPriority: {}
    })

    api.quickOpenQuery.value = 'a'
    api.moveQuickOpenSelection(-1)

    expect(api.quickOpenActiveIndex.value).toBe(1)

    api.quickOpenQuery.value = 'md'
    api.moveQuickOpenSelection(-1)

    expect(api.quickOpenActiveIndex.value).toBe(0)
  })
})
