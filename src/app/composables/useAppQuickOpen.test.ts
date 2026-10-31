import { nextTick, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppQuickOpen, type PaletteAction } from './useAppQuickOpen'
import type { LaunchpadRecentNote } from '../lib/appShellViewModels'

function createActions(): PaletteAction[] {
  return [
    { id: 'open-settings', label: 'Open Settings', family: 'utilities', run: vi.fn(() => true) },
    { id: 'split-pane-right', label: 'Split Pane Right', family: 'layout', run: vi.fn(() => true) },
    { id: 'split-pane-down', label: 'Split Pane Down', family: 'layout', run: vi.fn(() => true) },
    { id: 'reveal-in-explorer', label: 'Reveal in Explorer', family: 'utilities', run: vi.fn(() => true) }
  ]
}

type QuickOpenTestOptions = {
  allWorkspaceFiles?: string[]
  workingFolderPath?: string
  recentViewedNotes?: LaunchpadRecentNote[]
  favoritePaths?: string[]
  activeFilePath?: string
  paletteActions?: PaletteAction[]
  paletteActionPriority?: Record<string, number>
  contentHits?: Array<{ path: string; snippet: string; score: number }>
  quickOpenQuery?: Ref<string>
  quickOpenActiveIndex?: Ref<number>
}

function createQuickOpenHarness(options: QuickOpenTestOptions = {}) {
  return useAppQuickOpen({
    quickOpenDataPort: {
      allWorkspaceFiles: ref(options.allWorkspaceFiles ?? []),
      workingFolderPath: ref(options.workingFolderPath ?? '/vault'),
      recentViewedNotes: ref(options.recentViewedNotes ?? []),
      favoritePaths: ref(options.favoritePaths ?? []),
      activeFilePath: ref(options.activeFilePath ?? '')
    },
    quickOpenContentPort: {
      searchNoteContent: vi.fn(async () => options.contentHits ?? [])
    },
    contentSearchDebounceMs: 0,
    quickOpenDocumentPort: {
      isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
      toRelativePath: (path) => path.replace('/vault/', ''),
      dailyNotePath: (root, date) => `${root}/journal/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`
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
        { id: 'open-home-view', label: 'Open Home', family: 'navigation', run: vi.fn(() => true) },
        { id: 'create-new-file', label: 'New Note', family: 'notes', run: vi.fn(() => true) },
        { id: 'open-settings', label: 'Open Settings', family: 'utilities', run: vi.fn(() => true) }
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
      'create-new-file'
    ])
  })

  it('returns only browse actions when there are no recent notes', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'open-home-view', label: 'Open Home', family: 'navigation', run: vi.fn(() => true) },
        { id: 'open-today', label: 'Open Today', family: 'notes', run: vi.fn(() => true) },
        { id: 'create-new-file', label: 'New Note', family: 'notes', run: vi.fn(() => true) },
        { id: 'open-favorites', label: 'Open Favorites', family: 'navigation', run: vi.fn(() => true) },
        { id: 'open-settings', label: 'Open Settings', family: 'utilities', run: vi.fn(() => true) }
      ]
    })

    expect(api.quickOpenBrowseRecentResults.value).toEqual([])
    expect(api.quickOpenBrowseActionResults.value.map((item) => item.id)).toEqual([
      'open-home-view',
      'open-today',
      'create-new-file',
      'open-favorites'
    ])
  })

  it('returns file results and a daily note candidate', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/a.md', '/vault/journal/2026/03/2026-03-06.md']
    })

    api.quickOpenQuery.value = '2026-03-06'

    expect(api.quickOpenResults.value[0]).toEqual({
      kind: 'daily',
      date: '2026-03-06',
      path: '/vault/journal/2026/03/2026-03-06.md',
      exists: true,
      label: 'Open daily note 2026-03-06'
    })
  })

  it('does not propose a daily note when the query is not an ISO date', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/journal/2026/03/2026-03-06.md']
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
      allWorkspaceFiles: ['/vault/notes/2026-03-06-reference.md', '/VAULT/JOURNAL/2026/03/2026-03-06.MD']
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
        { id: 'b', label: 'Bravo', family: 'layout', run: vi.fn(() => true) },
        { id: 'a', label: 'Alpha', family: 'layout', run: vi.fn(() => true) },
        { id: 'c', label: 'Charlie', family: 'utilities', run: vi.fn(() => true) }
      ],
      paletteActionPriority: { b: 1, a: 1, c: 2 }
    })

    api.quickOpenQuery.value = '>'

    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts action matches by exact match, startsWith, then includes', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'exact', label: 'Split', family: 'layout', run: vi.fn(() => true) },
        { id: 'starts-with', label: 'Split Pane Right', family: 'layout', run: vi.fn(() => true) },
        { id: 'includes', label: 'Focus Split View', family: 'layout', run: vi.fn(() => true) }
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
        { id: 'open-home-view', label: 'Open Home', family: 'navigation', run: vi.fn(() => true) },
        { id: 'create-new-file', label: 'New Note', family: 'notes', run: vi.fn(() => true) },
        { id: 'open-settings', label: 'Open Settings', family: 'utilities', run: vi.fn(() => true) }
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

    expect(api.quickOpenActiveIndex.value).toBe(2)

    // Universal query: the note matching "a" plus the create action wrap as
    // one visible list (count follows the unified palette results).
    api.quickOpenQuery.value = 'a'
    api.moveQuickOpenSelection(-1)

    expect(api.quickOpenActiveIndex.value).toBe(1)
  })

  it('does not move selection when nothing is visible', () => {
    const api = createQuickOpenHarness()
    api.quickOpenActiveIndex.value = 3

    api.moveQuickOpenSelection(1)

    expect(api.quickOpenActiveIndex.value).toBe(3)
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

  it('groups action results by family while preserving rank order within each family', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'open-settings', label: 'Open Settings', family: 'utilities', run: vi.fn(() => true) },
        { id: 'open-home-view', label: 'Open Home', family: 'navigation', run: vi.fn(() => true) },
        { id: 'split-pane-right', label: 'Split Pane Right', family: 'layout', run: vi.fn(() => true) },
        { id: 'split-pane-down', label: 'Split Pane Down', family: 'layout', run: vi.fn(() => true) }
      ],
      paletteActionPriority: {
        'open-home-view': 0,
        'split-pane-right': 1,
        'split-pane-down': 2,
        'open-settings': 3
      }
    })

    api.quickOpenQuery.value = '>'

    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual([
      'open-home-view',
      'split-pane-right',
      'split-pane-down',
      'open-settings'
    ])
    expect(api.quickOpenActionGroups.value.map((group) => group.label)).toEqual([
      'Navigation',
      'Layout',
      'Utilities'
    ])
    expect(api.quickOpenActionGroups.value[1].items.map((item) => item.id)).toEqual([
      'split-pane-right',
      'split-pane-down'
    ])
  })
})

