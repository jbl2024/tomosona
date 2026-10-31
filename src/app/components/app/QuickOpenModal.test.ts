import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import QuickOpenModal from './QuickOpenModal.vue'
import type { PaletteResult, PaletteResultCategory, PaletteTabActionId, QuickOpenTabMenu, QuickOpenTabMenuItem } from '../../composables/useAppQuickOpen'

function mountHarness(options?: { query?: string; isActionMode?: boolean; hasTextQuery?: boolean }) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const query = ref(options?.query ?? '')
  const actionSelections: string[] = []
  const resultSelections: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(QuickOpenModal, {
          visible: true,
          query: query.value,
          isActionMode: options?.isActionMode ?? true,
          hasTextQuery: options?.hasTextQuery ?? false,
          actionGroups: [
            {
              family: 'navigation',
              label: 'Navigation',
              items: [
                { id: 'open-home-view', label: 'Open Home', family: 'navigation', run: () => true }
              ]
            },
            {
              family: 'utilities',
              label: 'Utilities',
              items: [
                { id: 'open-settings', label: 'Open Settings', family: 'utilities', run: () => true }
              ]
            }
          ],
          recentResults: [
            { kind: 'recent', path: '/vault/notes/alpha.md', label: 'notes/alpha.md', recencyLabel: '2m ago' }
          ],
          browseActionResults: [{ kind: 'action', id: 'open-home-view', label: 'Open Home' }],
          fileResults: [{ kind: 'file', path: '/vault/notes/beta.md', label: 'notes/beta.md' }],
          activeIndex: 0,
          'onUpdate:query': (value: string) => { query.value = value },
          onSelectAction: (id: string) => actionSelections.push(id),
          onSelectResult: (item: { path: string }) => resultSelections.push(item.path),
          onKeydown: () => {},
          onClose: () => {},
          onSetActiveIndex: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, query, actionSelections, resultSelections }
}

describe('QuickOpenModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits query updates and action selections', async () => {
    const mounted = mountHarness({ isActionMode: true })
    const sectionTitles = Array.from(mounted.root.querySelectorAll('.modal-section-title')).map((node) => node.textContent?.trim())
    expect(sectionTitles).toEqual(['Navigation', 'Utilities'])

    const input = mounted.root.querySelector<HTMLInputElement>('[data-quick-open-input="true"]')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    if (input) {
      input.value = '>open settings'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()

    mounted.root.querySelector<HTMLButtonElement>('.palette-row-main')?.click()
    mounted.root.querySelectorAll<HTMLButtonElement>('.palette-row-main')[1]?.click()

    expect(mounted.query.value).toBe('>open settings')
    expect(mounted.actionSelections).toEqual(['open-home-view', 'open-settings'])
    expect(mounted.resultSelections).toEqual([])

    mounted.app.unmount()
  })

  it('renders browse sections and emits recent/file selections', async () => {
    const mounted = mountHarness({ isActionMode: false, hasTextQuery: false })

    const sectionTitles = Array.from(mounted.root.querySelectorAll('.modal-section-title')).map((node) => node.textContent?.trim())
    expect(sectionTitles).toEqual(['Recent notes', 'Quick actions'])

    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('.modal-item')
    buttons[0]?.click()
    buttons[1]?.click()
    await nextTick()

    expect(mounted.resultSelections).toEqual(['/vault/notes/alpha.md'])
    expect(mounted.actionSelections).toEqual(['open-home-view'])

    mounted.app.unmount()
  })

  it('renders file results for non-empty search queries', () => {
    const mounted = mountHarness({ isActionMode: false, hasTextQuery: true, query: 'beta' })

    expect(mounted.root.querySelector('.modal-section-title')).toBeNull()
    expect(mounted.root.textContent).toContain('notes/beta.md')

    mounted.app.unmount()
  })
})

