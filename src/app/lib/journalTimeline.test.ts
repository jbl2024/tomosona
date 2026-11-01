import { describe, expect, it } from 'vitest'
import { buildJournalTimeline, parseJournalDate } from './journalTimeline'

describe('parseJournalDate', () => {
  it('accepts real calendar days in the daily-note format', () => {
    expect(parseJournalDate('2026-03-13.md')).toBe('2026-03-13')
    expect(parseJournalDate('2026-03-13.MD')).toBe('2026-03-13')
  })

  it('rejects invalid dates and undated names', () => {
    expect(parseJournalDate('2026-02-31.md')).toBeNull()
    expect(parseJournalDate('2026-13-01.md')).toBeNull()
    expect(parseJournalDate('meeting-notes.md')).toBeNull()
    expect(parseJournalDate('2026-03-13.markdown')).toBeNull()
    expect(parseJournalDate('2026-3-13.md')).toBeNull()
  })
})

describe('buildJournalTimeline', () => {
  const journalFolder = '/vault/journal'

  it('groups by month in reverse chronological order and flags today', () => {
    const timeline = buildJournalTimeline(
      [
        '/vault/journal/2026/03/2026-03-13.md',
        '/vault/journal/2026/03/2026-03-02.md',
        '/vault/journal/2026/02/2026-02-27.md',
        '/vault/journal/2025/12/2025-12-31.md'
      ],
      { journalFolder, today: '2026-03-13' }
    )

    expect(timeline.total).toBe(4)
    expect(timeline.groups.map((group) => group.key)).toEqual(['2026-03', '2026-02', '2025-12'])
    expect(timeline.groups[0].label).toBe('March 2026')
    expect(timeline.groups[0].entries.map((entry) => entry.date)).toEqual(['2026-03-13', '2026-03-02'])
    expect(timeline.groups[0].entries[0].isToday).toBe(true)
    expect(timeline.groups[0].entries[1].isToday).toBe(false)
    expect(timeline.todayPath).toBe('/vault/journal/2026/03/2026-03-13.md')
  })

  it('keeps duplicate dates with enough location to tell them apart', () => {
    const timeline = buildJournalTimeline(
      ['/vault/journal/2026/03/2026-03-13.md', '/vault/journal/archive/2026-03-13.md'],
      { journalFolder, today: '2026-03-13' }
    )

    const entries = timeline.groups[0].entries
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.duplicateDate)).toBe(true)
    expect(entries.map((entry) => entry.location)).toEqual(['2026/03/2026-03-13.md', 'archive/2026-03-13.md'])
    expect(entries.map((entry) => entry.path)).toEqual([
      '/vault/journal/2026/03/2026-03-13.md',
      '/vault/journal/archive/2026-03-13.md'
    ])
  })

  it('ignores invalid or undated files without touching their paths', () => {
    const timeline = buildJournalTimeline(
      ['/vault/journal/2026/02/2026-02-31.md', '/vault/journal/notes.md', '/vault/journal/2026/03/2026-03-13.md'],
      { journalFolder, today: '2026-03-13' }
    )

    expect(timeline.total).toBe(1)
    expect(timeline.groups[0].entries.map((entry) => entry.path)).toEqual(['/vault/journal/2026/03/2026-03-13.md'])
  })

  it('reports no today entry when the local date has no note', () => {
    const timeline = buildJournalTimeline(['/vault/journal/2026/03/2026-03-12.md'], {
      journalFolder,
      today: '2026-03-13'
    })

    expect(timeline.todayPath).toBeNull()
    expect(timeline.groups[0].entries[0].isToday).toBe(false)
  })

  it('handles an empty journal and a custom journal folder', () => {
    expect(buildJournalTimeline([], { journalFolder, today: '2026-03-13' })).toEqual({
      groups: [],
      total: 0,
      todayPath: null
    })

    const timeline = buildJournalTimeline(['/vault/daily/2026/03/2026-03-13.md'], {
      journalFolder: '/vault/daily',
      today: '2026-03-13'
    })
    expect(timeline.groups[0].entries[0].location).toBe('2026/03/2026-03-13.md')
  })
})
