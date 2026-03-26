import { describe, expect, it } from 'vitest'
import source from './AlterExplorationPanel.vue?raw'

describe('Alter exploration theme contract', () => {
  it('routes surface styling through shared second-brain tokens', () => {
    expect(source).toContain('var(--sb-layout-bg)')
    expect(source).toContain('var(--sb-center-bg)')
    expect(source).toContain('var(--sb-thread-bg)')
    expect(source).toContain('var(--sb-input-bg)')
    expect(source).toContain('var(--sb-input-border)')
    expect(source).toContain('var(--sb-composer-shadow)')
    expect(source).not.toContain('color-mix(in srgb, currentColor')
  })
})
