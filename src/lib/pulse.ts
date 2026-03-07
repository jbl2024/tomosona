import type { PulseActionId, PulseSourceKind } from '../shared/api/apiTypes'

export type PulseActionSpec = {
  id: PulseActionId
  label: string
  description: string
  family: 'text' | 'relations'
  keywords: string[]
  available_in: PulseSourceKind[]
}

export type PulseApplyMode = 'replace_selection' | 'insert_below' | 'send_to_second_brain' | 'append_to_draft' | 'replace_draft'

export type PulseDropdownItem = PulseActionSpec & {
  group?: string
  aliases: string[]
}

export const PULSE_ACTIONS: PulseActionSpec[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Clarify the selected passage without changing its meaning.',
    family: 'text',
    keywords: ['text', 'selection', 'rewrite', 'clarify', 'rephrase'],
    available_in: ['editor_selection', 'second_brain_context']
  },
  {
    id: 'condense',
    label: 'Condense',
    description: 'Shorten the selected text while preserving essentials.',
    family: 'text',
    keywords: ['text', 'selection', 'condense', 'shorten', 'compress', 'summary'],
    available_in: ['editor_selection', 'second_brain_context']
  },
  {
    id: 'expand',
    label: 'Expand',
    description: 'Develop the selected text into a fuller passage.',
    family: 'text',
    keywords: ['text', 'selection', 'expand', 'develop', 'elaborate'],
    available_in: ['editor_selection', 'second_brain_context']
  },
  {
    id: 'change_tone',
    label: 'Change tone',
    description: 'Adapt tone while keeping the underlying content.',
    family: 'text',
    keywords: ['text', 'selection', 'tone', 'style', 'voice', 'rewrite'],
    available_in: ['editor_selection', 'second_brain_context']
  },
  {
    id: 'synthesize',
    label: 'Synthesize',
    description: 'Summarize the current context into a concise structure.',
    family: 'relations',
    keywords: ['context', 'relations', 'summary', 'synthesis'],
    available_in: ['editor_note', 'second_brain_context', 'cosmos_focus']
  },
  {
    id: 'outline',
    label: 'Outline',
    description: 'Generate a clear plan from the active context set.',
    family: 'relations',
    keywords: ['context', 'relations', 'outline', 'plan', 'structure'],
    available_in: ['editor_note', 'second_brain_context', 'cosmos_focus']
  },
  {
    id: 'brief',
    label: 'Draft brief',
    description: 'Turn the active context into a working brief.',
    family: 'relations',
    keywords: ['context', 'relations', 'brief', 'memo', 'summary'],
    available_in: ['editor_note', 'second_brain_context', 'cosmos_focus']
  },
  {
    id: 'extract_themes',
    label: 'Extract themes',
    description: 'Identify dominant themes in the active context.',
    family: 'relations',
    keywords: ['context', 'relations', 'themes', 'topics', 'patterns'],
    available_in: ['second_brain_context', 'cosmos_focus']
  },
  {
    id: 'identify_tensions',
    label: 'Identify tensions',
    description: 'Call out tensions, gaps, and contradictions.',
    family: 'relations',
    keywords: ['context', 'relations', 'tensions', 'gaps', 'contradictions'],
    available_in: ['second_brain_context', 'cosmos_focus']
  }
]

export const PULSE_ACTIONS_BY_SOURCE: Record<PulseSourceKind, PulseActionSpec[]> = {
  editor_selection: PULSE_ACTIONS.filter((item) => item.available_in.includes('editor_selection')),
  editor_note: PULSE_ACTIONS.filter((item) => item.available_in.includes('editor_note')),
  second_brain_context: PULSE_ACTIONS.filter((item) => item.available_in.includes('second_brain_context')),
  cosmos_focus: PULSE_ACTIONS.filter((item) => item.available_in.includes('cosmos_focus'))
}

function pulseFamilyLabel(family: PulseActionSpec['family']): string {
  return family === 'text' ? 'Text' : 'Relations'
}

export function getPulseDropdownItems(sourceKind: PulseSourceKind, options?: { grouped?: boolean }): PulseDropdownItem[] {
  return PULSE_ACTIONS_BY_SOURCE[sourceKind].map((item) => ({
    ...item,
    group: options?.grouped ? pulseFamilyLabel(item.family) : undefined,
    aliases: [item.label, item.description, ...item.keywords]
  }))
}

export const PULSE_APPLY_LABELS: Record<PulseApplyMode, string> = {
  replace_selection: 'Replace selection',
  insert_below: 'Insert below',
  send_to_second_brain: 'Send to Second Brain',
  append_to_draft: 'Append to draft',
  replace_draft: 'Replace draft'
}
