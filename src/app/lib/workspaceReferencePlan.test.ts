import { describe, expect, it } from 'vitest'
import { planWorkspaceReferenceImpact } from './workspaceReferencePlan'
import { applyContentReferencePlan } from './noteReferencePlan'

describe('workspace reference plan', () => {
  const input = {
    workspacePath: '/vault',
    markdownPaths: ['/vault/notes/source.md', '/vault/notes/Topic.md', '/vault/other/Reader.md'],
    moves: [{ from: '/vault/notes/Topic.md', to: '/vault/projects/Topic.md' }],
    contents: {
      '/vault/notes/source.md': '- [[notes/Topic#A|Alias]]\n- [[missing]]',
      '/vault/notes/Topic.md': '- back to [[notes/source]]',
      '/vault/other/Reader.md': '- see [topic](../notes/Topic.md)'
    }
  }

  it('aggregates inbound and outbound plans across notes and applies them', () => {
    const plan = planWorkspaceReferenceImpact(input)
    expect(plan.lockedSources).toEqual([])
    expect(plan.notes.map((note) => note.sourcePath)).toEqual(['/vault/notes/source.md', '/vault/other/Reader.md'])

    const source = plan.notes[0]
    expect(source.plan.warnings).toEqual([{ kind: 'wikilink', target: 'missing', reason: 'unresolved_target' }])
    expect(applyContentReferencePlan(input.contents['/vault/notes/source.md'], source.plan))
      .toBe('- [[projects/Topic#A|Alias]]\n- [[missing]]')

    const reader = plan.notes[1]
    expect(reader.plan.warnings).toEqual([])
    expect(applyContentReferencePlan(input.contents['/vault/other/Reader.md'], reader.plan))
      .toBe('- see [topic](../projects/Topic.md)')
  })

  it('accepts workspace-relative path lists and reports locked notes as unknown', () => {
    const plan = planWorkspaceReferenceImpact({
      workspacePath: '/vault',
      markdownPaths: ['notes/source.md', 'notes/Topic.md', 'secret/locked.md'],
      moves: [{ from: 'notes/Topic.md', to: 'projects/Topic.md' }],
      contents: {
        'notes/source.md': '- [[notes/Topic]]'
      },
      lockedSourcePaths: ['secret/locked.md']
    })
    expect(plan.notes).toHaveLength(1)
    expect(plan.notes[0].sourcePath).toBe('/vault/notes/source.md')
    expect(plan.lockedSources).toEqual(['/vault/secret/locked.md'])
  })

  it('omits notes without any rewrite or warning', () => {
    const plan = planWorkspaceReferenceImpact({
      ...input,
      moves: [],
      contents: { '/vault/notes/source.md': '- [[notes/Topic]]' }
    })
    expect(plan.notes).toEqual([])
    expect(plan.lockedSources).toEqual([])
  })
})
