import { createApp, defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorRightPane from './EditorRightPane.vue'

describe('EditorRightPane', () => {
  it('renders workflow sections and forwards intents', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onOutlineClick = vi.fn()
    const onBacklinkOpen = vi.fn()
    const onToggleFavorite = vi.fn()
    const onActiveNoteAddToContext = vi.fn()
    const onActiveNoteRemoveFromContext = vi.fn()
    const onActiveNoteOpenCosmos = vi.fn()
    const onEchoesAddToContext = vi.fn()
    const onContextOpen = vi.fn()
    const onContextRemove = vi.fn()
    const onContextPreserve = vi.fn()
    const onContextClear = vi.fn()
    const onContextOpenSecondBrain = vi.fn()
    const onContextOpenCosmos = vi.fn()
    const onContextOpenPulse = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorRightPane, {
          width: 320,
          activeNotePath: '/wk/notes/a.md',
          activeNoteTitle: 'A',
          activeStateLabel: 'saved',
          backlinkCount: 1,
          semanticLinkCount: 2,
          activeNoteInContext: false,
          canToggleFavorite: true,
          isFavorite: true,
          echoesItems: [{
            path: '/wk/notes/e.md',
            title: 'Echo',
            reasonLabel: 'Direct link',
            reasonLabels: ['Direct link'],
            score: 1,
            signalSources: ['direct'],
            isInContext: false
          }],
          echoesLoading: false,
          echoesError: '',
          echoesHintVisible: true,
          contextMode: 'local',
          contextItems: [{ path: '/wk/notes/c.md', title: 'Context' }],
          canReasonOnContext: true,
          isLaunchingContextAction: false,
          outline: [{ level: 2, text: 'Roadmap' }],
          semanticLinks: [{ path: '/wk/notes/s.md', score: 0.88, direction: 'outgoing' }],
          semanticLinksLoading: false,
          backlinks: ['/wk/notes/a.md'],
          backlinksLoading: false,
          metadataRows: [{ label: 'Path', value: 'notes/a.md' }],
          propertiesPreview: [{ key: 'tags', value: 'doc' }],
          propertyParseErrorCount: 0,
          toRelativePath: (path: string) => path.replace('/wk/', ''),
          onToggleFavorite,
          onOutlineClick,
          onBacklinkOpen,
          onActiveNoteAddToContext,
          onActiveNoteRemoveFromContext,
          onActiveNoteOpenCosmos,
          onEchoesAddToContext,
          onContextOpen,
          onContextRemove,
          onContextPreserve,
          onContextClear,
          onContextOpenSecondBrain,
          onContextOpenCosmos,
          onContextOpenPulse
        })
      }
    }))

    app.mount(root)
    const sectionTitles = Array.from(root.querySelectorAll('.section-title')).map((el) => el.textContent?.trim())
    expect(sectionTitles.slice(0, 5)).toEqual([
      'Active Note',
      'Echoes',
      'Context for This Note',
      'Outline',
      'Semantic Links'
    ])
    expect(root.querySelectorAll('.section-toggle')).toHaveLength(5)
    expect(root.querySelector('.favorite-toggle-btn--active')).toBeTruthy()
    expect(root.textContent).toContain('Reason on This Context')
    expect(root.textContent).toContain('Explore in Cosmos')
    expect(root.textContent).toContain('Transform with Pulse')

    ;(root.querySelector('.favorite-toggle-btn') as HTMLButtonElement).click()
    expect(onToggleFavorite).toHaveBeenCalledTimes(1)

    ;(root.querySelector('.primary-context-btn') as HTMLButtonElement).click()
    expect(onActiveNoteAddToContext).toHaveBeenCalledTimes(1)
    ;(root.querySelector('.secondary-note-btn') as HTMLButtonElement).click()
    expect(onActiveNoteOpenCosmos).toHaveBeenCalledTimes(1)

    const echoesButtons = Array.from(root.querySelectorAll('.echoes-action-btn')) as HTMLButtonElement[]
    echoesButtons[1].click()
    expect(onEchoesAddToContext).toHaveBeenCalledWith('/wk/notes/e.md')

    ;(root.querySelector('.context-open-btn') as HTMLButtonElement).click()
    expect(onContextOpen).toHaveBeenCalledWith('/wk/notes/c.md')

    ;(root.querySelector('.context-remove-btn') as HTMLButtonElement).click()
    expect(onContextRemove).toHaveBeenCalledWith('/wk/notes/c.md')

    const chipButtons = Array.from(root.querySelectorAll('.context-chip-btn')) as HTMLButtonElement[]
    chipButtons[0].click()
    chipButtons[1].click()
    expect(onContextPreserve).toHaveBeenCalledTimes(1)
    expect(onContextClear).toHaveBeenCalledTimes(1)

    const ctaButtons = Array.from(root.querySelectorAll('.context-primary-cta, .context-link-btn')) as HTMLButtonElement[]
    ctaButtons[0].click()
    ctaButtons[1].click()
    ctaButtons[2].click()
    expect(onContextOpenSecondBrain).toHaveBeenCalledTimes(1)
    expect(onContextOpenCosmos).toHaveBeenCalledTimes(1)
    expect(onContextOpenPulse).toHaveBeenCalledTimes(1)

    const toggles = Array.from(root.querySelectorAll('.section-toggle')) as HTMLButtonElement[]
    toggles[0].click()
    toggles[1].click()
    toggles[2].click()
    await nextTick()

    const outlineButton = Array.from(root.querySelectorAll('.pane-item')).find((item) =>
      item.textContent?.includes('Roadmap')
    ) as HTMLButtonElement | undefined
    expect(outlineButton).toBeTruthy()
    outlineButton?.click()
    expect(onOutlineClick).toHaveBeenCalledWith({ index: 0, heading: { level: 2, text: 'Roadmap' } })

    const backlinkButton = Array.from(root.querySelectorAll('.pane-item')).find((item) =>
      item.textContent?.includes('notes/a.md')
    ) as HTMLButtonElement | undefined
    backlinkButton?.click()
    expect(onBacklinkOpen).toHaveBeenCalledWith('/wk/notes/a.md')

    expect(root.querySelector('.right-pane')?.getAttribute('style')).toContain('width: 320px;')

    app.unmount()
    document.body.innerHTML = ''
  })

  it('renders an empty disabled context state', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorRightPane, {
          width: 280,
          activeNotePath: '/wk/notes/a.md',
          activeNoteTitle: 'A',
          activeStateLabel: 'saved',
          backlinkCount: 0,
          semanticLinkCount: 0,
          activeNoteInContext: true,
          canToggleFavorite: false,
          isFavorite: false,
          echoesItems: [],
          echoesLoading: false,
          echoesError: '',
          echoesHintVisible: false,
          contextMode: 'preserved',
          contextItems: [],
          canReasonOnContext: false,
          isLaunchingContextAction: false,
          outline: [],
          semanticLinks: [],
          semanticLinksLoading: false,
          backlinks: [],
          backlinksLoading: false,
          metadataRows: [],
          propertiesPreview: [],
          propertyParseErrorCount: 0,
          toRelativePath: (path: string) => path
        })
      }
    }))

    app.mount(root)
    expect(root.textContent).toContain('Preserved Context')
    expect(root.textContent).toContain('No notes added.')
    expect((root.querySelector('.context-primary-cta') as HTMLButtonElement).disabled).toBe(true)
    app.unmount()
  })
})
