import { describe, expect, it } from 'vitest'
import inlineToolbarSource from './EditorInlineFormatToolbar.vue?raw'
import blockMenuSource from './EditorBlockMenu.vue?raw'
import tableToolbarSource from './EditorTableToolbar.vue?raw'
import mermaidDialogSource from './EditorMermaidReplaceDialog.vue?raw'
import largeDocOverlaySource from './EditorLargeDocOverlay.vue?raw'

describe('Editor overlay theme contracts', () => {
  it('routes inline and block menus through semantic editor tokens', () => {
    expect(inlineToolbarSource).toContain('var(--editor-menu-bg)')
    expect(inlineToolbarSource).toContain('var(--input-focus-ring)')
    expect(inlineToolbarSource).toContain('var(--danger)')
    expect(inlineToolbarSource).not.toContain('dark:')

    expect(blockMenuSource).toContain('var(--editor-menu-border)')
    expect(blockMenuSource).toContain('var(--editor-menu-hover-bg)')
    expect(blockMenuSource).toContain('var(--editor-menu-disabled)')
    expect(blockMenuSource).not.toContain('dark:')

    expect(tableToolbarSource).toContain('var(--editor-menu-section-border)')
    expect(tableToolbarSource).toContain('var(--editor-menu-text)')
    expect(tableToolbarSource).not.toContain('dark:')
  })

  it('routes editor overlays through global overlay and action tokens', () => {
    expect(mermaidDialogSource).toContain('var(--menu-backdrop)')
    expect(mermaidDialogSource).toContain('var(--button-primary-bg)')
    expect(mermaidDialogSource).toContain('var(--panel-border)')
    expect(mermaidDialogSource).not.toContain('dark:')

    expect(largeDocOverlaySource).toContain('var(--editor-overlay-backdrop)')
    expect(largeDocOverlaySource).toContain('var(--editor-progress-fill)')
    expect(largeDocOverlaySource).toContain('var(--text-main)')
    expect(largeDocOverlaySource).not.toContain('dark:')
  })
})
