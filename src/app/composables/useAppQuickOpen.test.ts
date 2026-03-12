import { nextTick, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppQuickOpen, type PaletteAction } from './useAppQuickOpen'
import type { LaunchpadRecentNote } from '../lib/appShellViewModels'

function createActions(): PaletteAction[] {
  return [
    { id: 'open-settings', label: 'Open Settings', run: vi.fn(() => true) },
    { id: 'split-pane-right', label: 'Split Pane Right', run: vi.fn(() => true) },
    { id: 'split-pane-down', label: 'Split Pane Down', run: vi.fn(() => true) },
    { id: 'reveal-in-explorer', label: 'Reveal in Explorer', run: vi.fn(() => true) }
  ]
}

type QuickOpenTestOptions = {
  allWorkspaceFiles?: string[]
  workingFolderPath?: string
  recentViewedNotes?: LaunchpadRecentNote[]
  paletteActions?: PaletteAction[]
  paletteActionPriority?: Record<string, number>
  quickOpenQuery?: Ref<string>
  quickOpenActiveIndex?: Ref<number>
}

function createQuickOpenHarness(options: QuickOpenTestOptions = {}) {
  return useAppQuickOpen({
    quickOpenDataPort: {
      allWorkspaceFiles: ref(options.allWorkspaceFiles ?? []),
      workingFolderPath: ref(options.workingFolderPath ?? '/vault'),
      recentViewedNotes: ref(options.recentViewedNotes ?? [])
    },
    quickOpenDocumentPort: {
      isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
      toRelativePath: (path) => path.replace('/vault/', ''),
      dailyNotePath: (root, date) => `${root}/journal/${date}.md`
    },
    quickOpenPalettePort: {
      paletteActions: ref(options.paletteActions ?? createActions()),
      paletteActionPriority: options.paletteActionPriority ?? {
        'split-pane-right': 1,
        'split-pane-down': 2,
        'open-settings': 3,
        'reveal-in-explorer': 4
      }
    },
    quickOpenQuery: options.quickOpenQuery,
    quickOpenActiveIndex: options.quickOpenActiveIndex
  })
}

