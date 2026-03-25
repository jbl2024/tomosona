/**
 * Declarative mode contract used by the Second Brain frontend UI.
 *
 * Keep the registry local and explicit so mode labels, kinds, and
 * descriptions stay reviewable without hidden backend coupling.
 */
export type SecondBrainModeKind = 'prompt_template' | 'agent_builtin' | 'skill_ref'

/**
 * A selectable deliberation mode shown to users.
 *
 * `kind` tells the UI whether the entry is a prompt template, a built-in agent,
 * or a skill reference, which matters for how the composer explains it.
 */
export type SecondBrainModeSpec = {
  id: string
  label: string
  kind: SecondBrainModeKind
  description: string
}

/**
 * Default mode registry for v1.
 *
 * These are the initial user-facing modes presented by the chat surface.
 */
export const SECOND_BRAIN_MODES: SecondBrainModeSpec[] = [
  {
    id: 'freestyle',
    label: 'Freestyle',
    kind: 'prompt_template',
    description: 'Prompt libre sans cadre impose.'
  },
  {
    id: 'synthese',
    label: 'Synthese',
    kind: 'prompt_template',
    description: 'Resume structure du contexte actif.'
  },
  {
    id: 'plan_action',
    label: "Plan d'action",
    kind: 'prompt_template',
    description: 'Plan concret et ordonne.'
  },
  {
    id: 'diagnostic',
    label: 'Diagnostic',
    kind: 'agent_builtin',
    description: 'Problemes, hypotheses, evidences, validations.'
  },
  {
    id: 'fusion_notes',
    label: 'Fusion de notes',
    kind: 'prompt_template',
    description: 'Fusionne plusieurs notes en une sortie coherente.'
  },
  {
    id: 'extraction_concepts',
    label: 'Extraction de concepts',
    kind: 'skill_ref',
    description: 'Liste concepts, relations, zones floues.'
  }
]
