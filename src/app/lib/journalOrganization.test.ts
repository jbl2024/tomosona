import { describe, expect, it } from 'vitest'
import { journalNoteDestination, planJournalOrganization } from './journalOrganization'

describe('journalNoteDestination', () => {
  it('builds the canonical year/month path under the journal folder', () => {
    expect(journalNoteDestination('/vault', 'journal', '2026-03-13')).toBe('/vault/journal/2026/03/2026-03-13.md')
    expect(journalNoteDestination('/vault/', 'daily/notes', '2026-03-13')).toBe('/vault/daily/notes/2026/03/2026-03-13.md')
  })

  it('falls back to the default folder for an unusable preference', () => {
    expect(journalNoteDestination('/vault', '../escape', '2026-03-13')).toBe('/vault/journal/2026/03/2026-03-13.md')
  })
})

describe('planJournalOrganization', () => {
  const options = { root: '/vault', journalFolder: 'journal' }

  it('plans dispersed dated notes and counts already organized ones', () => {
    const plan = planJournalOrganization(
      [
        { path: '/vault/journal/2026-03-13.md', date: '2026-03-13' },
        { path: '/vault/journal/archive/2026-03-12.md', date: '2026-03-12' },
        { path: '/vault/journal/2026/03/2026-03-11.md', date: '2026-03-11' }
      ],
      options
    )

    expect(plan.moves).toEqual([
      { from: '/vault/journal/2026-03-13.md', to: '/vault/journal/2026/03/2026-03-13.md', date: '2026-03-13' },
      { from: '/vault/journal/archive/2026-03-12.md', to: '/vault/journal/2026/03/2026-03-12.md', date: '2026-03-12' }
    ])
    expect(plan.organized).toBe(1)
    expect(plan.skipped).toBe(0)
  })

  it('never claims dated notes stored outside the journal folder', () => {
    const plan = planJournalOrganization([{ path: '/vault/notes/2026-03-13.md', date: '2026-03-13' }], options)

    expect(plan.moves).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('returns an empty plan for an empty journal', () => {
    expect(planJournalOrganization([], options)).toEqual({ moves: [], organized: 0, skipped: 0 })
  })

  it('honors a custom journal folder', () => {
    const plan = planJournalOrganization([{ path: '/vault/daily/2026-03-13.md', date: '2026-03-13' }], {
      root: '/vault',
      journalFolder: 'daily'
    })

    expect(plan.moves).toEqual([
      { from: '/vault/daily/2026-03-13.md', to: '/vault/daily/2026/03/2026-03-13.md', date: '2026-03-13' }
    ])
  })
})
