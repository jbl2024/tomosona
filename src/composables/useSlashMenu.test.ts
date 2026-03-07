import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { useSlashMenu } from './useSlashMenu'

function createEditor(selectionText = '/hea') {
  const editor = {
    state: {
      selection: {
        from: 5,
        empty: true,
        $from: {
          start: () => 1,
          end: () => 20,
          parent: {
            isTextblock: true,
            textContent: selectionText,
            type: { name: 'paragraph' }
          },
          parentOffset: selectionText.length
        }
      }
    },
    view: {
      coordsAtPos: () => ({ left: 120, bottom: 200 })
    }
  }
  return editor as unknown as Editor
}

describe('useSlashMenu', () => {
  it('filters commands by query and closes cleanly', () => {
    const closeCompetingMenus = vi.fn()
    const menu = useSlashMenu({
      getEditor: () => createEditor('/'),
      commands: computed(() => [
        { id: 'heading', label: 'Heading', type: 'header', data: {} },
        { id: 'quote', label: 'Quote', type: 'quote', data: {} }
      ]),
      closeCompetingMenus
    })

    menu.openSlashAtSelection('hea')
    expect(closeCompetingMenus).toHaveBeenCalledTimes(1)
    expect(menu.slashOpen.value).toBe(true)
    expect(menu.visibleSlashCommands.value).toHaveLength(1)
    expect(menu.visibleSlashCommands.value[0]?.id).toBe('heading')

    menu.closeSlashMenu()
    expect(menu.slashOpen.value).toBe(false)
    expect(menu.slashIndex.value).toBe(0)
  })

  it('syncs from selection only after user activation and preserves index', () => {
    const menu = useSlashMenu({
      getEditor: () => createEditor('/q'),
      commands: computed(() => [
        { id: 'quote', label: 'Quote', type: 'quote', data: {} },
        { id: 'code', label: 'Code', type: 'code', data: {} }
      ]),
      closeCompetingMenus: () => {}
    })

    menu.syncSlashMenuFromSelection()
    expect(menu.slashOpen.value).toBe(false)

    menu.markSlashActivatedByUser()
    menu.openSlashAtSelection('q')
    menu.slashIndex.value = 1

    menu.syncSlashMenuFromSelection({ preserveIndex: true })
    expect(menu.slashOpen.value).toBe(true)
    expect(menu.slashIndex.value).toBe(0)
  })

  it('dismisses slash activation after escape-style close', () => {
    const menu = useSlashMenu({
      getEditor: () => createEditor('/q'),
      commands: computed(() => [
        { id: 'quote', label: 'Quote', type: 'quote', data: {} }
      ]),
      closeCompetingMenus: () => {}
    })

    menu.markSlashActivatedByUser()
    menu.syncSlashMenuFromSelection()
    expect(menu.slashOpen.value).toBe(true)

    menu.dismissSlashMenu()
    expect(menu.slashOpen.value).toBe(false)
    expect(menu.slashActivatedByUser.value).toBe(false)

    menu.syncSlashMenuFromSelection()
    expect(menu.slashOpen.value).toBe(false)
  })

  it('returns the exact slash token range instead of the full paragraph', () => {
    const menu = useSlashMenu({
      getEditor: () => createEditor('/html'),
      commands: computed(() => []),
      closeCompetingMenus: () => {}
    })

    expect(menu.readSlashContext()).toEqual({
      query: 'html',
      from: 1,
      to: 6
    })
  })
})
