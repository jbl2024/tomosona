import { describe, expect, it } from 'vitest'
import { buildWikilinkCandidates } from './wikilinkCandidates'

describe('buildWikilinkCandidates', () => {
  it('adds create candidate when no exact target match', async () => {
    const candidates = await buildWikilinkCandidates({
      query: 'new-note',
      loadTargets: async () => ['existing.md'],
      loadHeadings: async () => [],
      currentHeadings: () => [],
      resolve: async () => false
    })

    expect(candidates[0]).toEqual({
      target: 'new-note',
      label: 'Create "new-note"',
      exists: false,
      isCreate: true
    })
  })

  it('returns heading candidates for heading queries', async () => {
    const candidates = await buildWikilinkCandidates({
      query: 'note.md#he',
      loadTargets: async () => [],
      loadHeadings: async () => ['Heading One', 'other'],
      currentHeadings: () => [],
      resolve: async () => true
    })

    expect(candidates).toEqual([
      { target: 'note.md#Heading One', label: '#Heading One', exists: true },
      { target: 'note.md#other', label: '#other', exists: true }
    ])
  })
})
