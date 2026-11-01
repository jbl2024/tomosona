import { describe, expect, it } from 'vitest'
import { applyContentReferencePlan, planContentReferenceImpact } from './noteReferencePlan'

const input = {
  workspacePath: '/vault',
  sourcePath: '/vault/notes/deep/Source.md',
  markdownPaths: ['/vault/notes/deep/Source.md', '/vault/notes/Topic.md', '/vault/notes/other/Target.md'],
  moves: [
    { from: '/vault/notes/Topic.md', to: '/vault/projects/Topic.md' },
    { from: '/vault/notes/deep/Source.md', to: '/vault/archive/Source.md' }
  ]
}

const content = [
  '- [[notes/Topic#Heading|Alias]]',
  '- [target](../other/Target.md#sec)',
  '- [[notes/other/Target]]',
  '- [[missing]]',
  '- [[2026-11-01]]',
  '- [ext](https://example.com)',
  '- ![pic](assets/pic.png)'
].join('\n')

describe('content reference plan', () => {
  it('rewrites moved targets while preserving aliases, fragments and untouched links', () => {
    const plan = planContentReferenceImpact(content, input)
    expect(plan.warnings).toEqual([
      { kind: 'wikilink', target: 'missing', reason: 'unresolved_target' },
      { kind: 'wikilink', target: '2026-11-01', reason: 'unsupported_target' }
    ])
    expect(plan.rewrites).toHaveLength(2)
    expect(applyContentReferencePlan(content, plan)).toBe([
      '- [[projects/Topic#Heading|Alias]]',
      '- [target](../notes/other/Target.md#sec)',
      '- [[notes/other/Target]]',
      '- [[missing]]',
      '- [[2026-11-01]]',
      '- [ext](https://example.com)',
      '- ![pic](assets/pic.png)'
    ].join('\n'))
  })

  it('leaves content unchanged when no reference is affected', () => {
    const plan = planContentReferenceImpact('- [[notes/other/Target]]\n- [ext](https://example.com)', {
      ...input,
      moves: [{ from: '/vault/notes/Topic.md', to: '/vault/projects/Topic.md' }]
    })
    expect(plan.rewrites).toEqual([])
    expect(plan.warnings).toEqual([])
    expect(applyContentReferencePlan(content, plan)).toBe(content)
  })

  it('expands folder moves for wikilinks while relative links follow their folder', () => {
    const folderContent = '- [[notes/Topic]]\n- [t](./other/Target.md)'
    const plan = planContentReferenceImpact(folderContent, {
      workspacePath: '/vault',
      sourcePath: '/vault/notes/source.md',
      markdownPaths: ['/vault/notes/source.md', '/vault/notes/Topic.md', '/vault/notes/other/Target.md'],
      moves: [{ from: '/vault/notes', to: '/vault/archive' }]
    })
    // The path-qualified wikilink must follow the folder move; the relative
    // markdown link already resolves to the moved folder and stays untouched.
    expect(plan.rewrites).toEqual([{ start: 4, end: 15, replacement: 'archive/Topic' }])
    expect(plan.warnings).toEqual([])
    expect(applyContentReferencePlan(folderContent, plan)).toBe('- [[archive/Topic]]\n- [t](./other/Target.md)')
  })

  it('reports ambiguous workspace identities as warnings instead of rewriting', () => {
    const plan = planContentReferenceImpact('- [[Topic]]', {
      ...input,
      markdownPaths: ['/vault/notes/deep/Source.md', '/vault/notes/Topic.md', '/vault/notes/topic.MD'],
      moves: [{ from: '/vault/notes/Topic.md', to: '/vault/projects/Topic.md' }]
    })
    expect(plan.rewrites).toEqual([])
    expect(plan.warnings).toEqual([{ kind: 'wikilink', target: 'Topic', reason: 'ambiguous_paths' }])
  })
})
