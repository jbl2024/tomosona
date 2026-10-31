import { describe, expect, it } from 'vitest'
import {
  compareNoteMatches,
  matchCommand,
  matchNoteTitle,
  normalizePaletteText
} from './paletteSearch'

describe('normalizePaletteText', () => {
  it('folds case and accents', () => {
    expect(normalizePaletteText('Méthode Zettelkasten')).toBe('methode zettelkasten')
    expect(normalizePaletteText('  Àération ')).toBe('aeration')
  })
})

describe('matchNoteTitle', () => {
  it('matches the source spec example matrix', () => {
    expect(matchNoteTitle('Méthode Zettelkasten', 'zettel')?.kind).toBe('partial')
    expect(matchNoteTitle('Créer des notes atomiques', 'notes atom')?.kind).toBe('partial')
    expect(matchNoteTitle('Créer des notes atomiques', 'atom notes')?.kind).toBe('partial')
    expect(matchNoteTitle('Méthode Zettelkasten', 'methode zettel')?.kind).toBe('prefix')
    expect(matchNoteTitle('Roadmap de lancement', 'roadmap')?.kind).toBe('prefix')
  })

  it('ranks exact and prefix matches above partial ones', () => {
    expect(matchNoteTitle('Roadmap de lancement', 'roadmap de lancement')?.kind).toBe('exact')
    expect(matchNoteTitle('Roadmap de lancement', 'roadmap')?.score)
      .toBeGreaterThan(matchNoteTitle('Roadmap de lancement', 'lancement')!.score)
  })

  it('is case-insensitive and accent-insensitive', () => {
    expect(matchNoteTitle('Méthode Zettelkasten', 'MÉTHODE')?.kind).toBe('prefix')
    expect(matchNoteTitle('Roadmap de lancement', 'ROADMAP')?.kind).toBe('prefix')
  })

  it('tolerates simple typos through subsequences and single edits', () => {
    expect(matchNoteTitle('Roadmap de lancement', 'roadamp')?.kind).toBe('fuzzy')
    expect(matchNoteTitle('Méthode Zettelkasten', 'ztl')?.kind).toBe('fuzzy')
    expect(matchNoteTitle('Méthode Zettelkasten', 'zettelkasen')?.kind).toBe('fuzzy')
  })

  it('returns null when any query word fails', () => {
    expect(matchNoteTitle('Créer des notes atomiques', 'notes zzz')).toBeNull()
    expect(matchNoteTitle('Roadmap de lancement', 'xyzabc')).toBeNull()
    expect(matchNoteTitle('Roadmap de lancement', '')).toBeNull()
  })
})

describe('matchCommand', () => {
  it('reaches commands through aliases', () => {
    const keywords = ['word', 'docx', 'convertir', 'export']
    expect(matchCommand('Exporter la note en Word', keywords, 'docx')).toEqual({ kind: 'keyword', score: 30 })
    expect(matchCommand('Exporter la note en Word', keywords, 'convertir')).toEqual({ kind: 'keyword', score: 30 })
    expect(matchCommand('Exporter la note en Word', keywords, 'exporter')?.kind).toBe('prefix')
    expect(matchCommand('Exporter la note en Word', keywords, 'exporter la note en word')?.kind).toBe('exact')
  })

  it('matches multi-word queries across label and keywords', () => {
    expect(matchCommand('Renommer la note', ['renommer', 'changer nom', 'rename'], 'changer nom')?.kind).toBe('keyword')
    expect(matchCommand('Renommer la note', ['renommer', 'changer nom', 'rename'], 'renommer')?.kind).toBe('prefix')
  })

  it('requires every word to match', () => {
    expect(matchCommand('Renommer la note', ['renommer'], 'changer dossier')).toBeNull()
  })
})

describe('compareNoteMatches', () => {
  const context = {
    recentPaths: ['/vault/b.md', '/vault/a.md'],
    favoritePaths: ['/vault/c.md'],
    currentFolder: '/vault/projets'
  }

  it('orders by match score first', () => {
    const exact = { path: '/vault/z.md', title: 'Z', match: { kind: 'exact' as const, score: 400 } }
    const fuzzy = { path: '/vault/a.md', title: 'A', match: { kind: 'fuzzy' as const, score: 100 } }
    expect(compareNoteMatches(exact, fuzzy, context)).toBeLessThan(0)
  })

  it('breaks ties by recency, then favorite, then current folder, then path', () => {
    const partial = (path: string) => ({ path, title: path, match: { kind: 'partial' as const, score: 200 } })

    // b.md is more recent than a.md.
    expect(compareNoteMatches(partial('/vault/a.md'), partial('/vault/b.md'), context)).toBeGreaterThan(0)

    // Neither recent: favorite beats non-favorite.
    expect(compareNoteMatches(partial('/vault/d.md'), partial('/vault/c.md'), context)).toBeGreaterThan(0)

    // Neither recent nor favorite: current folder wins.
    const inFolder = { path: '/vault/projets/e.md', title: 'E', match: { kind: 'partial' as const, score: 200 } }
    const elsewhere = { path: '/vault/autres/f.md', title: 'F', match: { kind: 'partial' as const, score: 200 } }
    expect(compareNoteMatches(inFolder, elsewhere, context)).toBeLessThan(0)

    // Otherwise: stable path order.
    expect(compareNoteMatches(partial('/vault/y.md'), partial('/vault/x.md'), context)).toBeGreaterThan(0)
  })

  it('compares deterministically without context', () => {
    const a = { path: '/vault/a.md', title: 'A', match: { kind: 'partial' as const, score: 200 } }
    const b = { path: '/vault/b.md', title: 'B', match: { kind: 'partial' as const, score: 200 } }
    expect(compareNoteMatches(a, b)).toBeLessThan(0)
  })
})
