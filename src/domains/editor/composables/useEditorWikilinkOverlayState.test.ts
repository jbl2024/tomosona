import { ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorWikilinkOverlayState } from './useEditorWikilinkOverlayState'

const getWikilinkPluginStateMock = vi.fn()
const parseWikilinkTokenMock = vi.fn()

vi.mock('../lib/tiptap/plugins/wikilinkState', async () => {
  const mod = await vi.importActual('../lib/tiptap/plugins/wikilinkState')
  return {
    ...mod,
    getWikilinkPluginState: (...args: unknown[]) => getWikilinkPluginStateMock(...args)
  }
})

vi.mock('../lib/tiptap/extensions/wikilinkCommands', async () => {
  const mod = await vi.importActual('../lib/tiptap/extensions/wikilinkCommands')
  return {
    ...mod,
    parseWikilinkToken: (...args: unknown[]) => parseWikilinkTokenMock(...args)
  }
})

function createEditor() {
  const dispatch = vi.fn()
  const tr = {
    setMeta: vi.fn(() => tr),
    insertText: vi.fn(() => tr),
    setSelection: vi.fn(() => tr),
    replaceWith: vi.fn(() => tr),
    doc: { content: { size: 200 } }
  }
  const editor = {
    state: {
      selection: { from: 30, to: 30 },
      tr,
      doc: {
        textBetween: vi.fn(() => '[[a]]'),
        content: { size: 200 }
      },
      schema: {
        nodes: {
          wikilink: {
            create: vi.fn(() => ({ nodeSize: 4 }))
          }
        }
      }
    },
    view: {
      dispatch,
      coordsAtPos: vi.fn(() => ({ left: 100, bottom: 120 }))
    }
  }
  return { editor, dispatch, tr }
}