describe('useAppQuickOpen unified palette', () => {
  const recent = (path: string, label: string): LaunchpadRecentNote => ({
    path,
    title: label,
    relativePath: label,
    recencyLabel: 'recent'
  })

  it('caps browse recents at three and dedupes favorites against them', () => {
    const api = createQuickOpenHarness({
      recentViewedNotes: [
        recent('/vault/a/first.md', 'a/first.md'),
        recent('/vault/a/second.md', 'a/second.md'),
        recent('/vault/a/third.md', 'a/third.md'),
        recent('/vault/a/fourth.md', 'a/fourth.md')
      ],
      favoritePaths: ['/vault/a/second.md', '/vault/b/fav.md']
    })

    expect(api.quickOpenBrowseRecentResults.value).toHaveLength(3)
    expect(api.quickOpenBrowseFavoriteResults.value.map((item) => item.path)).toEqual(['/vault/b/fav.md'])
    expect(api.quickOpenBrowseItems.value.filter((item) => item.kind === 'favorite')).toHaveLength(1)
  })

  it('shows only quick actions when no history and no favorites exist', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        { id: 'create-new-file', label: 'New Note', family: 'notes', run: vi.fn(() => true) }
      ]
    })

    expect(api.quickOpenBrowseRecentResults.value).toEqual([])
    expect(api.quickOpenBrowseFavoriteResults.value).toEqual([])
    expect(api.quickOpenBrowseItems.value.every((item) => item.kind === 'action')).toBe(true)
  })

  it('derives the search mode from reversible prefixes', () => {
    const api = createQuickOpenHarness()
    api.quickOpenQuery.value = 'zettel'
    expect(api.quickOpenMode.value).toBe('universal')
    api.quickOpenQuery.value = '> export'
    expect(api.quickOpenMode.value).toBe('commands')
    api.quickOpenQuery.value = '# granularite'
    expect(api.quickOpenMode.value).toBe('content')
    api.quickOpenQuery.value = '? liens'
    expect(api.quickOpenMode.value).toBe('help')
    api.quickOpenQuery.value = 'zettel'
    expect(api.quickOpenMode.value).toBe('universal')
  })

  it('returns categorized ranked results for a universal query', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: [
        '/vault/connaisse/methode-zettelkasten.md',
        '/vault/connaisse/comprendre-zettelkasten.md',
        '/vault/exemples/notes-atomiques.md'
      ],
      recentViewedNotes: [recent('/vault/exemples/notes-atomiques.md', 'exemples/notes-atomiques.md')],
      paletteActions: [
        { id: 'create-new-file', label: 'New Note', family: 'notes', run: vi.fn(() => true) },
        {
          id: 'convert-to-word',
          label: 'Convert to Word',
          family: 'utilities',
          keywords: ['docx', 'convertir'],
          run: vi.fn(() => true)
        }
      ]
    })
    api.quickOpenQuery.value = 'zettel'

    const results = api.paletteResults.value
    expect(results.filter((item) => item.kind === 'note').map((item) => (item as { path: string }).path)).toEqual([
      '/vault/connaisse/comprendre-zettelkasten.md',
      '/vault/connaisse/methode-zettelkasten.md'
    ])
    expect(results[results.length - 1]).toEqual({ kind: 'create', title: 'zettel' })

    const categories = api.paletteCategories.value
    expect(categories.map((category) => category.id)).toEqual(['notes', 'create'])
    expect(categories[0]).toMatchObject({ id: 'notes', label: 'Notes', startIndex: 0 })
    expect(categories[1]).toMatchObject({ id: 'create', label: 'Create', startIndex: 2 })
  })

  it('ranks notes with the title ladder and tie-breakers', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: [
        '/vault/zettel.md',
        '/vault/autres/notes-zettel.md',
        '/vault/projets/notes-zettel-suite.md'
      ],
      recentViewedNotes: [recent('/vault/autres/notes-zettel.md', 'autres/notes-zettel.md')],
      favoritePaths: ['/vault/projets/notes-zettel-suite.md'],
      activeFilePath: '/vault/projets/roadmap.md'
    })
    api.quickOpenQuery.value = 'zettel'

    const noteResults = api.paletteResults.value.filter((item) => item.kind === 'note') as Array<{
      path: string
      matchKind: string
    }>
    // Exact title match first; then, among comparable partial matches, the
    // recent note beats the favorite one.
    expect(noteResults[0]).toMatchObject({ path: '/vault/zettel.md', matchKind: 'exact' })
    expect(noteResults.slice(1).map((item) => item.path)).toEqual([
      '/vault/autres/notes-zettel.md',
      '/vault/projets/notes-zettel-suite.md'
    ])
  })

  it('offers the daily note first for an ISO date query', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/journal/2026/10/2026-10-31.md']
    })
    api.quickOpenQuery.value = '2026-10-31'

    expect(api.paletteResults.value[0]).toEqual({
      kind: 'daily',
      date: '2026-10-31',
      path: '/vault/journal/2026/10/2026-10-31.md',
      exists: true
    })
  })

  it('mixes matching commands into universal results below notes', () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/convertisseur-de-notes.md'],
      paletteActions: [
        {
          id: 'convert-to-word',
          label: 'Convert to Word',
          family: 'utilities',
          keywords: ['docx', 'convertir'],
          run: vi.fn(() => true)
        }
      ]
    })
    api.quickOpenQuery.value = 'convertir'

    const kinds = api.paletteResults.value.map((item) => item.kind)
    expect(kinds).toEqual(['note', 'command', 'create'])
    expect(api.paletteCategories.value.map((category) => category.id)).toEqual(['notes', 'commands', 'create'])
  })
})

