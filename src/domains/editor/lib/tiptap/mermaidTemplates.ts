export type MermaidTemplate = {
  id: string
  label: string
  code: string
  aliases: string[]
}

export type MermaidTemplateDropdownItem = {
  id: string
  label: string
  value: string
  aliases: string[]
  code: string
}

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    aliases: ['flow', 'graph', 'td', 'lr'],
    code: 'flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|Yes| C[Ship]\n  B -->|No| D[Iterate]\n  D --> B'
  },
  {
    id: 'sequence',
    label: 'Sequence',
    aliases: ['seq', 'sequence diagram', 'actors'],
    code: 'sequenceDiagram\n  participant User\n  participant App\n  User->>App: Request\n  App-->>User: Response'
  },
  {
    id: 'class',
    label: 'Class',
    aliases: ['classdiagram', 'class diagram', 'uml'],
    code: 'classDiagram\n  class Note {\n    +title: string\n    +save()\n  }\n  class Workspace {\n    +path: string\n    +openNote()\n  }\n  Workspace --> Note'
  },
  {
    id: 'state',
    label: 'State',
    aliases: ['state diagram', 'statechart'],
    code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Editing: open\n  Editing --> Saved: save\n  Saved --> Idle'
  }
]

/**
 * Detects likely Mermaid diagram family from source code.
 */
export function resolveMermaidTemplateId(source: string): string {
  const normalized = source.trim().toLowerCase()
  if (!normalized) return ''
  if (normalized.startsWith('flowchart') || normalized.startsWith('graph ')) return 'flowchart'
  if (normalized.startsWith('sequencediagram')) return 'sequence'
  if (normalized.startsWith('classdiagram')) return 'class'
  if (normalized.startsWith('statediagram')) return 'state'
  return ''
}

/**
 * Builds dropdown items for Mermaid templates.
 */
export function toMermaidTemplateItems(templates: MermaidTemplate[]): MermaidTemplateDropdownItem[] {
  return templates.map((template) => ({
    id: `mermaid-template:${template.id}`,
    label: template.label,
    value: template.id,
    aliases: template.aliases,
    code: template.code
  }))
}
