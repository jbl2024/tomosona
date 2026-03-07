import type { PulseActionId, PulseSourceKind } from './api'

export type PulseActionSpec = {
  id: PulseActionId
  label: string
  description: string
}

export type PulseApplyMode = 'replace_selection' | 'insert_below' | 'send_to_second_brain' | 'append_to_draft' | 'replace_draft'

export const PULSE_ACTIONS_BY_SOURCE: Record<PulseSourceKind, PulseActionSpec[]> = {
  editor_selection: [
    { id: 'rewrite', label: 'Rewrite', description: 'Clarify the selected passage without changing its meaning.' },
    { id: 'condense', label: 'Condense', description: 'Shorten the selected text while preserving essentials.' },
    { id: 'expand', label: 'Expand', description: 'Develop the selected text into a fuller passage.' },
    { id: 'change_tone', label: 'Change tone', description: 'Adapt tone while keeping the underlying content.' }
  ],
  editor_note: [
    { id: 'synthesize', label: 'Synthesize', description: 'Produce a concise synthesis of the current note.' },
    { id: 'outline', label: 'Outline', description: 'Turn the note into a clearer plan or structure.' },
    { id: 'brief', label: 'Draft brief', description: 'Extract a brief from the note.' }
  ],
  second_brain_context: [
    { id: 'synthesize', label: 'Synthesize', description: 'Summarize the selected Second Brain context.' },
    { id: 'outline', label: 'Outline', description: 'Generate a plan from the active context set.' },
    { id: 'brief', label: 'Draft brief', description: 'Generate a brief from the active context set.' }
  ],
  cosmos_focus: [
    { id: 'synthesize', label: 'Synthesize', description: 'Summarize the selected node and neighborhood.' },
    { id: 'outline', label: 'Outline', description: 'Propose a structured plan from the visible cluster.' },
    { id: 'brief', label: 'Draft brief', description: 'Turn the selected graph context into a brief.' },
    { id: 'extract_themes', label: 'Extract themes', description: 'Identify dominant themes in the focus cluster.' },
    { id: 'identify_tensions', label: 'Identify tensions', description: 'Call out tensions, gaps, and contradictions.' }
  ]
}

export const PULSE_APPLY_LABELS: Record<PulseApplyMode, string> = {
  replace_selection: 'Replace selection',
  insert_below: 'Insert below',
  send_to_second_brain: 'Send to Second Brain',
  append_to_draft: 'Append to draft',
  replace_draft: 'Replace draft'
}
