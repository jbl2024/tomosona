import { describe, expect, it } from 'vitest'
import appSource from './app/App.vue?raw'
import editorViewSource from './domains/editor/components/EditorView.vue?raw'
import rightPaneSource from './domains/editor/components/EditorRightPane.vue?raw'
import overflowMenuSource from './app/components/app/WorkspaceOverflowMenu.vue?raw'
import multiPaneMenuSource from './app/components/panes/MultiPaneToolbarMenu.vue?raw'

describe('App theme contracts', () => {
  it('routes core shell surfaces through semantic tokens', () => {
    expect(appSource).toContain('var(--app-bg)')
    expect(appSource).toContain('var(--tab-strip-bg)')
    expect(appSource).toContain('var(--button-active-bg)')
    expect(appSource).not.toContain('.ide-root.dark .toolbar-icon-btn')
  })

  it('uses semantic tokens in migrated editor surfaces and menus', () => {
    expect(editorViewSource).toContain('var(--surface-bg)')
    expect(editorViewSource).toContain('var(--text-dim)')
    expect(editorViewSource).not.toContain('dark:bg')

    expect(rightPaneSource).toContain('var(--surface-raised)')
    expect(rightPaneSource).toContain('var(--text-main)')
    expect(rightPaneSource).not.toContain('.ide-root.dark .pane-card')

    expect(overflowMenuSource).toContain('var(--menu-bg)')
    expect(overflowMenuSource).toContain('var(--menu-active-text)')
    expect(overflowMenuSource).not.toContain(':global(.ide-root.dark)')

    expect(multiPaneMenuSource).toContain('var(--menu-bg)')
    expect(multiPaneMenuSource).toContain('var(--menu-divider)')
    expect(multiPaneMenuSource).not.toContain(':global(.ide-root.dark)')
  })
})
