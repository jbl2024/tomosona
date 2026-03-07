import { describe, expect, it, beforeEach } from 'vitest'
import { useEchoesDiscoverability } from './useEchoesDiscoverability'

describe('useEchoesDiscoverability', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows hint when count is below threshold', () => {
    const state = useEchoesDiscoverability()
    expect(state.hintVisible.value).toBe(true)
  })

  it('hides hint after threshold is reached', () => {
    window.localStorage.setItem('tomosona:echoes:hint:seen-count', '3')
    const state = useEchoesDiscoverability()
    expect(state.hintVisible.value).toBe(false)
  })

  it('increments only until the threshold', () => {
    const state = useEchoesDiscoverability()
    state.markPackShown()
    state.markPackShown()
    state.markPackShown()
    state.markPackShown()
    expect(window.localStorage.getItem('tomosona:echoes:hint:seen-count')).toBe('3')
    expect(state.hintVisible.value).toBe(false)
  })
})
