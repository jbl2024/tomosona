import { describe, expect, it } from 'vitest'
import appSource from '../../App.vue?raw'
import quickOpenSource from './QuickOpenModal.vue?raw'
import settingsSource from '../settings/SettingsModal.vue?raw'
import indexStatusSource from './IndexStatusModal.vue?raw'

describe('App modal theme contracts', () => {
  it('routes shared modal chrome through semantic tokens', () => {
    expect(appSource).toContain('var(--modal-backdrop)')
    expect(appSource).toContain('var(--modal-bg)')
    expect(appSource).toContain('var(--modal-tab-active-bg)')
    expect(appSource).toContain('var(--modal-danger-text)')
    expect(appSource).not.toContain('.ide-root.dark .modal')
  })

  it('routes modal-specific surfaces through token-based styles', () => {
    expect(quickOpenSource).toContain('var(--modal-chip-bg)')
    expect(quickOpenSource).toContain('var(--modal-chip-active-bg)')
    expect(quickOpenSource).not.toContain(':global(.ide-root.dark)')

    expect(settingsSource).toContain('var(--panel-border)')
    expect(settingsSource).toContain('var(--surface-bg)')
    expect(settingsSource).toContain('var(--surface-muted)')
    expect(settingsSource).not.toContain(':global(.ide-root.dark)')

    expect(indexStatusSource).toContain('var(--index-card-bg)')
    expect(indexStatusSource).toContain('var(--index-filter-active-bg)')
    expect(indexStatusSource).toContain('var(--index-stop-bg)')
    expect(indexStatusSource).not.toContain(':global(.ide-root.dark)')
  })
})