describe('useAppQuickOpen command catalog behavior', () => {
  const catalog = (): PaletteAction[] => [
    {
      id: 'convert-to-word',
      label: 'Convert to Word',
      family: 'notes',
      description: 'Convert the active note to DOCX',
      keywords: ['word', 'docx', 'convertir', 'export'],
      isEnabled: () => false,
      unavailableReason: 'Open a note to convert it',
      run: vi.fn(() => true)
    },
    {
      id: 'new-note',
      label: 'New Note',
      family: 'notes',
      description: 'Create a note in the active folder',
      shortcutLabel: 'Cmd+N',
      run: vi.fn(() => true)
    }
  ]

  it('reaches commands through their keywords', () => {
    const api = createQuickOpenHarness({ paletteActions: catalog() })
    api.quickOpenQuery.value = '> docx'
    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['convert-to-word'])

    api.quickOpenQuery.value = '> convertir'
    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['convert-to-word'])
  })

  it('keeps description and shortcut data on the results', () => {
    const api = createQuickOpenHarness({ paletteActions: catalog() })
    api.quickOpenQuery.value = '> new'

    const byId = new Map(api.quickOpenActionResults.value.map((item) => [item.id, item]))
    expect(byId.get('new-note')).toMatchObject({
      description: 'Create a note in the active folder',
      shortcutLabel: 'Cmd+N'
    })

    api.quickOpenQuery.value = '> docx'
    expect(api.quickOpenActionResults.value[0]).toMatchObject({
      id: 'convert-to-word',
      description: 'Convert the active note to DOCX'
    })
  })

  it('hides unavailable commands by default but shows them when they match', () => {
    const api = createQuickOpenHarness({ paletteActions: catalog() })

    // Empty action query: only available commands are listed.
    api.quickOpenQuery.value = '>'
    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['new-note'])

    // Explicit match: the unavailable command stays visible with its reason.
    api.quickOpenQuery.value = '> convert to word'
    const results = api.quickOpenActionResults.value
    expect(results.map((item) => item.id)).toEqual(['convert-to-word'])
    expect(results[0].isEnabled?.()).toBe(false)
    expect(results[0].unavailableReason).toBe('Open a note to convert it')
  })

  it('sorts available commands before unavailable ones with the same match', () => {
    const api = createQuickOpenHarness({
      paletteActions: [
        {
          id: 'disabled-export',
          label: 'Export Note',
          family: 'notes',
          keywords: ['export'],
          isEnabled: () => false,
          unavailableReason: 'Open a note first',
          run: vi.fn(() => true)
        },
        {
          id: 'enabled-export',
          label: 'Export Selection',
          family: 'notes',
          keywords: ['export'],
          run: vi.fn(() => true)
        }
      ]
    })
    api.quickOpenQuery.value = '> export'

    expect(api.quickOpenActionResults.value.map((item) => item.id)).toEqual(['enabled-export', 'disabled-export'])
  })
})

