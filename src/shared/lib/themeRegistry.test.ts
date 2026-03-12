import { describe, expect, it } from 'vitest'
import {
  APP_THEMES,
  SYSTEM_DARK_THEME_ID,
  SYSTEM_LIGHT_THEME_ID,
  getAppThemeById,
  isThemeId
} from './themeRegistry'

describe('theme registry', () => {
  it('exposes named built-in themes for the theme controller', () => {
    expect(APP_THEMES.map((theme) => theme.id)).toEqual([
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
    expect(getAppThemeById(SYSTEM_LIGHT_THEME_ID).colorScheme).toBe('light')
    expect(getAppThemeById(SYSTEM_DARK_THEME_ID).colorScheme).toBe('dark')
  })

  it('recognizes only registered theme ids', () => {
    expect(isThemeId('tokyo-night')).toBe(true)
    expect(isThemeId('dark')).toBe(false)
    expect(isThemeId('')).toBe(false)
  })
})
