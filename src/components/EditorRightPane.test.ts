import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EditorRightPane from './EditorRightPane.vue'

describe('EditorRightPane', () => {
  it('renders Echoes first and forwards intents', () => {
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
          semanticLinks: [],
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
    const buttons = Array.from(root.querySelectorAll('.pane-item')) as HTMLButtonElement[]
    expect(buttons.length).toBe(3)

    buttons[0].click()
    expect(root.textContent).toContain('Relevant notes around what you\'re working on now.')

    buttons[1].click()
    expect(onOutlineClick).toHaveBeenCalledWith({ index: 0, heading: { level: 2, text: 'Roadmap' } })

    buttons[2].click()
    expect(onBacklinkOpen).toHaveBeenCalledWith('/wk/notes/a.md')

    expect(root.querySelector('.right-pane')?.getAttribute('style')).toContain('width: 320px;')

    app.unmount()
    document.body.innerHTML = ''
  })
})