describe('useAppQuickOpen content search', () => {
  const hit = (path: string, snippet: string, score = 1): { path: string; snippet: string; score: number } => ({
    path,
    snippet,
    score
  })

  async function flushContentSearch() {
    // Vue flushes the query watcher on a microtask; the debounce timer is a
    // separate macrotask; the search promise resolves on microtasks after it.
    for (let index = 0; index < 3; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    await Promise.resolve()
    await Promise.resolve()
  }

  it('merges debounced content results between notes and commands', async () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/notes-atomiques.md'],
      paletteActions: [
        { id: 'new-note', label: 'New Note', family: 'notes', keywords: ['notes'], run: vi.fn(() => true) }
      ],
      contentHits: [
        hit('/vault/notes/organiser.md', 'des <b>notes</b> reliées', 0.5)
      ]
    })
    api.quickOpenQuery.value = 'notes'
    await flushContentSearch()

    const kinds = api.paletteResults.value.map((item) => item.kind)
    expect(kinds).toEqual(['note', 'passage', 'command', 'create'])

    const passage = api.paletteResults.value.find((item) => item.kind === 'passage')
    expect(passage).toMatchObject({
      path: '/vault/notes/organiser.md',
      title: 'organiser',
      matches: [{ snippet: 'des <b>notes</b> reliées' }]
    })
    expect(api.paletteCategories.value.map((category) => category.id)).toEqual(['notes', 'content', 'commands', 'create'])
  })

  it('groups passages per note, caps matches, and caps notes', async () => {
    const api = createQuickOpenHarness({
      contentHits: [
        ...Array.from({ length: 7 }, (_, index) => hit('/vault/one.md', `match ${index}`, index)),
        hit('/vault/two.md', 'other match', 9),
        hit('/vault/three.md', 'third match', 10),
        hit('/vault/fourth.md', 'too many notes', 11),
        hit('/vault/fifth.md', 'too many notes', 12),
        hit('/vault/sixth.md', 'too many notes', 13)
      ]
    })
    api.quickOpenQuery.value = 'match'
    await flushContentSearch()

    const passages = api.paletteResults.value.filter((item) => item.kind === 'passage')
    // One flat row per match: 5 capped rows for one.md plus one per further
    // note, up to the note limit (sixth.md is dropped).
    expect(passages).toHaveLength(9)
    const oneRows = passages.filter((item) => (item as { path: string }).path === '/vault/one.md')
    expect(oneRows).toHaveLength(5)
    expect(oneRows.every((row) => (row as { matches: unknown[] }).matches.length === 1)).toBe(true)
    expect(passages.some((item) => (item as { path: string }).path === '/vault/sixth.md')).toBe(false)
  })

  it('serves content mode with passages only', async () => {
    const api = createQuickOpenHarness({
      contentHits: [hit('/vault/notes/a.md', 'une <b>granularité</b> fine', 0.4)]
    })
    api.quickOpenQuery.value = '# granularité'
    await flushContentSearch()

    expect(api.paletteResults.value.map((item) => item.kind)).toEqual(['passage'])
    expect(api.paletteResults.value[0]).toMatchObject({
      kind: 'passage',
      path: '/vault/notes/a.md',
      matches: [{ snippet: 'une <b>granularité</b> fine' }]
    })
  })

  it('keeps the selected item when passages arrive late', async () => {
    const api = createQuickOpenHarness({
      allWorkspaceFiles: ['/vault/notes/roadmap.md'],
      contentHits: [hit('/vault/notes/roadmap.md', 'late <b>roadmap</b> passage', 0.5)]
    })
    api.quickOpenQuery.value = 'roadmap'
    // Select the create row (last item) before content results arrive.
    api.setQuickOpenActiveIndex(api.quickOpenItemCount.value - 1)
    expect(api.paletteResults.value[api.quickOpenActiveIndex.value]).toMatchObject({ kind: 'create' })

    await flushContentSearch()

    expect(api.paletteResults.value[api.quickOpenActiveIndex.value]).toMatchObject({ kind: 'create' })
  })
})

