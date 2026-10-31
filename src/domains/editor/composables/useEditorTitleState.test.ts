import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useEditorTitleState } from './useEditorTitleState'

describe('useEditorTitleState', () => {
  it('tracks current and committed title by path', () => {
    const path = ref('a.md')
    const state = useEditorTitleState(path)

    state.syncLoadedTitle('a.md', 'Alpha')
    expect(state.currentTitle.value).toBe('Alpha')
    expect(state.isCurrentTitleDirty.value).toBe(false)

    state.setCurrentTitle('a.md', 'Alpha 2')
    expect(state.currentTitle.value).toBe('Alpha 2')
    expect(state.isCurrentTitleDirty.value).toBe(true)

    state.commitTitle('a.md')
    expect(state.currentTitle.value).toBe('Alpha 2')
    expect(state.isCurrentTitleDirty.value).toBe(false)
  })

  it('moves path state on rename', () => {
    const path = ref('a.md')
    const state = useEditorTitleState(path)
    state.syncLoadedTitle('a.md', 'Alpha')
    state.movePathState('a.md', 'b.md')

    expect(state.titleByPath.value['a.md']).toBeUndefined()
    expect(state.titleByPath.value['b.md']).toBe('Alpha')
  })

  it('tracks hidden heading state by path and moves it on rename', () => {
    const path = ref('a.md')
    const state = useEditorTitleState(path)

    state.setHiddenHeading('a.md', 'Alpha')
    expect(state.getHiddenHeading('a.md')).toBe('Alpha')
    expect(state.getHiddenHeading('other.md')).toBeNull()

    state.movePathState('a.md', 'b.md')
    expect(state.getHiddenHeading('a.md')).toBeNull()
    expect(state.getHiddenHeading('b.md')).toBe('Alpha')
    expect(state.hiddenHeadingByPath.value).toEqual({ 'b.md': 'Alpha' })
  })

  it('clears hidden heading state on reset and per-path cleanup', () => {
    const path = ref('a.md')
    const state = useEditorTitleState(path)

    state.setHiddenHeading('a.md', 'Alpha')
    state.setHiddenHeading('c.md', 'Gamma')
    state.clearHiddenHeading('a.md')
    expect(state.getHiddenHeading('a.md')).toBeNull()
    expect(state.getHiddenHeading('c.md')).toBe('Gamma')

    state.resetTitleState('c.md')
    expect(state.getHiddenHeading('c.md')).toBeNull()

    state.setHiddenHeading('a.md', 'Alpha')
    state.resetTitleState()
    expect(state.hiddenHeadingByPath.value).toEqual({})
  })
})
