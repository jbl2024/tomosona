import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_EDITOR_PREFERENCES,
  useAppEditorPreferences
} from './useAppEditorPreferences'

describe('useAppEditorPreferences', () => {
  afterEach(() => window.localStorage.clear())

  it('uses defaults and persists normalized preferences', () => {
    const preferences = useAppEditorPreferences('test:editor')

    expect(preferences.editorPreferences.value).toEqual(DEFAULT_EDITOR_PREFERENCES)

    preferences.setEditorPreferences({ cursorStyle: 'underline', cursorBlink: false })
    expect(preferences.editorPreferences.value.cursorStyle).toBe('underline')
    expect(preferences.editorPreferences.value.cursorBlink).toBe(false)
    expect(JSON.parse(window.localStorage.getItem('test:editor') ?? '{}')).toMatchObject({ cursorStyle: 'underline', cursorBlink: false })
  })

  it('merges partial updates without losing untouched fields', () => {
    const preferences = useAppEditorPreferences('test:editor')
    preferences.setEditorPreferences({ cursorStyle: 'bar' })

    preferences.setEditorPreferences({ cursorBlink: false })
    expect(preferences.editorPreferences.value.cursorStyle).toBe('bar')
    expect(preferences.editorPreferences.value.cursorBlink).toBe(false)
  })

  it('rejects invalid persisted values and restores the defaults on reset', () => {
    window.localStorage.setItem('test:editor', JSON.stringify({ cursorStyle: 'invalid', cursorBlink: 'yes' }))
    const preferences = useAppEditorPreferences('test:editor')

    preferences.loadEditorPreferences()
    expect(preferences.editorPreferences.value.cursorStyle).toBe('block')
    expect(preferences.editorPreferences.value.cursorBlink).toBe(true)

    preferences.setEditorPreferences({ cursorStyle: 'bar', cursorBlink: false })
    preferences.resetEditorPreferences()
    expect(preferences.editorPreferences.value).toEqual(DEFAULT_EDITOR_PREFERENCES)
  })
})