describe('useAppQuickOpen tab menu', () => {
  it('opens and closes the menu, and moves the cursor with clamping', () => {
    const api = createQuickOpenHarness()
    expect(api.quickOpenTabMenu.value).toBeNull()

    api.openQuickOpenTabMenu('/vault/a.md', 'A')
    expect(api.quickOpenTabMenu.value).toEqual({ path: '/vault/a.md', title: 'A', itemIndex: 0 })
    expect(api.quickOpenTabMenuItems.value.map((item) => item.id)).toEqual([
      'copy-link',
      'toggle-favorite',
      'open-new-tab',
      'open-adjacent',
      'reveal-location'
    ])

    api.moveQuickOpenTabMenuSelection(1)
    expect(api.quickOpenTabMenu.value?.itemIndex).toBe(1)
    api.moveQuickOpenTabMenuSelection(10)
    expect(api.quickOpenTabMenu.value?.itemIndex).toBe(4)
    api.moveQuickOpenTabMenuSelection(-10)
    expect(api.quickOpenTabMenu.value?.itemIndex).toBe(0)
    api.setQuickOpenTabMenuItemIndex(3)
    expect(api.quickOpenTabMenu.value?.itemIndex).toBe(3)

    api.closeQuickOpenTabMenu()
    expect(api.quickOpenTabMenu.value).toBeNull()
    expect(api.quickOpenTabMenuItems.value).toEqual([])
  })

  it('labels the favorite toggle from the note favorite state', () => {
    const api = createQuickOpenHarness({ favoritePaths: ['/vault/a.md'] })
    api.openQuickOpenTabMenu('/vault/a.md', 'A')
    expect(api.quickOpenTabMenuItems.value.find((item) => item.id === 'toggle-favorite')?.label).toBe('Remove from favorites')

    api.openQuickOpenTabMenu('/vault/b.md', 'B')
    expect(api.quickOpenTabMenuItems.value.find((item) => item.id === 'toggle-favorite')?.label).toBe('Add to favorites')
  })

  it('closes the menu when the query changes or the palette resets', async () => {
    const api = createQuickOpenHarness()
    api.openQuickOpenTabMenu('/vault/a.md', 'A')
    expect(api.quickOpenTabMenu.value).not.toBeNull()

    api.quickOpenQuery.value = 'zettel'
    await nextTick()
    expect(api.quickOpenTabMenu.value).toBeNull()

    api.openQuickOpenTabMenu('/vault/a.md', 'A')
    api.resetQuickOpenState('')
    expect(api.quickOpenTabMenu.value).toBeNull()
  })
})
