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

  it('shows contextual previews and keeps note navigation available', () => {
    const { root, props, app } = mountPane()
    expect(Array.from(root.querySelectorAll('.section-title'), el => el.textContent?.trim())).toEqual(['Outline', 'Backlinks', 'Details'])
    expect(root.textContent).toContain('notes/a.md')
    expect(root.textContent).toContain('Roadmap')
    expect(root.textContent).toContain('notes/b.md')
    expect(root.textContent).toContain('tags')
    expect(root.querySelector('.right-pane')?.getAttribute('style')).toContain('width: 320px;')
    ;(root.querySelector('.favorite-toggle-btn') as HTMLButtonElement).click()
    ;(root.querySelector('.history-toggle-btn') as HTMLButtonElement).click()
    ;(root.querySelector('.tertiary-note-btn') as HTMLButtonElement).click()
    ;(root.querySelector('.outline-row') as HTMLButtonElement).click()
    ;(root.querySelector('.backlink-row') as HTMLButtonElement).click()
    expect(props.onToggleFavorite).toHaveBeenCalledOnce()
    expect(props.onOpenNoteHistory).toHaveBeenCalledOnce()
    expect(props.onActiveNoteToggleSourceMode).toHaveBeenCalledOnce()
    expect(props.onOutlineClick).toHaveBeenCalledWith({ index: 0, heading: { level: 2, text: 'Roadmap' } })
    expect(props.onBacklinkOpen).toHaveBeenCalledWith('/wk/notes/b.md')
    app.unmount()
  })

  it('expands long previews and details', async () => {
    const { root, app } = mountPane({
      outline: Array.from({ length: 5 }, (_, i) => ({ level: 1, text: `Heading ${i}` })),
      backlinks: Array.from({ length: 5 }, (_, i) => `/wk/${i}.md`),
      propertiesPreview: [{ key: 'one', value: '1' }, { key: 'two', value: '2' }, { key: 'three', value: '3' }]
    })
    expect(root.textContent).not.toContain('Heading 4')
    expect(root.textContent).not.toContain('4.md')
    expect(root.textContent).not.toContain('three')
    for (const button of root.querySelectorAll<HTMLButtonElement>('.more-button')) button.click()
    await nextTick()
    expect(root.textContent).toContain('Heading 4')
    expect(root.textContent).toContain('4.md')
    expect(root.textContent).toContain('three')
    expect(root.textContent).toContain('Path')
    app.unmount()
  })

  it('only shows the state badge when the note needs attention', () => {
    const saved = mountPane({ pageProtected: true })
    expect(saved.root.querySelector('.note-status')?.textContent).not.toContain('saved')
    expect(saved.root.querySelector('.note-status')?.textContent).toContain('Protected')
    saved.app.unmount()
    const editing = mountPane({ activeStateLabel: 'editing' })
    expect(editing.root.querySelector('.note-status')?.textContent).toContain('editing')
    editing.app.unmount()
  })

  it('hides an empty outline and surfaces property errors', () => {
    const { root, app } = mountPane({ outline: [], propertyParseErrorCount: 2 })
    expect(root.textContent).not.toContain('Outline')
    expect(root.textContent).toContain('2 parse errors')
    expect(root.textContent).not.toContain('tags')
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
    expect(root.textContent).toContain('Could not load backlinks.')
    expect(root.textContent).not.toContain('No backlinks')
    app.unmount()
  })

  it('exposes protection actions appropriate to the page state', () => {
    const action = vi.fn()
    const plain = mountPane({ canProtectPage: true, pageProtected: false, onPageProtectionAction: action })
    const click = (root: HTMLElement, label: string) => {
      const button = Array.from(root.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)
      expect(button).toBeTruthy()
      expect(button!.classList.contains('utility-note-btn')).toBe(true)
      expect(button!.querySelector('svg')).toBeTruthy()
      button!.click()
    }
    click(plain.root, 'Protect')
    expect(action).toHaveBeenCalledWith('protect')
    plain.app.unmount()
    const protectedPage = mountPane({ canProtectPage: true, pageProtected: true, pageLocked: false, onPageProtectionAction: action })
    click(protectedPage.root, 'Remove protection')
    click(protectedPage.root, 'Change password')
    click(protectedPage.root, 'Lock page')
    expect(action.mock.calls.map(([value]) => value)).toEqual(['protect', 'unprotect', 'change', 'lock'])
    protectedPage.app.unmount()
  })
})
