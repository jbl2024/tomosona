import { describe, expect, it } from 'vitest'
import { planNoteReferenceImpact, type NoteReferenceImpactInput } from './noteReferenceImpact'

const base: NoteReferenceImpactInput = {
  workspacePath: '/vault', sourcePath: '/vault/notes/source.md', kind: 'wikilink',
  target: 'notes/Topic#Heading|Alias',
  markdownPaths: ['/vault/notes/source.md', '/vault/notes/Topic.md'],
  moves: [{ from: '/vault/notes/Topic.md', to: '/vault/projects/Topic.md' }]
}

describe('note reference impact', () => {
  it('preserves a wikilink fragment and alias when its destination moves', () => {
    expect(planNoteReferenceImpact(base)).toEqual({ kind: 'rewrite', target: 'projects/Topic#Heading|Alias' })
  })

  it('does not rewrite a link that still resolves to the same destination', () => {
    expect(planNoteReferenceImpact({ ...base, target: '#Local heading' })).toEqual({ kind: 'unchanged' })
    expect(planNoteReferenceImpact({ ...base, target: 'notes/source' })).toEqual({ kind: 'unchanged' })
  })

  it('checks outgoing relative links when their source note moves', () => {
    const input: NoteReferenceImpactInput = {
      workspacePath: '/vault', sourcePath: '/vault/notes/deep/Source.md', kind: 'markdown',
      target: '../other/Target.md#section',
      markdownPaths: ['/vault/notes/deep/Source.md', '/vault/notes/other/Target.md'],
      moves: [{ from: '/vault/notes/deep/Source.md', to: '/vault/archive/Source.md' }]
    }
    expect(planNoteReferenceImpact(input)).toEqual({ kind: 'rewrite', target: '../notes/other/Target.md#section' })
  })

  it('expands folder moves when resolving changed targets', () => {
    expect(planNoteReferenceImpact({ ...base, moves: [{ from: '/vault/notes', to: '/vault/archive' }] })).toEqual({ kind: 'rewrite', target: 'archive/Topic#Heading|Alias' })
  })

  it('reports ambiguous identities, unresolved and unsupported targets instead of guessing', () => {
    expect(planNoteReferenceImpact({ ...base, markdownPaths: [...base.markdownPaths, '/vault/notes/topic.MD'] })).toEqual({ kind: 'uncertain', reason: 'ambiguous_paths' })
    expect(planNoteReferenceImpact({ ...base, target: 'missing' })).toEqual({ kind: 'uncertain', reason: 'unresolved_target' })
    expect(planNoteReferenceImpact({ ...base, target: '2026-11-01' })).toEqual({ kind: 'uncertain', reason: 'unsupported_target' })
    expect(planNoteReferenceImpact({ ...base, target: 'https://example.com' })).toEqual({ kind: 'uncertain', reason: 'unsupported_target' })
  })

  it('supports workspace-relative note lists and refuses a future name collision', () => {
    expect(planNoteReferenceImpact({ ...base, markdownPaths: ['notes/source.md', 'notes/Topic.md'] })).toEqual({ kind: 'rewrite', target: 'projects/Topic#Heading|Alias' })
    expect(planNoteReferenceImpact({ ...base, markdownPaths: [...base.markdownPaths, '/vault/projects/topic.MD'] })).toEqual({ kind: 'uncertain', reason: 'ambiguous_paths' })
  })

  it('does not guess Markdown escaping for a destination containing spaces', () => {
    const input: NoteReferenceImpactInput = {
      ...base, kind: 'markdown', target: '../notes/Topic.md',
      moves: [{ from: '/vault/notes/Topic.md', to: '/vault/with spaces/Topic.md' }]
    }
    expect(planNoteReferenceImpact(input)).toEqual({ kind: 'uncertain', reason: 'unsupported_target' })
  })
})