describe('QuickOpenModal universal palette rendering', () => {
  function mountPaletteHarness(options?: {
    query?: string
    categories?: PaletteResultCategory[]
  }) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const selections: PaletteResult[] = []
    const queryUpdates: string[] = []

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(QuickOpenModal, {
            visible: true,
            query: options?.query ?? 'zettel',
            isActionMode: false,
            hasTextQuery: true,
            actionGroups: [],
            recentResults: [],
            browseActionResults: [],
            fileResults: [],
            categories: options?.categories ?? [],
            activeIndex: 0,
            onSelectPaletteResult: (result: PaletteResult) => selections.push(result),
            'onUpdate:query': (value: string) => queryUpdates.push(value),
            onSelectAction: () => {},
            onSelectResult: () => {},
            onKeydown: () => {},
            onClose: () => {},
            onSetActiveIndex: () => {}
          })
      }
    }))

    app.mount(root)
    return { app, root, selections, queryUpdates }
  }

  it('shows the no-result state with the create action and a command switch', () => {
    const mounted = mountPaletteHarness({
      query: 'xyzabc',
      categories: [
        { id: 'create', label: 'Create', startIndex: 0, results: [{ kind: 'create', title: 'xyzabc' }] }
      ]
    })

    expect(mounted.root.textContent).toContain('No results for "xyzabc"')

    const switchButton = mounted.root.querySelector<HTMLButtonElement>('.palette-hint-button')
    expect(switchButton?.textContent).toBe('Search in commands')
    switchButton?.click()
    expect(mounted.queryUpdates).toEqual(['>xyzabc'])

    const createRow = mounted.root.querySelector<HTMLButtonElement>('.palette-row')
    createRow?.click()
    expect(mounted.selections).toEqual([{ kind: 'create', title: 'xyzabc' }])
    mounted.app.unmount()
  })

  it('renders unified categories with note rows and emits palette selections', () => {
    const mounted = mountPaletteHarness({
      categories: [
        {
          id: 'notes',
          label: 'Notes',
          startIndex: 0,
          results: [
            { kind: 'note', path: '/vault/methode.md', title: 'Méthode', folder: 'connaisse', matchKind: 'partial' }
          ]
        },
        {
          id: 'create',
          label: 'Create',
          startIndex: 1,
          results: [{ kind: 'create', title: 'zettel' }]
        }
      ]
    })

    const sections = mounted.root.querySelectorAll('.modal-section-title')
    expect(Array.from(sections).map((el) => el.textContent)).toEqual(['Notes', 'Create'])

    const rows = mounted.root.querySelectorAll<HTMLButtonElement>('.palette-row')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('Méthode')
    expect(rows[0].textContent).toContain('connaisse')

    // The note row is a wrapper: the main button opens, More opens the Tab menu.
    const noteMain = rows[0].querySelector<HTMLButtonElement>('.palette-row-main')
    noteMain?.click()
    expect(mounted.selections).toEqual([
      { kind: 'note', path: '/vault/methode.md', title: 'Méthode', folder: 'connaisse', matchKind: 'partial' }
    ])
    mounted.app.unmount()
  })


  it('renders unavailable commands with a badge and reason, and refuses their clicks', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const actionSelections: string[] = []
    const disabledAction = {
      id: 'convert-to-word',
      label: 'Convert to Word',
      family: 'notes' as const,
      description: 'Convert the active note to DOCX',
      isEnabled: () => false,
      unavailableReason: 'Open a note to convert it',
      run: () => true
    }

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(QuickOpenModal, {
            visible: true,
            query: '> convert',
            isActionMode: true,
            hasTextQuery: true,
            actionGroups: [{ family: 'notes', label: 'Notes', items: [disabledAction] }],
            recentResults: [],
            browseActionResults: [],
            fileResults: [],
            activeIndex: 0,
            onSelectAction: (id: string) => actionSelections.push(id),
            onSelectResult: () => {},
            onSelectPaletteResult: () => {},
            onKeydown: () => {},
            onClose: () => {},
            onSetActiveIndex: () => {}
          })
      }
    }))
    app.mount(root)

    expect(root.textContent).toContain('Convert to Word')
    expect(root.textContent).toContain('Open a note to convert it')
    expect(root.querySelector('.palette-badge')?.textContent).toBe('Unavailable')

    const button = root.querySelector<HTMLButtonElement>('.palette-row-main')
    expect(button?.disabled).toBe(true)
    button?.click()
    expect(actionSelections).toEqual([])

    app.unmount()
  })

  it('renders favorites in the browse state between recents and quick actions', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(QuickOpenModal, {
            visible: true,
            query: '',
            isActionMode: false,
            hasTextQuery: false,
            actionGroups: [],
            recentResults: [
              { kind: 'recent', path: '/vault/a.md', label: 'a.md', recencyLabel: '2m' }
            ],
            favoriteResults: [
              { kind: 'favorite', path: '/vault/b.md', label: 'b.md' }
            ],
            browseActionResults: [{ kind: 'action', id: 'open-home-view', label: 'Open Home' }],
            fileResults: [],
            activeIndex: 0,
            onSelectAction: () => {},
            onSelectResult: () => {},
            onSelectPaletteResult: () => {},
            onKeydown: () => {},
            onClose: () => {},
            onSetActiveIndex: () => {}
          })
      }
    }))
    app.mount(root)

    const sections = root.querySelectorAll('.modal-section-title')
    expect(Array.from(sections).map((el) => el.textContent)).toEqual(['Recent notes', 'Favorites', 'Quick actions'])
    app.unmount()
  })

  it('renders one selectable row per passage match with visual grouping', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const selections: PaletteResult[] = []
    const activeIndexUpdates: number[] = []

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(QuickOpenModal, {
            visible: true,
            query: 'granularité',
            isActionMode: false,
            hasTextQuery: true,
            actionGroups: [],
            recentResults: [],
            browseActionResults: [],
            fileResults: [],
            categories: [
              {
                id: 'content',
                label: 'In content',
                startIndex: 0,
                results: [
                  {
                    kind: 'passage',
                    path: '/vault/notes/atomiques.md',
                    title: 'notes-atomiques',
                    folder: 'notes',
                    matches: [{ snippet: 'la <b>granularité</b> fine' }]
                  },
                  {
                    kind: 'passage',
                    path: '/vault/notes/atomiques.md',
                    title: 'notes-atomiques',
                    folder: 'notes',
                    matches: [{ snippet: 'une <b>granularité</b> adaptée' }]
                  }
                ]
              }
            ],
            activeIndex: 0,
            onSelectPaletteResult: (result: PaletteResult) => selections.push(result),
            onSelectAction: () => {},
            onSelectResult: () => {},
            onKeydown: () => {},
            onClose: () => {},
            onSetActiveIndex: (index: number) => activeIndexUpdates.push(index)
          })
      }
    }))
    app.mount(root)

    // Two flat rows: the first carries the note title, the second continues
    // the group (indented snippet only) and stays individually selectable.
    const rows = root.querySelectorAll('.palette-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('notes-atomiques')
    expect(rows[0].textContent).toContain('la granularité fine')
    expect(rows[1].className).toContain('grouped')
    expect(rows[1].textContent).toContain('une granularité adaptée')
    expect(root.querySelectorAll('.palette-snippet-mark')).toHaveLength(2)

    rows[1].querySelector<HTMLButtonElement>('.palette-row-main')?.click()
    expect(selections).toEqual([
      {
        kind: 'passage',
        path: '/vault/notes/atomiques.md',
        title: 'notes-atomiques',
        folder: 'notes',
        matches: [{ snippet: 'une <b>granularité</b> adaptée' }]
      }
    ])

    // Hover on the continuation row targets its own flat index.
    rows[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(activeIndexUpdates).toContain(1)

    app.unmount()
  })
})

