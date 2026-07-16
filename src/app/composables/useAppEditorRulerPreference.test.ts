import { beforeEach, describe, expect, it } from 'vitest'
import {
  EDITOR_RULER_VISIBLE_STORAGE_KEY,
  LEGACY_EDITOR_MINIMAP_VISIBLE_STORAGE_KEY,
  useAppEditorRulerPreference
} from './useAppEditorRulerPreference'

describe('useAppEditorRulerPreference', () => {
  beforeEach(() => window.localStorage.clear())

  it('defaults to visible and persists one global toggle', () => {
    const first = useAppEditorRulerPreference('test:ruler')
    first.loadEditorRulerPreference()
    expect(first.editorRulerVisible.value).toBe(true)
    expect(first.toggleEditorRulerVisible()).toBe(false)

    const next = useAppEditorRulerPreference('test:ruler')
    next.loadEditorRulerPreference()
    expect(next.editorRulerVisible.value).toBe(false)
  })

  it('migrates an explicit legacy minimap choice', () => {
    window.localStorage.setItem(LEGACY_EDITOR_MINIMAP_VISIBLE_STORAGE_KEY, '0')
    const preference = useAppEditorRulerPreference()
    preference.loadEditorRulerPreference()

    expect(preference.editorRulerVisible.value).toBe(false)
    expect(window.localStorage.getItem(EDITOR_RULER_VISIBLE_STORAGE_KEY)).toBe('0')
  })
})