describe('useAppQuickOpen', () => {
  it('returns recent notes then quick actions when the query is empty', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'open-home-view', label: 'Open Home', run: vi.fn(() => true) },
        { id: 'create-new-file', label: 'New Note', run: vi.fn(() => true) },
        { id: 'open-settings', label: 'Open Settings', run: vi.fn(() => true) }
      ],
      recentViewedNotes: [
        {
          path: '/vault/notes/alpha.md',
          title: 'Alpha',
          relativePath: 'notes/alpha.md',
          recencyLabel: '2m ago'
        }
      ]
    })

    expect(api.quickOpenHasTextQuery.value).toBe(false)
    expect(api.quickOpenBrowseRecentResults.value).toEqual([
      {
        kind: 'recent',
        path: '/vault/notes/alpha.md',
        label: 'notes/alpha.md',
        recencyLabel: '2m ago'
      }
    ])
    expect(api.quickOpenBrowseActionResults.value.map((item) => item.id)).toEqual([
      'open-home-view',
      'create-new-file',
      'open-settings'
    ])
  })

  it('returns only browse actions when there are no recent notes', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'open-home-view', label: 'Open Home', run: vi.fn(() => true) },
        { id: 'open-today', label: 'Open Today', run: vi.fn(() => true) },
        { id: 'create-new-file', label: 'New Note', run: vi.fn(() => true) },
        { id: 'open-favorites', label: 'Open Favorites', run: vi.fn(() => true) },
        { id: 'open-settings', label: 'Open Settings', run: vi.fn(() => true) }
      ]
    })

    expect(api.quickOpenBrowseRecentResults.value).toEqual([])
    expect(api.quickOpenBrowseActionResults.value.map((item) => item.id)).toEqual([
      'open-home-view',
      'open-today',
      'create-new-file',
      'open-favorites',
      'open-settings'
    ])
  })

  it('returns file results and a daily note candidate', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/a.md', '/vault/journal/2026-03-06.md']
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

  it('does not propose a daily note when the query is not an ISO date', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/journal/2026-03-06.md']
    })

    api.quickOpenQuery.value = '2026-03'

    expect(api.quickOpenResults.value.some((item) => item.kind === 'daily')).toBe(false)
  })

  it('does not propose a daily note when no workspace is open', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/a.md'],
      workingFolderPath: ''
    })

    api.quickOpenQuery.value = '2026-03-06'

    expect(api.quickOpenResults.value.some((item) => item.kind === 'daily')).toBe(false)
  })

  it('places the daily note first and matches existence case-insensitively', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/2026-03-06-reference.md', '/VAULT/JOURNAL/2026-03-06.MD']
    })

    api.quickOpenQuery.value = '2026-03-06'

    expect(api.quickOpenResults.value[0]).toMatchObject({
      kind: 'daily',
      exists: true
    })
    expect(api.quickOpenResults.value[1]).toMatchObject({
      kind: 'file',
      path: '/vault/notes/2026-03-06-reference.md'
    })
  })

  it('matches file results on absolute and relative paths without case sensitivity', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/Daily.md', '/vault/projects/alpha.md']
    })

    api.quickOpenQuery.value = 'NOTES'
    expect(api.quickOpenResults.value.map((item) => item.kind === 'file' ? item.path : item.path)).toContain('/vault/notes/Daily.md')

    api.quickOpenQuery.value = 'alpha'
    expect(api.quickOpenResults.value[0]).toMatchObject({
      kind: 'file',
      path: '/vault/projects/alpha.md',
      label: 'projects/alpha.md'
    })
  })

  it('matches file results accent-insensitively', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/Café.md', '/vault/journal/Résumé.md']
    })

    api.quickOpenQuery.value = 'cafe'
    expect(api.quickOpenResults.value[0]).toMatchObject({
      kind: 'file',
      path: '/vault/notes/Café.md',
      label: 'notes/Café.md'
    })

    api.quickOpenQuery.value = 'resume'
    expect(api.quickOpenResults.value[0]).toMatchObject({
      kind: 'file',
      path: '/vault/journal/Résumé.md',
      label: 'journal/Résumé.md'
    })
  })

  it('limits file results to 80 entries', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: Array.from({ length: 100 }, (_, index) => `/vault/notes/note-${index}.md`)
    })

    api.quickOpenQuery.value = 'note-'

    expect(api.quickOpenResults.value).toHaveLength(80)
  })

  it('switches to action mode and keeps file results empty there', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/a.md']
    })

    api.quickOpenQuery.value = '>split'

    expect(api.quickOpenIsActionMode.value).toBe(true)
    expect(api.quickOpenResults.value).toEqual([])
    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['split-pane-right', 'split-pane-down'])
  })

  it('keeps action results empty outside action mode', () => {
    const api = createQuickOpenHarness()

    api.quickOpenQuery.value = 'split'

    expect(api.quickOpenActionResults.value).toEqual([])
  })

  it('sorts empty action queries by priority then label', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'b', label: 'Bravo', run: vi.fn(() => true) },
        { id: 'a', label: 'Alpha', run: vi.fn(() => true) },
        { id: 'c', label: 'Charlie', run: vi.fn(() => true) }
      ],
      paletteActionPriority: { b: 1, a: 1, c: 2 }
    })

    api.quickOpenQuery.value = '>'

    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts action matches by exact match, startsWith, then includes', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'exact', label: 'Split', run: vi.fn(() => true) },
        { id: 'starts-with', label: 'Split Pane Right', run: vi.fn(() => true) },
        { id: 'includes', label: 'Focus Split View', run: vi.fn(() => true) }
      ]
    })

    api.quickOpenQuery.value = '>split'

    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['exact', 'starts-with', 'includes'])
  })

  it('reuses provided state refs when controlled by the parent', () => {
    const quickOpenQuery = ref('notes')
    const quickOpenActiveIndex = ref(2)
    const api = createQuickOpenHarness({ quickOpenQuery, quickOpenActiveIndex })

    expect(api.quickOpenQuery).toBe(quickOpenQuery)
    expect(api.quickOpenActiveIndex).toBe(quickOpenActiveIndex)
  })

  it('falls back to internal state refs when none are provided', () => {
    const api = createQuickOpenHarness()

    api.quickOpenQuery.value = 'notes'
    api.quickOpenActiveIndex.value = 1

    expect(api.quickOpenQuery.value).toBe('notes')
    expect(api.quickOpenActiveIndex.value).toBe(1)
  })

  it('wraps selection movement based on visible item count', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'open-home-view', label: 'Open Home', run: vi.fn(() => true) },
        { id: 'create-new-file', label: 'New Note', run: vi.fn(() => true) },
        { id: 'open-settings', label: 'Open Settings', run: vi.fn(() => true) }
      ],
      allWorkspaceFiles: ['/vault/a.md', '/vault/b.md'],
      recentViewedNotes: [
        {
          path: '/vault/notes/alpha.md',
          title: 'Alpha',
          relativePath: 'notes/alpha.md',
          recencyLabel: '2m ago'
        }
      ]
    })

    api.moveQuickOpenSelection(-1)

    expect(api.quickOpenActiveIndex.value).toBe(3)

    api.quickOpenQuery.value = 'md'
    api.moveQuickOpenSelection(-1)

    expect(api.quickOpenActiveIndex.value).toBe(0)
  })

  it('does not move selection when nothing is visible', () => {
    const api = createQuickOpenHarness()
    api.quickOpenActiveIndex.value = 3

    api.moveQuickOpenSelection(1)

    expect(api.quickOpenActiveIndex.value).toBe(0)
  })

  it('resets the active index when the visible mode changes', async () => {
    const api = createQuickOpenHarness({
      recentViewedNotes: [
        {
          path: '/vault/notes/alpha.md',
          title: 'Alpha',
          relativePath: 'notes/alpha.md',
          recencyLabel: '2m ago'
        }
      ],
      allWorkspaceFiles: ['/vault/notes/alpha.md']
    })

    api.quickOpenActiveIndex.value = 2
    api.quickOpenQuery.value = 'alpha'
    await nextTick()

    expect(api.quickOpenActiveIndex.value).toBe(0)
  })

  it('resets the active index to zero whenever quick open state is reset', () => {
    const api = createQuickOpenHarness()
    api.quickOpenQuery.value = 'notes'
    api.quickOpenActiveIndex.value = 4

    api.resetQuickOpenState('next')

    expect(api.quickOpenQuery.value).toBe('next')
    expect(api.quickOpenActiveIndex.value).toBe(0)
  })
})
