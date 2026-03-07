import { describe, expect, it } from 'vitest'
import viewSource from './SecondBrainView.vue?raw'
import contextSource from './SecondBrainContextPanel.vue?raw'
import deliberationSource from './SecondBrainDeliberationPanel.vue?raw'
import outputsSource from './SecondBrainOutputsPanel.vue?raw'
import sessionDropdownSource from './SecondBrainSessionDropdown.vue?raw'
import modeSelectorSource from './SecondBrainModeSelector.vue?raw'
import mentionsSource from './SecondBrainAtMentionsMenu.vue?raw'
import secondBrainEchoesSource from './SecondBrainEchoesPanel.vue?raw'
import shortcutsSource from '../app/ShortcutsModal.vue?raw'
import echoesSource from '../editor/EditorEchoesPanel.vue?raw'

describe('Second-brain and support theme contracts', () => {
  it('routes second-brain surfaces through shared sb tokens', () => {
    expect(viewSource).toContain('var(--sb-layout-bg)')
    expect(viewSource).toContain('var(--sb-input-bg)')
    expect(viewSource).not.toContain('.ide-root.dark')

    expect(contextSource).toContain('var(--sb-thread-bg)')
    expect(contextSource).toContain('var(--sb-button-bg)')
    expect(contextSource).not.toContain(':global(.ide-root.dark)')

    expect(deliberationSource).toContain('var(--sb-assistant-bg)')
    expect(deliberationSource).toContain('var(--sb-danger-text)')
    expect(deliberationSource).not.toContain(':global(.ide-root.dark)')

    expect(outputsSource).toContain('var(--sb-input-bg)')
    expect(outputsSource).toContain('var(--sb-button-border)')
    expect(outputsSource).not.toContain(':global(.ide-root.dark)')

    expect(sessionDropdownSource).toContain('var(--sb-danger-bg)')
    expect(sessionDropdownSource).toContain('var(--sb-active-text)')
    expect(sessionDropdownSource).not.toContain('.ide-root.dark')

    expect(modeSelectorSource).toContain('var(--sb-input-border)')
    expect(modeSelectorSource).not.toContain(':global(.ide-root.dark)')

    expect(mentionsSource).toContain('var(--sb-menu-bg)')
    expect(mentionsSource).toContain('var(--sb-hover-bg)')
    expect(mentionsSource).not.toContain('.ide-root.dark')

    expect(secondBrainEchoesSource).toContain('var(--sb-active-bg)')
    expect(secondBrainEchoesSource).toContain('var(--sb-button-bg)')
    expect(secondBrainEchoesSource).not.toContain('#dbeafe')
  })

  it('routes remaining support panels through token-based styling', () => {
    expect(shortcutsSource).toContain('var(--shortcuts-section-border)')
    expect(shortcutsSource).toContain('var(--shortcuts-keys-bg)')
    expect(shortcutsSource).not.toContain(':global(.ide-root.dark)')

    expect(echoesSource).toContain('var(--echoes-card-bg)')
    expect(echoesSource).toContain('var(--echoes-item-hover-bg)')
    expect(echoesSource).not.toContain('.ide-root.dark')
  })
})
