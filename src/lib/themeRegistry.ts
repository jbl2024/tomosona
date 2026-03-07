/**
 * Named application themes that can be resolved from a persisted preference.
 */
export type ThemeId = 'light' | 'dark'

export type AppThemeDefinition = {
  id: ThemeId
  label: string
  colorScheme: 'light' | 'dark'
}

/** Built-in named themes that can be selected directly or resolved from `system`. */
export const APP_THEMES: readonly AppThemeDefinition[] = [
  {
    id: 'light',
    label: 'Light',
    colorScheme: 'light'
  },
  {
    id: 'dark',
    label: 'Dark',
    colorScheme: 'dark'
  }
] as const

/** Resolves a registered theme definition by id, falling back to the default light theme. */
export function getAppThemeById(themeId: ThemeId): AppThemeDefinition {
  return APP_THEMES.find((theme) => theme.id === themeId) ?? APP_THEMES[0]
}
