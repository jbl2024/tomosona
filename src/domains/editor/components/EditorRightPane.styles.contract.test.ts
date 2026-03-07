import { describe, expect, it } from 'vitest'
import source from './EditorRightPane.vue?raw'

describe('EditorRightPane style contract', () => {
  it('keeps required pane selectors local to component', () => {
    expect(source).toContain('.right-pane {')
    expect(source).toContain('.pane-section {')
    expect(source).toContain('.outline-row {')
    expect(source).toContain('.metadata-grid {')
    expect(source).toContain('.meta-row {')
  })
})
