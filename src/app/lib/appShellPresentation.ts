import {
  SYSTEM_DARK_THEME_ID,
  SYSTEM_LIGHT_THEME_ID,
  type AppThemeDefinition,
  type ThemeColorScheme,
  type ThemeId
} from '../../shared/lib/themeRegistry'

/**
 * Module: appShellPresentation
 *
 * Purpose:
 * - Keep shell-level view derivations pure, small, and testable.
 * - Group formatting and row-building helpers used by `App.vue`.
 */

export type ThemePickerItem =
  | {
      kind: 'system'
      id: 'system'
      label: string
      meta: string
      previewThemeIds: ThemeId[]
    }
  | {
      kind: 'theme'
      id: ThemeId
      label: string
      meta: string
      colorScheme: AppThemeDefinition['colorScheme']
      group: AppThemeDefinition['group']
    }

export type ShortcutItem = {
  keys: string
  action: string
}

export type ShortcutSection = {
  title: string
  items: ShortcutItem[]
}

export type MetadataRow = {
  label: string
  value: string
}

export type ShellSurfaceType = 'document' | 'home' | 'cosmos' | 'second-brain-chat' | 'alters'

export type BuildMetadataRowsOptions = {
  activeFilePath: string
  activeStatus: {
    dirty: boolean
    saving: boolean
  }
  virtualDocExists: boolean
  activeTab: { type: ShellSurfaceType } | null
  activeFileMetadata: {
    created_at_ms: number | null
    updated_at_ms: number | null
  } | null
  workspacePath: string
  toRelativePath: (path: string) => string
  formatTimestamp: (value: number | null) => string
}

export type BuildShortcutSectionsOptions = {
  primaryModLabel: string
  backShortcutLabel: string
  forwardShortcutLabel: string
  homeShortcutLabel: string
  commandPaletteShortcutLabel: string
}

/** Formats a search hit score for display in the shell UI. */
export function formatSearchScore(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(3)
}

/** Returns the final path segment for a workspace path. */
export function basenameLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const last = normalized.split('/').filter(Boolean).pop()
  return last || path
}

/** Formats a relative-time label used by launchpad rows. */
export function formatRelativeTime(tsMs: number | null, prefix = ''): string {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs) || tsMs <= 0) {
    return prefix ? `${prefix} recently` : 'recently'
  }
  const deltaMs = tsMs - Date.now()
  const absMs = Math.abs(deltaMs)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['week', 7 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ]
  for (const [unit, size] of units) {
    if (absMs >= size || unit === 'minute') {
      const value = Math.round(deltaMs / size)
      const label = rtf.format(value, unit)
      return prefix ? `${prefix} ${label}` : label
    }
  }
  return prefix ? `${prefix} just now` : 'just now'
}

/** Builds the human-readable label for the system theme entry. */
export function buildSystemThemeLabel(activeColorScheme: ThemeColorScheme): string {
  return activeColorScheme === 'dark' ? 'System (Tomosona Dark)' : 'System (Tomosona Light)'
}

/** Builds the theme picker rows shown by the shell modal. */
export function buildThemePickerItems(
  availableThemes: readonly AppThemeDefinition[],
  activeColorScheme: ThemeColorScheme
): ThemePickerItem[] {
  return [
    {
      kind: 'system',
      id: 'system',
      label: 'System',
      meta: buildSystemThemeLabel(activeColorScheme),
      previewThemeIds: [SYSTEM_LIGHT_THEME_ID, SYSTEM_DARK_THEME_ID]
    },
    ...availableThemes.map((theme) => ({
      kind: 'theme' as const,
      id: theme.id,
      label: theme.label,
      meta: `${theme.group === 'official' ? 'Official' : 'Included'} • ${theme.colorScheme === 'dark' ? 'Dark' : 'Light'}`,
      colorScheme: theme.colorScheme,
      group: theme.group
    }))
  ]
}

/** Builds the shell shortcut sections for the shortcuts modal. */
export function buildShortcutSections(options: BuildShortcutSectionsOptions): ShortcutSection[] {
  const mod = options.primaryModLabel
  return [
    {
      title: 'General',
      items: [
        { keys: `${mod}+P`, action: 'Quick open' },
        { keys: options.commandPaletteShortcutLabel, action: 'Command palette' },
        { keys: `${mod}+S`, action: 'Save note' },
        { keys: `${mod}+W`, action: 'Close current tab' },
        { keys: `${mod}+Tab`, action: 'Next tab' },
        { keys: `${mod}+Shift+F`, action: 'Search panel' }
      ]
    },
    {
      title: 'Navigation',
      items: [
        { keys: options.backShortcutLabel, action: 'Back in history' },
        { keys: options.forwardShortcutLabel, action: 'Forward in history' },
        { keys: `${mod}+D`, action: 'Open today note' },
        { keys: options.homeShortcutLabel, action: 'Open Home' },
        { keys: `${mod}+Click`, action: 'Open date token (YYYY-MM-DD) in editor' },
        { keys: `${mod}+E`, action: 'Show explorer' },
        { keys: `${mod}+B`, action: 'Toggle sidebar' },
        { keys: `${mod}+J`, action: 'Toggle right pane' }
      ]
    },
    {
      title: 'Multi-pane',
      items: [
        { keys: `${mod}+\\\\`, action: 'Split pane right' },
        { keys: `${mod}+Shift+\\\\`, action: 'Split pane down' },
        { keys: `${mod}+1..4`, action: 'Focus pane 1..4' },
        { keys: 'Alt+Shift+ArrowLeft/Right', action: 'Move active tab between panes' },
        { keys: 'Palette', action: 'Join panes' }
      ]
    },
    {
      title: 'Editor Zoom',
      items: [
        { keys: `${mod}++`, action: 'Zoom in' },
        { keys: `${mod}+-`, action: 'Zoom out' },
        { keys: `${mod}+0`, action: 'Reset zoom' }
      ]
    }
  ]
}

/** Builds the metadata rows shown in the right pane. */
export function buildMetadataRows(options: BuildMetadataRowsOptions): MetadataRow[] {
  if (!options.activeFilePath) {
    const activeTab = options.activeTab
    if (!activeTab || activeTab.type === 'document') return []
    const label = activeTab.type === 'home'
      ? 'Home'
      : activeTab.type === 'cosmos'
        ? 'Cosmos'
        : activeTab.type === 'second-brain-chat'
          ? 'Second Brain'
          : 'Surface'
    return [
      { label: 'Surface', value: label },
      { label: 'Metadata', value: 'No document metadata for this surface' }
    ]
  }

  const state = options.activeStatus.saving
    ? 'saving'
    : options.virtualDocExists
      ? 'unsaved'
      : options.activeStatus.dirty
        ? 'editing'
        : 'saved'

  return [
    { label: 'Path', value: options.toRelativePath(options.activeFilePath) },
    { label: 'State', value: state },
    { label: 'Workspace', value: options.toRelativePath(options.workspacePath) || options.workspacePath },
    { label: 'Created', value: options.formatTimestamp(options.activeFileMetadata?.created_at_ms ?? null) },
    { label: 'Updated', value: options.formatTimestamp(options.activeFileMetadata?.updated_at_ms ?? null) }
  ]
}
