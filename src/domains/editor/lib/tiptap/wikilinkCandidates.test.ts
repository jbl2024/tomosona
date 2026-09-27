import { describe, expect, it } from 'vitest'
import { useEditorWikilinkDataSource } from '../../composables/useEditorWikilinkDataSource'
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

/** Exercise completion with the same existence resolver used by the editor. */
async function complete(query: string, targets: string[]) {
  const source = useEditorWikilinkDataSource({
    loadLinkTargets: async () => targets,
    loadLinkHeadings: async () => []
  })
  return buildWikilinkCandidates({
    query,
    loadTargets: source.loadWikilinkTargets,
    loadHeadings: source.loadWikilinkHeadings,
    currentHeadings: () => [],
    resolve: source.resolveWikilinkTarget
  })
}

describe('existing note completion', () => {
  it.each(['M\u00e9thode Zettelkasten', 'Me\u0301thode Zettelkasten.md', 'M\u00e9thode Zettelkasten|Ma m\u00e9thode'])(
    'selects the existing nested note for %s without offering creation', async (query) => {
      expect(await complete(query, ['Connaissances/M\u00e9thode Zettelkasten.md'])).toEqual([
        { target: 'Connaissances/M\u00e9thode Zettelkasten.md', exists: true }
      ])
    }
  )

  it('ranks exact matches before partial matches and before limiting results', async () => {
    const targets = Array.from({ length: 30 }, (_, index) => `Topic ${index}.md`)
    const candidates = await complete('Topic', [...targets, 'notes/Topic.md'])
    expect(candidates).toHaveLength(24)
    expect(candidates[0]).toEqual({ target: 'notes/Topic.md', exists: true })
    expect(candidates.some((entry) => entry.isCreate)).toBe(false)
  })

  it('lets the user choose between duplicate titles without offering another duplicate', async () => {
    expect(await complete('Topic', ['a/Topic.md', 'b/Topic.md'])).toEqual([
      { target: 'a/Topic.md', exists: true },
      { target: 'b/Topic.md', exists: true }
    ])
  })

  it('offers creation after partial matches and keeps it first for a truly new title', async () => {
    const candidates = await complete('Topic', ['Topic guide.md'])
    expect(candidates[0]).toEqual({ target: 'Topic guide.md', exists: true })
    expect(candidates[1]).toMatchObject({ target: 'Topic', isCreate: true })
    expect((await complete('New', []))[0]).toMatchObject({ target: 'New', isCreate: true })
  })

  it('supports directory index links and leaves an empty query free of creation', async () => {
    expect(await complete('Topic', ['Topic/index.md'])).toEqual([{ target: 'Topic/index.md', exists: true }])
    expect(await complete('', ['Topic.md'])).toEqual([{ target: 'Topic.md', exists: true }])
  })
})
