/**
 * Named application themes that can be resolved from a persisted preference.
 */
export type ThemeId =
  | 'tomosona-light'
  | 'tomosona-dark'
  | 'acier-sable-rose'
  | 'harbor-light'
  | 'midnight-rail'
  | 'github-light'
  | 'tokyo-night'
  | 'catppuccin-latte'
  | 'catppuccin-mocha'

export type ThemeColorScheme = 'light' | 'dark'

export type AppThemeGroup = 'official' | 'community'

export type AppThemeDefinition = {
  id: ThemeId
  label: string
  colorScheme: ThemeColorScheme
  group: AppThemeGroup
}

export const SYSTEM_LIGHT_THEME_ID: ThemeId = 'tomosona-light'
export const SYSTEM_DARK_THEME_ID: ThemeId = 'tomosona-dark'

/** Built-in named themes rendered by the shell theme picker and command palette. */
export const APP_THEMES: readonly AppThemeDefinition[] = [
  {
    id: 'tomosona-light',
    label: 'Tomosona Light',
    colorScheme: 'light',
    group: 'official'
  },
  {
    id: 'tomosona-dark',
    label: 'Tomosona Dark',
    colorScheme: 'dark',
    group: 'official'
  },
  {
    id: 'acier-sable-rose',
    label: 'Acier & Sable Rose',
    colorScheme: 'light',
    group: 'community'
  },
  {
    id: 'harbor-light',
    label: 'Harbor Light',
    colorScheme: 'light',
    group: 'community'
  },
  {
    id: 'midnight-rail',
    label: 'Midnight Rail',
    colorScheme: 'light',
    group: 'community'
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    colorScheme: 'light',
    group: 'community'
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    colorScheme: 'dark',
    group: 'community'
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    colorScheme: 'light',
    group: 'community'
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    colorScheme: 'dark',
    group: 'community'
  }
] as const

const THEME_ID_SET = new Set<string>(APP_THEMES.map((theme) => theme.id))

/** Returns true when the raw value matches a registered persisted theme id. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_ID_SET.has(value)
}

/** Resolves a registered theme definition by id, falling back to the official light theme. */
export function getAppThemeById(themeId: ThemeId): AppThemeDefinition {
  return APP_THEMES.find((theme) => theme.id === themeId) ?? APP_THEMES[0]
}
