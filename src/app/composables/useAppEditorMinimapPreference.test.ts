import { beforeEach, describe, expect, it } from 'vitest'
import { useAppEditorMinimapPreference } from './useAppEditorMinimapPreference'

describe('useAppEditorMinimapPreference', () => {
  beforeEach(() => window.localStorage.clear())

  it('defaults to hidden and persists one global toggle', () => {
    const first = useAppEditorMinimapPreference('test:minimap')
    first.loadEditorMinimapPreference()
    expect(first.editorMinimapVisible.value).toBe(false)
    expect(first.toggleEditorMinimapVisible()).toBe(true)

    const next = useAppEditorMinimapPreference('test:minimap')
    next.loadEditorMinimapPreference()
    expect(next.editorMinimapVisible.value).toBe(true)
  })
})
