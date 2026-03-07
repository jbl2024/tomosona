import { describe, expect, it } from 'vitest'
import { PULSE_ACTIONS_BY_SOURCE, PULSE_APPLY_LABELS } from './pulse'

describe('pulse contracts', () => {
  it('defines actions for every supported source kind', () => {
    expect(PULSE_ACTIONS_BY_SOURCE.editor_selection.map((item) => item.id)).toContain('rewrite')
    expect(PULSE_ACTIONS_BY_SOURCE.editor_note.map((item) => item.id)).toContain('synthesize')
    expect(PULSE_ACTIONS_BY_SOURCE.second_brain_context.map((item) => item.id)).toContain('outline')
    expect(PULSE_ACTIONS_BY_SOURCE.cosmos_focus.map((item) => item.id)).toContain('identify_tensions')
  })

  it('defines labels for every apply mode used by the shared panel', () => {
    expect(PULSE_APPLY_LABELS.replace_selection).toBe('Replace selection')
    expect(PULSE_APPLY_LABELS.send_to_second_brain).toBe('Send to Second Brain')
    expect(PULSE_APPLY_LABELS.append_to_draft).toBe('Append to draft')
  })
})
