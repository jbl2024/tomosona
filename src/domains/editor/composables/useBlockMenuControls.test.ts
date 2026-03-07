import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { BlockMenuTarget } from '../lib/tiptap/blockMenu/types'
import { useBlockMenuControls } from './useBlockMenuControls'

describe('useBlockMenuControls', () => {
  it('builds base and convert action lists from active target', () => {
    const activeTarget = ref<BlockMenuTarget | null>(null)
    const stableTarget = ref<BlockMenuTarget | null>(null)
    const controls = useBlockMenuControls({
      getEditor: () => null,
      turnIntoTypes: ['paragraph', 'heading1', 'quote'],
      turnIntoLabels: {
        paragraph: 'Paragraph',
        heading1: 'Heading 1',
        quote: 'Quote'
      } as never,
      activeTarget,
      stableTarget
    })

    stableTarget.value = {
      pos: 5,
      nodeSize: 2,
      nodeType: 'paragraph',
      text: 'Hello',
      isVirtualTitle: false,
      canDelete: true,
      canConvert: true
    }

    expect(controls.actions.value.some((item) => item.id === 'delete' && item.disabled === false)).toBe(true)
    expect(controls.actions.value.some((item) => item.id === 'move_up' && item.disabled === true)).toBe(true)
    expect(controls.convertActions.value).toHaveLength(3)
    expect(controls.convertActions.value.some((item) => item.id === 'turn_into:quote' && item.label === 'Quote')).toBe(true)
  })
})
