import { beforeEach, describe, expect, it } from 'vitest'
import { useAppTheme } from './useAppTheme'

describe('useAppTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
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
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('respects system mode via injected matcher', () => {
    const theme = useAppTheme({ matchMedia: () => true })
    theme.loadThemePreference()
    theme.applyTheme()

    expect(theme.resolvedTheme.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(theme.activeThemeId.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists explicit theme changes', () => {
    const theme = useAppTheme()
    theme.setThemePreference('light')

    expect(window.localStorage.getItem('tomosona.theme.preference')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('exposes named theme definitions for future custom themes', () => {
    const theme = useAppTheme()

    expect(theme.availableThemes.map((item) => item.id)).toEqual(['light', 'dark'])
    expect(theme.activeTheme.value.colorScheme).toBe('light')
  })
})
