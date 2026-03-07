import { describe, expect, it } from 'vitest'
import treeSource from './ExplorerTree.vue?raw'
import itemSource from './ExplorerItem.vue?raw'
import propertiesSource from '../../editor/components/editor/EditorPropertiesPanel.vue?raw'
import propertyTokenSource from './PropertyTokenInput.vue?raw'
import propertyAddSource from './PropertyAddDropdown.vue?raw'

describe('Explorer and properties theme contracts', () => {
  it('routes explorer surfaces and states through semantic tokens', () => {
    expect(treeSource).toContain('var(--explorer-toolbar-hover-bg)')
    expect(treeSource).toContain('var(--menu-backdrop)')
    expect(treeSource).toContain('var(--surface-bg)')
    expect(treeSource).not.toContain('dark:')
    expect(treeSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)

    expect(itemSource).toContain('var(--explorer-row-selected-bg)')
    expect(itemSource).toContain('var(--explorer-row-active-text)')
    expect(itemSource).toContain('var(--text-dim)')
    expect(itemSource).not.toContain('dark:')
    expect(itemSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)
  })

  it('routes the editor properties panel through semantic tokens', () => {
    expect(propertiesSource).toContain('var(--properties-panel-bg)')
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