describe('useEditorWikilinkOverlayState', () => {
  beforeEach(() => {
    getWikilinkPluginStateMock.mockReset()
    parseWikilinkTokenMock.mockReset()
  })

  it('opens and maps plugin editing candidates', () => {
    const { editor } = createEditor()
    const closeBlockMenu = vi.fn()
    getWikilinkPluginStateMock.mockReturnValue({
      open: true,
      mode: 'editing',
      editingRange: { from: 20, to: 40 },
      selectedIndex: 1,
      candidates: [{ target: 'foo', label: 'Foo', isCreate: false }]
    })

    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(true),
      isDragMenuOpen: () => false,
      closeBlockMenu
    })

    wikilink.syncWikilinkUiFromPluginState()

    expect(wikilink.wikilinkOpen.value).toBe(true)
    expect(wikilink.wikilinkIndex.value).toBe(1)
    expect(wikilink.wikilinkResults.value).toEqual([{ id: 'existing:foo', label: 'Foo', target: 'foo', isCreate: false }])
    expect(closeBlockMenu).toHaveBeenCalled()
  })

  it('syncs overlay index back to plugin state', () => {
    const { editor, dispatch } = createEditor()
    getWikilinkPluginStateMock.mockReturnValue({ open: false, mode: 'idle' })
    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.onWikilinkMenuIndexUpdate(2)

    expect(wikilink.wikilinkIndex.value).toBe(2)
    expect(dispatch).toHaveBeenCalled()
    expect((editor.state.tr.setMeta as any).mock.calls.at(-1)?.[1]).toEqual({ type: 'setSelectedIndex', index: 2 })
  })

  it('closes menu when editor is unavailable', () => {
    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => null,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.wikilinkOpen.value = true
    wikilink.wikilinkResults.value = [{ id: 'x', label: 'X', target: 'x', isCreate: false }]
    wikilink.syncWikilinkUiFromPluginState()

    expect(wikilink.wikilinkOpen.value).toBe(false)
    expect(wikilink.wikilinkResults.value).toEqual([])
  })

  it('preserves alias when selecting a candidate and annotates create label', () => {
    const selectionSpy = vi.spyOn(TextSelection, 'create').mockReturnValue({} as any)
    const { editor, tr } = createEditor()
    ;(editor.state.doc.textBetween as any).mockReturnValue('[[Another.md|alias]]')
    getWikilinkPluginStateMock.mockReturnValue({
      open: true,
      mode: 'editing',
      editingRange: { from: 20, to: 40 },
      selectedIndex: 0,
      candidates: [{ target: 'Another.md', label: 'Create "Another.md"', isCreate: true }]
    })

    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.syncWikilinkUiFromPluginState()
    expect(wikilink.wikilinkResults.value).toEqual([
      {
        id: 'create:Another.md',
        label: 'Create "Another.md" as "alias"',
        target: 'Another.md',
        isCreate: true
      }
    ])

    wikilink.onWikilinkMenuSelect('Another.md')
    expect((tr.insertText as any).mock.calls.at(-1)).toEqual(['[[Another.md|alias]]', 20, 40])
    selectionSpy.mockRestore()
  })

  it('commits wikilink node when leaving editing range even if dropdown is closed', () => {
    const selectionSpy = vi.spyOn(TextSelection, 'create').mockReturnValue({} as any)
    const { editor, tr, dispatch } = createEditor()
    ;(editor.state.selection as any) = { from: 45, to: 45 }
    parseWikilinkTokenMock.mockReturnValue({ target: 'GLPI.md', label: null })
    getWikilinkPluginStateMock.mockReturnValue({
      open: false,
      mode: 'editing',
      editingRange: { from: 20, to: 40 },
      selectedIndex: 0,
      candidates: []
    })

    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.syncWikilinkUiFromPluginState()

    expect((tr.replaceWith as any).mock.calls.length).toBeGreaterThan(0)
    expect(dispatch).toHaveBeenCalled()
    selectionSpy.mockRestore()
  })

  it('auto-adds alias when selecting deep path candidate', () => {
    const selectionSpy = vi.spyOn(TextSelection, 'create').mockReturnValue({} as any)
    const { editor, tr } = createEditor()
    ;(editor.state.doc.textBetween as any).mockReturnValue('[[directory/foo')
    getWikilinkPluginStateMock.mockReturnValue({
      open: true,
      mode: 'editing',
      editingRange: { from: 20, to: 40 },
      selectedIndex: 0,
      candidates: [{ target: 'directory/foo.md', label: 'foo.md', exists: true }]
    })

    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.syncWikilinkUiFromPluginState()
    wikilink.onWikilinkMenuSelect('directory/foo.md')
    expect((tr.insertText as any).mock.calls.at(-1)).toEqual(['[[directory/foo.md|foo]]', 20, 40])
    selectionSpy.mockRestore()
  })

  it('does not add alias for root-level path candidate', () => {
    const selectionSpy = vi.spyOn(TextSelection, 'create').mockReturnValue({} as any)
    const { editor, tr } = createEditor()
    ;(editor.state.doc.textBetween as any).mockReturnValue('[[foo')
    getWikilinkPluginStateMock.mockReturnValue({
      open: true,
      mode: 'editing',
      editingRange: { from: 20, to: 40 },
      selectedIndex: 0,
      candidates: [{ target: 'foo.md', label: 'foo.md', exists: true }]
    })

    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.syncWikilinkUiFromPluginState()
    wikilink.onWikilinkMenuSelect('foo.md')
    expect((tr.insertText as any).mock.calls.at(-1)).toEqual(['[[foo.md]]', 20, 40])
    selectionSpy.mockRestore()
  })

  it('auto-adds alias when creating new deep path', () => {
    const selectionSpy = vi.spyOn(TextSelection, 'create').mockReturnValue({} as any)
    const { editor, tr } = createEditor()
    ;(editor.state.doc.textBetween as any).mockReturnValue('[[sub/note')
    getWikilinkPluginStateMock.mockReturnValue({
      open: true,
      mode: 'editing',
      editingRange: { from: 20, to: 40 },
      selectedIndex: 0,
      candidates: [{ target: 'sub/note.md', label: 'Create "sub/note.md"', exists: false, isCreate: true }]
    })

    const wikilink = useEditorWikilinkOverlayState({
      getEditor: () => editor as any,
      holder: ref(document.createElement('div')),
      blockMenuOpen: ref(false),
      isDragMenuOpen: () => false,
      closeBlockMenu: () => {}
    })

    wikilink.syncWikilinkUiFromPluginState()
    wikilink.onWikilinkMenuSelect('sub/note.md')
    expect((tr.insertText as any).mock.calls.at(-1)).toEqual(['[[sub/note.md|note]]', 20, 40])
    selectionSpy.mockRestore()
  })
})
