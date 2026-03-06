import { beforeEach, describe, expect, it } from 'vitest'
import { useAppTheme } from './useAppTheme'

describe('useAppTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
  })

  it('loads and applies a persisted preference', () => {
    window.localStorage.setItem('tomosona.theme.preference', 'dark')
    const theme = useAppTheme()

    theme.loadThemePreference()
    theme.applyTheme()

    expect(theme.themePreference.value).toBe('dark')
    expect(theme.resolvedTheme.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('respects system mode via injected matcher', () => {
    const theme = useAppTheme({ matchMedia: () => true })
    theme.loadThemePreference()
    theme.applyTheme()

    expect(theme.resolvedTheme.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('persists explicit theme changes', () => {
    const theme = useAppTheme()
    theme.setThemePreference('light')

    expect(window.localStorage.getItem('tomosona.theme.preference')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