describe('QuickOpenModal tab menu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountTabMenuHarness(options?: { tabMenu?: QuickOpenTabMenu | null; tabMenuItems?: QuickOpenTabMenuItem[] }) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const tabMenuEvents: Array<[string, string]> = []
    const tabMenuCloseEvents: number[] = []
    const runEvents: Array<[QuickOpenTabMenu, PaletteTabActionId]> = []
    const selections: PaletteResult[] = []

    const app = createApp(defineComponent({
      setup() {
        return () =>
          h(QuickOpenModal, {
            visible: true,
            query: 'methode',
            isActionMode: false,
            hasTextQuery: true,
            actionGroups: [],
            recentResults: [],
            browseActionResults: [],
            fileResults: [],
            categories: [
              {
                id: 'notes',
                label: 'Notes',
                startIndex: 0,
                results: [
                  { kind: 'note', path: '/vault/methode.md', title: 'Méthode', folder: '', matchKind: 'partial' },
                  { kind: 'note', path: '/vault/autre.md', title: 'Autre', folder: '', matchKind: 'partial' }
                ]
              }
            ],
            activeIndex: 0,
            tabMenu: options?.tabMenu ?? null,
            tabMenuItems: options?.tabMenuItems ?? [],
            onSelectPaletteResult: (result: PaletteResult) => selections.push(result),
            onOpenTabMenu: (path: string, title: string) => tabMenuEvents.push([path, title]),
            onCloseTabMenu: () => tabMenuCloseEvents.push(1),
            onSetTabMenuItemIndex: () => {},
            onRunTabMenuAction: (menu: QuickOpenTabMenu, action: PaletteTabActionId) => runEvents.push([menu, action]),
            onSelectAction: () => {},
            onSelectResult: () => {},
            onKeydown: () => {},
            onClose: () => {},
            onSetActiveIndex: () => {}
          })
      }
    }))

    app.mount(root)
    return { app, root, tabMenuEvents, tabMenuCloseEvents, runEvents, selections }
  }

  const menuItems: QuickOpenTabMenuItem[] = [
    { id: 'copy-link', label: 'Copy note link' },
    { id: 'toggle-favorite', label: 'Add to favorites' },
    { id: 'open-new-tab', label: 'Open in new tab' },
    { id: 'open-adjacent', label: 'Open in adjacent pane' },
    { id: 'reveal-location', label: 'Reveal file location' }
  ]

  it('renders the More toggle on note rows and emits the open event', () => {
    const mounted = mountTabMenuHarness()

    const moreButtons = mounted.root.querySelectorAll<HTMLButtonElement>('.palette-more')
    expect(moreButtons).toHaveLength(2)
    expect(moreButtons[0].textContent?.trim()).toBe('More')

    moreButtons[0].click()
    expect(mounted.tabMenuEvents).toEqual([['/vault/methode.md', 'Méthode']])
    expect(mounted.runEvents).toEqual([])
    mounted.app.unmount()
  })

  it('renders the menu under its note row and emits the action on click', () => {
    const mounted = mountTabMenuHarness({
      tabMenu: { path: '/vault/methode.md', title: 'Méthode', itemIndex: 1 },
      tabMenuItems: menuItems
    })

    const menu = mounted.root.querySelector('[data-quick-open-tab-menu="true"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('Add to favorites')

    const items = mounted.root.querySelectorAll<HTMLButtonElement>('.palette-tab-menu-item')
    expect(items).toHaveLength(5)
    expect(items[1].className).toContain('active')

    items[0].click()
    expect(mounted.runEvents).toEqual([
      [{ path: '/vault/methode.md', title: 'Méthode', itemIndex: 1 }, 'copy-link']
    ])
    expect(mounted.selections).toEqual([])
    mounted.app.unmount()
  })

  it('closes the menu from the More toggle when it is already open', () => {
    const mounted = mountTabMenuHarness({
      tabMenu: { path: '/vault/methode.md', title: 'Méthode', itemIndex: 0 },
      tabMenuItems: menuItems
    })

    const moreButton = mounted.root.querySelector<HTMLButtonElement>('.palette-more')
    moreButton?.click()
    expect(mounted.tabMenuEvents).toEqual([])
    expect(mounted.tabMenuCloseEvents).toHaveLength(1)
    mounted.app.unmount()
  })

  it('keeps the primary open path unchanged while the menu is closed', () => {
    const mounted = mountTabMenuHarness({ tabMenu: null, tabMenuItems: [] })

    expect(mounted.root.querySelector('[data-quick-open-tab-menu="true"]')).toBeNull()

    const noteMain = mounted.root.querySelector<HTMLButtonElement>('.palette-row-main')
    noteMain?.click()
    expect(mounted.selections).toEqual([
      { kind: 'note', path: '/vault/methode.md', title: 'Méthode', folder: '', matchKind: 'partial' }
    ])
    mounted.app.unmount()
  })
})
