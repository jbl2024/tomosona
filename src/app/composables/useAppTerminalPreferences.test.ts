import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_PREFERENCES,
  useAppTerminalPreferences
} from './useAppTerminalPreferences'

describe('useAppTerminalPreferences', () => {
  afterEach(() => window.localStorage.clear())

  it('uses defaults and persists normalized preferences', () => {
    const preferences = useAppTerminalPreferences('test:terminal')

    expect(preferences.terminalPreferences.value).toEqual(DEFAULT_TERMINAL_PREFERENCES)

    preferences.setTerminalPreferences({ fontSize: 18, cursorStyle: 'bar' })
    expect(preferences.terminalPreferences.value.fontSize).toBe(18)
    expect(preferences.terminalPreferences.value.cursorStyle).toBe('bar')
    expect(JSON.parse(window.localStorage.getItem('test:terminal') ?? '{}')).toMatchObject({ fontSize: 18, cursorStyle: 'bar' })
  })

  it('rejects invalid persisted values and restores the defaults on reset', () => {
    window.localStorage.setItem('test:terminal', JSON.stringify({ fontSize: 300, lineHeight: 0, cursorStyle: 'invalid' }))
    const preferences = useAppTerminalPreferences('test:terminal')

    preferences.loadTerminalPreferences()
    expect(preferences.terminalPreferences.value.fontSize).toBe(32)
    expect(preferences.terminalPreferences.value.lineHeight).toBe(1)
    expect(preferences.terminalPreferences.value.cursorStyle).toBe('block')

    preferences.resetTerminalPreferences()
    expect(preferences.terminalPreferences.value).toEqual(DEFAULT_TERMINAL_PREFERENCES)
  })
})
