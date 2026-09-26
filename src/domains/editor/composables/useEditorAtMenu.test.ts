import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useEditorAtMenu } from './useEditorAtMenu'

function createEditor(text: string, nodeType = 'paragraph', marks: string[] = []) {
  const deleteRange = vi.fn().mockReturnThis()
  const insertContent = vi.fn().mockReturnThis()
  const run = vi.fn().mockReturnValue(true)
  const chain = {
    focus: vi.fn().mockReturnThis(),
    deleteRange,
    insertContent,
    run
  }

  const editor = {
    state: {
      selection: {
        empty: true,
        from: 12,
        to: 12,
        $from: {
          start: () => 1,
          end: () => text.length + 1,
          parentOffset: text.length,
          parent: {
            isTextblock: true,
            textContent: text,
            type: { name: nodeType }
          },
          marks: () => marks.map((name) => ({ type: { name } }))
        }
      }
    },
    view: {
      coordsAtPos: () => ({ left: 120, bottom: 200 })
    },
    chain: vi.fn(() => chain)
  } as unknown as Editor & { __test: { chain: typeof chain } }

  return { editor, chain }
}

describe('useEditorAtMenu', () => {
  it('detects @ trigger text and guards emails, code blocks, and inline code', () => {
    const menu = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => null,
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' }),
      now: () => new Date(2026, 3, 12, 14, 32)
    })

    const entries = menu.atEntries.value
    expect(entries.length).toBeGreaterThan(20)
    expect(entries[0]?.replacement).toBe('2026-04-12')

    const withEditor = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => ({ text: 'Send email@example.com', nodeType: 'paragraph', from: 1, to: 10, offset: 21 }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' })
    })
    expect(withEditor.readAtContext()).toBeNull()

    const inlineCode = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => ({ text: 'Hello @today', nodeType: 'paragraph', from: 1, to: 12, offset: 12, marks: ['code'] }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' })
    })
    expect(inlineCode.readAtContext()).toBeNull()

    const codeBlock = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => ({ text: '@today', nodeType: 'codeBlock', from: 1, to: 7, offset: 6 }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' })
    })
    expect(codeBlock.readAtContext()).toBeNull()
  })

  it('keeps the trigger open for valid paragraph text and inserts the selected macro', async () => {
    const { editor, chain } = createEditor('Draft @today')
    const menu = useEditorAtMenu({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({
        text: 'Draft @today',
        nodeType: 'paragraph',
        from: 1,
        to: 13,
        offset: 12,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Planning note', path: 'notes/planning.md' }),
      now: () => new Date(2026, 3, 12, 14, 32)
    })

    menu.markAtActivatedByUser()
    menu.syncAtMenuFromSelection()
    expect(menu.atOpen.value).toBe(true)
    expect(menu.visibleAtMacros.value.map((entry) => entry.id)).toContain('today')

    const applied = await menu.insertAtMacro(menu.visibleAtMacros.value.find((entry) => entry.id === 'today')!)
    expect(applied).toBe(true)
    expect(chain.focus).toHaveBeenCalled()
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 7, to: 13 })
    expect(chain.insertContent).toHaveBeenCalledWith('2026-04-12')
    expect(chain.run).toHaveBeenCalled()
    expect(menu.atOpen.value).toBe(false)
  })

  it('detects and replaces @ macros in headings', async () => {
    const { editor, chain } = createEditor('Plan @today', 'heading')
    const menu = useEditorAtMenu({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({
        text: 'Plan @today',
        nodeType: 'heading',
        from: 1,
        to: 12,
        offset: 11,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Planning note', path: 'notes/planning.md' }),
      now: () => new Date(2026, 3, 12, 14, 32)
    })

    menu.markAtActivatedByUser()
    menu.syncAtMenuFromSelection()
    expect(menu.atOpen.value).toBe(true)
    expect(menu.visibleAtMacros.value.map((entry) => entry.id)).toContain('today')

    const applied = await menu.insertAtMacro(menu.visibleAtMacros.value.find((entry) => entry.id === 'today')!)
    expect(applied).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 6, to: 12 })
    expect(chain.insertContent).toHaveBeenCalledWith('2026-04-12')
  })

  it('allows arguments only for macros that support them', () => {
    const dueMenu = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => ({
        text: 'Do @due tomorrow',
        nodeType: 'paragraph',
        from: 1,
        to: 17,
        offset: 16,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' }),
      now: () => new Date(2026, 3, 12, 14, 32)
    })
    expect(dueMenu.readAtContext()).toEqual({ start: 4, end: 17, query: 'due tomorrow' })

    const meetingMenu = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => ({
        text: 'Do @meeting note',
        nodeType: 'paragraph',
        from: 1,
        to: 17,
        offset: 16,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' })
    })
    expect(meetingMenu.readAtContext()).toBeNull()
  })

  it('inserts selected workspace template markdown', async () => {
    const { editor, chain } = createEditor('Draft @weekly')
    const menu = useEditorAtMenu({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({
        text: 'Draft @weekly',
        nodeType: 'paragraph',
        from: 1,
        to: 14,
        offset: 13,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({
        title: 'Planning note',
        path: 'notes/planning.md',
        templates: [
          {
            path: '/vault/_templates/weekly.md',
            label: 'weekly.md',
            relativePath: 'weekly.md',
            group: 'Workspace root'
          }
        ]
      }),
      readTemplateContent: vi.fn(async () => '### Weekly\n\n- [ ] Follow up')
    })

    const template = menu.visibleAtMacros.value.find((entry) => entry.templatePath)
    expect(template?.label).toBe('weekly.md')

    const applied = await menu.insertAtMacro(template!)
    expect(applied).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 7, to: 14 })
    expect(chain.insertContent).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ type: 'heading' })
    ]))
  })

  it('inserts @task as a Tiptap task list instead of plain markdown text', async () => {
    const { editor, chain } = createEditor('Draft @task')
    const menu = useEditorAtMenu({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({
        text: 'Draft @task',
        nodeType: 'paragraph',
        from: 1,
        to: 12,
        offset: 11,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Planning note', path: 'notes/planning.md' })
    })

    const applied = await menu.insertAtMacro(menu.atEntries.value.find((entry) => entry.id === 'task')!)
    expect(applied).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 7, to: 12 })
    expect(chain.insertContent).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'taskList',
        content: [
          expect.objectContaining({
            type: 'taskItem',
            attrs: { checked: false }
          })
        ]
      })
    ])
  })

  it('opens Pulse for AI macros after removing the trigger token', async () => {
    const { editor, chain } = createEditor('Draft @summarize')
    const openPulseMacro = vi.fn()
    const menu = useEditorAtMenu({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({
        text: 'Draft @summarize',
        nodeType: 'paragraph',
        from: 1,
        to: 17,
        offset: 16,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Planning note', path: 'notes/planning.md' }),
      openPulseMacro
    })

    const applied = await menu.insertAtMacro(menu.atEntries.value.find((entry) => entry.id === 'summarize')!)
    expect(applied).toBe(true)
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 7, to: 17 })
    expect(chain.insertContent).not.toHaveBeenCalled()
    expect(openPulseMacro).toHaveBeenCalledWith({
      actionId: 'synthesize',
      instruction: 'Summarize the provided material into a concise, useful synthesis.'
    })
  })

  it('stays open when a valid @ query has no matching macro', () => {
    const { editor } = createEditor('Draft @zzzz')
    const menu = useEditorAtMenu({
      getEditor: () => editor,
      currentTextSelectionContext: () => ({
        text: 'Draft @zzzz',
        nodeType: 'paragraph',
        from: 1,
        to: 12,
        offset: 11,
        marks: []
      }),
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Planning note', path: 'notes/planning.md' })
    })

    menu.markAtActivatedByUser()
    menu.syncAtMenuFromSelection()
    expect(menu.atOpen.value).toBe(true)
    expect(menu.visibleAtMacros.value).toEqual([])

    menu.setAtQuery('still-no-match')
    expect(menu.atOpen.value).toBe(true)
    expect(menu.visibleAtMacros.value).toEqual([])
  })

  it('closes when activation is lost or the trigger disappears', () => {
    const menu = useEditorAtMenu({
      getEditor: () => null,
      currentTextSelectionContext: () => null,
      closeCompetingMenus: vi.fn(),
      getDocumentMetadata: () => ({ title: 'Note', path: 'notes/note.md' })
    })

    menu.markAtActivatedByUser()
    menu.syncAtMenuFromSelection()
    expect(menu.atOpen.value).toBe(false)

    menu.dismissAtMenu()
    expect(menu.atActivatedByUser.value).toBe(false)
  })
})
