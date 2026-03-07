import { describe, expect, it } from 'vitest'
import { MERMAID_TEMPLATES, resolveMermaidTemplateId, toMermaidTemplateItems } from './mermaidTemplates'

describe('mermaidTemplates', () => {
  it('detects template id from diagram source', () => {
    expect(resolveMermaidTemplateId('flowchart TD\n  A --> B')).toBe('flowchart')
    expect(resolveMermaidTemplateId('graph LR\n  A --> B')).toBe('flowchart')
    expect(resolveMermaidTemplateId('sequenceDiagram\n  A->>B: ping')).toBe('sequence')
    expect(resolveMermaidTemplateId('classDiagram\n  class A')).toBe('class')
    expect(resolveMermaidTemplateId('stateDiagram-v2\n  [*] --> Idle')).toBe('state')
    expect(resolveMermaidTemplateId('erDiagram\n  A ||--|| B')).toBe('')
  })

  it('builds dropdown items with stable ids and labels', () => {
    const items = toMermaidTemplateItems(MERMAID_TEMPLATES)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].id.startsWith('mermaid-template:')).toBe(true)
    expect(items[0].label.length).toBeGreaterThan(0)
  })
})

