import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import QuickOpenModal from './QuickOpenModal.vue'
import type { PaletteResult, PaletteResultCategory } from '../../composables/useAppQuickOpen'

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

    rows[0].click()
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
})
