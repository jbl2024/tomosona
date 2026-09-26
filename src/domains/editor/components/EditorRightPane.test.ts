import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorRightPane from './EditorRightPane.vue'

function mountPane(overrides = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const props = {
    width: 320,
    activeNotePath: '/wk/notes/a.md',
    activeNoteTitle: 'A',
    activeStateLabel: 'saved',
    activeNoteSourceToggleLabel: 'Edit raw text',
    canToggleFavorite: true,
    isFavorite: true,
    backlinkCount: 1,
    indexingState: 'indexed' as const,
    outline: [{ level: 2 as const, text: 'Roadmap' }],
    backlinks: ['/wk/notes/b.md'],
    backlinksLoading: false,
    backlinksError: '',
    metadataRows: [{ label: 'Path', value: 'notes/a.md' }],
    propertiesPreview: [{ key: 'tags', value: 'doc' }],
    propertyParseErrorCount: 0,
    toRelativePath: (path: string) => path.replace('/wk/', ''),
    onToggleFavorite: vi.fn(),
    onOpenNoteHistory: vi.fn(),
    onActiveNoteToggleSourceMode: vi.fn(),
    onOutlineClick: vi.fn(),
    onBacklinkOpen: vi.fn(),
    ...overrides
  }
  const app = createApp(() => h(EditorRightPane, props))
  app.mount(root)
  return { root, props, app }
}

describe('EditorRightPane', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('keeps note tools and navigation without Pulse actions or a drawer', async () => {
    const { root, props, app } = mountPane()
    expect(Array.from(root.querySelectorAll('.section-title'), el => el.textContent?.trim())).toEqual([
      'Active Note', 'Outline', 'Backlinks', 'Metadata', 'Properties'
    ])
    expect(root.textContent).not.toMatch(/Pulse|Transform with/)
    expect(root.querySelector('[class*="pulse"]')).toBeNull()
    expect(root.querySelector('.right-pane')?.getAttribute('style')).toContain('width: 320px;')

    ;(root.querySelector('.favorite-toggle-btn') as HTMLButtonElement).click()
    ;(root.querySelector('.history-toggle-btn') as HTMLButtonElement).click()
    ;(root.querySelector('.tertiary-note-btn') as HTMLButtonElement).click()
    expect(props.onToggleFavorite).toHaveBeenCalledOnce()
    expect(props.onOpenNoteHistory).toHaveBeenCalledOnce()
    expect(props.onActiveNoteToggleSourceMode).toHaveBeenCalledOnce()

    const toggles = root.querySelectorAll<HTMLButtonElement>('.section-toggle')
    toggles[1].click()
    toggles[2].click()
    await nextTick()
    const links = root.querySelectorAll<HTMLButtonElement>('.pane-item')
    links[0].click()
    links[1].click()
    expect(props.onOutlineClick).toHaveBeenCalledWith({ index: 0, heading: { level: 2, text: 'Roadmap' } })
    expect(props.onBacklinkOpen).toHaveBeenCalledWith('/wk/notes/b.md')

    toggles[0].click()
    await nextTick()
    expect(root.querySelector('.favorite-toggle-btn')).toBeNull()
    app.unmount()
  })

  it('disables note actions when no note is active', () => {
    const { root, app } = mountPane({ activeNotePath: '', canToggleFavorite: false })
    for (const button of root.querySelectorAll<HTMLButtonElement>('.pane-toolbar-actions button')) {
      expect(button.disabled).toBe(true)
    }
    app.unmount()
  })

  it('shows backlink failures instead of an empty state', async () => {
    const { root, app } = mountPane({ backlinks: [], backlinksError: 'Could not load backlinks.' })
    root.querySelectorAll<HTMLButtonElement>('.section-toggle')[2].click()
    await nextTick()
    expect(root.textContent).toContain('Could not load backlinks.')
    expect(root.textContent).not.toContain('No backlinks')
    app.unmount()
  })
})
