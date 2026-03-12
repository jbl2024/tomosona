import { beforeEach, describe, expect, it } from 'vitest'
import { useAppTheme } from './useAppTheme'

describe('useAppTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.colorScheme
    window.localStorage.clear()
  })

  it('loads and applies a persisted preference', () => {
    window.localStorage.setItem('tomosona.theme.preference', 'tokyo-night')
    const theme = useAppTheme()

    theme.loadThemePreference()
    theme.applyTheme()

    expect(theme.themePreference.value).toBe('tokyo-night')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('tokyo-night')
    expect(document.documentElement.dataset.colorScheme).toBe('dark')
  })

  it('respects system mode via injected matcher', () => {
    const theme = useAppTheme({ matchMedia: () => true })
    theme.loadThemePreference()
    theme.applyTheme()

    expect(theme.activeThemeId.value).toBe('tomosona-dark')
    expect(theme.activeColorScheme.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('tomosona-dark')
    expect(document.documentElement.dataset.colorScheme).toBe('dark')
  })

  it('persists explicit theme changes', () => {
    const theme = useAppTheme()
    theme.setThemePreference('github-light')

    expect(window.localStorage.getItem('tomosona.theme.preference')).toBe('github-light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('github-light')
    expect(document.documentElement.dataset.colorScheme).toBe('light')
  })

  it('falls back to system when the persisted preference is invalid', () => {
    window.localStorage.setItem('tomosona.theme.preference', 'midnight')
    const theme = useAppTheme()
    theme.loadThemePreference()

    expect(theme.themePreference.value).toBe('system')
  })

  it('migrates legacy light and dark preferences to named Tomosona themes', () => {
    window.localStorage.setItem('tomosona.theme.preference', 'dark')
    const theme = useAppTheme()
    theme.loadThemePreference()

    expect(theme.themePreference.value).toBe('tomosona-dark')
  })

  it('exposes named theme definitions for the theme picker', () => {
    const theme = useAppTheme()

    expect(theme.availableThemes.map((item) => item.id)).toEqual([
      'tomosona-light',
      'tomosona-dark',
      'acier-sable-rose',
      'harbor-light',
      'midnight-rail',
      'github-light',
      'tokyo-night',
      'catppuccin-latte',
      'catppuccin-mocha'
    ])
    expect(theme.activeTheme.value.colorScheme).toBe('light')
  })
})
