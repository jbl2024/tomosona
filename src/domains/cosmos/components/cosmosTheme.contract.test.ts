import { describe, expect, it } from 'vitest'
import cosmosSidebarSource from './CosmosSidebarPanel.vue?raw'
import cosmosViewSource from './CosmosView.vue?raw'
import cosmosPaneSource from './CosmosPaneSurface.vue?raw'
import secondBrainSessionsSource from '../../second-brain/components/SecondBrainSessionsList.vue?raw'
import secondBrainViewSource from '../../second-brain/components/SecondBrainView.vue?raw'

describe('Cosmos and second-brain theme contracts', () => {
  it('routes cosmos sidebar styling through shared semantic tokens', () => {
    expect(cosmosSidebarSource).toContain('var(--cosmos-panel-bg)')
    expect(cosmosSidebarSource).toContain('var(--cosmos-chip-active-bg)')
    expect(cosmosSidebarSource).not.toContain(':global(.ide-root.dark)')
    expect(cosmosSidebarSource).not.toMatch(/--cosmos-[a-z-]+:\s*#/)

    expect(cosmosViewSource).toContain('var(--cosmos-view-bg)')
    expect(cosmosViewSource).toContain("readThemeVar('--cosmos-node-selected'")
    expect(cosmosViewSource).not.toContain(':global(.ide-root.dark)')
    expect(cosmosPaneSource).toContain('var(--cosmos-resizer)')
    expect(cosmosPaneSource).toContain('var(--cosmos-resizer-hover)')
  })

  it('routes second-brain session list through shared tokens and modal chrome', () => {
    expect(secondBrainSessionsSource).toContain('var(--sb-surface)')
    expect(secondBrainSessionsSource).toContain('var(--sb-active-bg)')
    expect(secondBrainSessionsSource).toContain('modal-overlay')
    expect(secondBrainSessionsSource).not.toContain(':global(.ide-root.dark)')
    expect(secondBrainViewSource).toContain('var(--sb-composer-shadow)')
    expect(secondBrainViewSource).toContain('var(--sb-toast-shadow)')
  })
})
