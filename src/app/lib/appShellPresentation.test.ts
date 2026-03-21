import { describe, expect, it } from 'vitest'
import { APP_THEMES, SYSTEM_DARK_THEME_ID, SYSTEM_LIGHT_THEME_ID } from '../../shared/lib/themeRegistry'
import {
  basenameLabel,
  buildMetadataRows,
  buildShortcutSections,
  buildSystemThemeLabel,
  buildThemePickerItems,
  formatRelativeTime,
  formatSearchScore
} from './appShellPresentation'

describe('appShellPresentation', () => {
  it('formats labels and scores deterministically', () => {
    expect(basenameLabel('/vault/notes/alpha.md')).toBe('alpha.md')
    expect(formatSearchScore(1.23456)).toBe('1.235')
    expect(formatSearchScore(Number.NaN)).toBe('--')
  })

  it('builds theme picker items with the system row first', () => {
    const items = buildThemePickerItems(APP_THEMES, 'dark')

    expect(items[0]).toEqual({
      kind: 'system',
      id: 'system',
      label: 'System',
      meta: 'System (Tomosona Dark)',
      previewThemeIds: [SYSTEM_LIGHT_THEME_ID, SYSTEM_DARK_THEME_ID]
    })
    expect(buildSystemThemeLabel('light')).toBe('System (Tomosona Light)')
  })

  it('builds shell shortcut sections with the expected navigation rows', () => {
    const sections = buildShortcutSections({
      primaryModLabel: 'Cmd',
      backShortcutLabel: 'Cmd+[',
      forwardShortcutLabel: 'Cmd+]',
      homeShortcutLabel: 'Cmd+Shift+H',
      commandPaletteShortcutLabel: 'Cmd+Shift+P'
    })

    expect(sections[0].items.map((item) => item.action)).toContain('Command palette')
    expect(sections[1].items.map((item) => item.keys)).toContain('Cmd+[')
    expect(sections[2].items.map((item) => item.action)).toContain('Join panes')
  })

  it('builds metadata rows for both notes and pane-only surfaces', () => {
    const noteRows = buildMetadataRows({
      activeFilePath: '/vault/notes/a.md',
      activeStatus: { dirty: true, saving: false },
      virtualDocExists: false,
      activeTab: null,
      activeFileMetadata: {
        created_at_ms: 1700000000000,
        updated_at_ms: 1700001000000
      },
      workspacePath: '/vault',
      toRelativePath: (path) => path.replace('/vault/', ''),
      formatTimestamp: (value) => (value == null ? '-' : String(value))
    })

    expect(noteRows[0]).toEqual({ label: 'Path', value: 'notes/a.md' })
    expect(noteRows[1]).toEqual({ label: 'State', value: 'editing' })

    const surfaceRows = buildMetadataRows({
      activeFilePath: '',
      activeStatus: { dirty: false, saving: false },
      virtualDocExists: false,
      activeTab: { type: 'cosmos' },
      activeFileMetadata: null,
      workspacePath: '/vault',
      toRelativePath: (path) => path.replace('/vault/', ''),
      formatTimestamp: (value) => (value == null ? '-' : String(value))
    })

    expect(surfaceRows).toEqual([
      { label: 'Surface', value: 'Cosmos' },
      { label: 'Metadata', value: 'No document metadata for this surface' }
    ])
  })

  it('formats relative times using the same shell wording', () => {
    expect(formatRelativeTime(null)).toBe('recently')
    expect(formatRelativeTime(null, 'opened')).toBe('opened recently')
  })
})
