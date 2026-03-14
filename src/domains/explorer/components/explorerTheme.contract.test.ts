import { describe, expect, it } from 'vitest'
import treeSource from './ExplorerTree.vue?raw'
import toolbarSource from './ExplorerToolbar.vue?raw'
import confirmDialogSource from './ExplorerConfirmDialog.vue?raw'
import conflictDialogSource from './ExplorerConflictDialog.vue?raw'
import itemSource from './ExplorerItem.vue?raw'
import propertiesSource from '../../editor/components/editor/EditorPropertiesPanel.vue?raw'
import propertyTokenSource from '../../editor/components/properties/PropertyTokenInput.vue?raw'
import propertyAddSource from '../../editor/components/properties/PropertyAddDropdown.vue?raw'

describe('Explorer and properties theme contracts', () => {
  it('routes explorer surfaces and states through semantic tokens', () => {
    expect(toolbarSource).toContain('var(--explorer-toolbar-hover-bg)')
    expect(confirmDialogSource).toContain('var(--menu-backdrop)')
    expect(confirmDialogSource).toContain('var(--surface-bg)')
    expect(conflictDialogSource).toContain('var(--menu-backdrop)')
    expect(conflictDialogSource).toContain('var(--surface-bg)')
    expect(treeSource).not.toContain('dark:')
    expect(treeSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)
    expect(toolbarSource).not.toContain('dark:')
    expect(confirmDialogSource).not.toContain('dark:')
    expect(conflictDialogSource).not.toContain('dark:')

    expect(itemSource).toContain('var(--explorer-row-selected-bg)')
    expect(itemSource).toContain('var(--explorer-row-active-text)')
    expect(itemSource).toContain('var(--text-dim)')
    expect(itemSource).not.toContain('dark:')
    expect(itemSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)
  })

  it('routes the editor properties panel through semantic tokens', () => {
    expect(propertiesSource).toContain('background: transparent')
    expect(propertiesSource).toContain('var(--properties-field-border)')
    expect(propertiesSource).toContain('var(--focus-ring)')
    expect(propertiesSource).toContain('var(--danger)')
    expect(propertiesSource).not.toContain('dark:')

    expect(propertyTokenSource).toContain('var(--input-border)')
    expect(propertyTokenSource).toContain('var(--font-size-sm)')
    expect(propertyTokenSource).not.toContain('.dark .property-token-input')

    expect(propertyAddSource).toContain('var(--menu-bg)')
    expect(propertyAddSource).toContain('var(--button-secondary-bg)')
    expect(propertyAddSource).not.toContain('dark:')
  })
})
