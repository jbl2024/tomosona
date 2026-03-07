import { describe, expect, it } from 'vitest'
import { APP_THEMES, getAppThemeById } from './themeRegistry'

describe('theme registry', () => {
  it('exposes named built-in themes for the theme controller', () => {
    expect(APP_THEMES.map((theme) => theme.id)).toEqual(['light', 'dark'])
    expect(getAppThemeById('light').colorScheme).toBe('light')
    expect(getAppThemeById('dark').colorScheme).toBe('dark')
  })
})
