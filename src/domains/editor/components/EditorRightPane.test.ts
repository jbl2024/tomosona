import { createApp, defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorRightPane from './EditorRightPane.vue'

describe('EditorRightPane', () => {
  it('renders Echoes first and forwards intents', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const onOutlineClick = vi.fn()
    const onBacklinkOpen = vi.fn()

    const app = createApp(defineComponent({
      setup() {
        return () => h(EditorRightPane, {
          width: 320,
          echoesItems: [{
            path: '/wk/notes/e.md',
            title: 'Echo',
            reasonLabel: 'Direct link',
            reasonLabels: ['Direct link'],
            score: 1,
            signalSources: ['direct']
          }],
          echoesLoading: false,
          echoesError: '',
          echoesHintVisible: true,
          outline: [{ level: 2, text: 'Roadmap' }],
          semanticLinks: [{ path: '/wk/notes/s.md', score: 0.88, direction: 'outgoing' }],
          semanticLinksLoading: false,
          backlinks: ['/wk/notes/a.md'],
          backlinksLoading: false,
          metadataRows: [{ label: 'Path', value: 'notes/a.md' }],
          propertiesPreview: [{ key: 'tags', value: 'doc' }],
          propertyParseErrorCount: 0,
          toRelativePath: (path: string) => path.replace('/wk/', ''),
          onOutlineClick,
          onBacklinkOpen
        })
      }
    }))

    app.mount(root)
    const sectionTitles = Array.from(root.querySelectorAll('.section-title')).map((el) => el.textContent?.trim())
    expect(sectionTitles[0]).toBe('Echoes')
    expect(root.querySelectorAll('.section-toggle')).toHaveLength(3)
    expect(root.querySelectorAll('.section-toggle-chevron')).toHaveLength(3)
    expect(root.textContent).not.toContain('0.88')
    expect(root.querySelectorAll('.echoes-item')).toHaveLength(1)
    const buttons = Array.from(root.querySelectorAll('.pane-item')) as HTMLButtonElement[]
    expect(buttons.length).toBe(0)

    ;(root.querySelector('.echoes-item') as HTMLButtonElement).click()
    expect(root.textContent).toContain('Relevant notes around what you\'re working on now.')

    const toggles = Array.from(root.querySelectorAll('.section-toggle')) as HTMLButtonElement[]
    toggles[0].click()
    await nextTick()
    const outlineButton = Array.from(root.querySelectorAll('.pane-item')).find((item) =>
      item.textContent?.includes('Roadmap')
    ) as HTMLButtonElement | undefined
    expect(outlineButton).toBeTruthy()
    if (!outlineButton) return
    outlineButton.click()
    expect(onOutlineClick).toHaveBeenCalledWith({ index: 0, heading: { level: 2, text: 'Roadmap' } })

    toggles[1].click()
    toggles[2].click()
    await nextTick()
    const expandedItems = Array.from(root.querySelectorAll('.pane-item')) as HTMLButtonElement[]
    const backlinkButton = expandedItems[expandedItems.length - 1]
    expect(backlinkButton?.textContent).toContain('notes/a.md')
    if (!backlinkButton) return
    backlinkButton.click()
    expect(onBacklinkOpen).toHaveBeenCalledWith('/wk/notes/a.md')

    expect(root.querySelector('.right-pane')?.getAttribute('style')).toContain('width: 320px;')

    app.unmount()
    document.body.innerHTML = ''
  })
})
