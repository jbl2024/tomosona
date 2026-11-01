import { describe, expect, it } from 'vitest'
import { assessMutationReadiness } from './mutationReadiness'

describe('mutation readiness', () => {
  it('maps open notes through file and folder moves and flags dirty buffers', () => {
    const readiness = assessMutationReadiness({
      moves: [
        { from: '/vault/notes', to: '/vault/archive' },
        { from: '/vault/loose.md', to: '/vault/archive/loose.md' }
      ],
      openNotes: [
        { path: '/vault/notes/deep/Topic.md', dirty: true },
        { path: '/vault/notes/clean.md', dirty: false },
        { path: '/vault/loose.md', dirty: false },
        { path: '/vault/other/untouched.md', dirty: true }
      ]
    })
    expect(readiness.affected).toEqual([
      { from: '/vault/loose.md', to: '/vault/archive/loose.md', dirty: false },
      { from: '/vault/notes/clean.md', to: '/vault/archive/clean.md', dirty: false },
      { from: '/vault/notes/deep/Topic.md', to: '/vault/archive/deep/Topic.md', dirty: true }
    ])
    expect(readiness.dirtyAffected).toEqual([
      { from: '/vault/notes/deep/Topic.md', to: '/vault/archive/deep/Topic.md', dirty: true }
    ])
  })

  it('prefers the most specific move when a folder and a file inside it both move', () => {
    const readiness = assessMutationReadiness({
      moves: [
        { from: '/vault/notes', to: '/vault/archive' },
        { from: '/vault/notes/special.md', to: '/vault/quarantine/special.md' }
      ],
      openNotes: [{ path: '/vault/notes/special.md', dirty: false }]
    })
    expect(readiness.affected).toEqual([
      { from: '/vault/notes/special.md', to: '/vault/quarantine/special.md', dirty: false }
    ])
  })

  it('reports nothing when no open note is affected', () => {
    const readiness = assessMutationReadiness({
      moves: [{ from: '/vault/a.md', to: '/vault/b.md' }],
      openNotes: [{ path: '/vault/c.md', dirty: true }]
    })
    expect(readiness.affected).toEqual([])
    expect(readiness.dirtyAffected).toEqual([])
  })
})
