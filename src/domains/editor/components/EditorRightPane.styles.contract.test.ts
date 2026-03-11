import { describe, expect, it } from 'vitest'
import source from './EditorRightPane.vue?raw'

describe('EditorRightPane style contract', () => {
  it('keeps required pane selectors local to component', () => {
    expect(source).toContain('.right-pane {')
    expect(source).toContain('.pane-toolbar {')
    expect(source).toContain('.favorite-toggle-btn--active {')
    expect(source).toContain('.pane-section {')
    expect(source).toContain('.outline-row {')
    expect(source).toContain('.metadata-grid {')
    expect(source).toContain('.meta-row {')
  })

  it('routes pane chrome through dedicated semantic tokens', () => {
    expect(source).toContain('var(--right-pane-bg)')
    expect(source).toContain('var(--right-pane-card-bg)')
    expect(source).toContain('var(--right-pane-favorite)')
    expect(source).not.toMatch(/#[0-9A-Fa-f]{3,8}/)
  })
})
