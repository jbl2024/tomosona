import { describe, expect, it } from 'vitest'
import buttonSource from './UiButton.vue?raw'
import inputSource from './UiInput.vue?raw'
import panelSource from './UiPanel.vue?raw'
import switcherSource from './UiThemeSwitcher.vue?raw'
import dropdownSource from './UiFilterableDropdown.vue?raw'

describe('UI theme token contracts', () => {
  it('keeps core primitives on semantic CSS variables', () => {
    expect(buttonSource).toContain('var(--button-primary-bg)')
    expect(buttonSource).toContain('ui-button--ghost')
    expect(buttonSource).not.toContain('dark:')
    expect(buttonSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)

    expect(inputSource).toContain('var(--input-bg)')
    expect(inputSource).toContain('var(--input-focus-ring)')
    expect(inputSource).not.toContain('dark:')
    expect(inputSource).not.toMatch(/#[0-9A-Fa-f]{3,8}/)

    expect(panelSource).toContain('var(--panel-bg)')
    expect(panelSource).toContain('var(--panel-shadow)')
    expect(panelSource).not.toContain('dark:')

    expect(switcherSource).toContain('var(--panel-border)')
    expect(switcherSource).not.toContain('dark:')
  })

  it('keeps the shared dropdown on global menu tokens', () => {
    expect(dropdownSource).toContain('var(--surface-bg)')
    expect(dropdownSource).toContain('var(--text-main)')
    expect(dropdownSource).toContain('var(--input-focus-border)')
    expect(dropdownSource).not.toContain(':global(.dark)')
  })
})
