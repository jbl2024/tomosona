/**
 * Module: journalTimeline
 *
 * Purpose:
 * - Derive the explorer's chronological journal view from real dated notes.
 *
 * Boundaries:
 * - Pure derivation from already-listed paths: no I/O, no Vue state.
 * - Entries keep their real workspace paths; the timeline never implies a move.
 * - Only `YYYY-MM-DD.md` names that map to a real calendar date become entries,
 *   so undated or malformed files stay visible in the tree instead of being
 *   misrepresented here.
 */

import { isValidCalendarDate } from './appShellPaths'

/** One dated note shown in the chronological journal view. */
export type JournalTimelineEntry = {
  path: string
  /** Calendar day in `YYYY-MM-DD` form. */
  date: string
  year: number
  month: number
  /** Path relative to the journal folder, used to tell duplicate dates apart. */
  location: string
  isToday: boolean
  /** True when another entry shares the same calendar day. */
  duplicateDate: boolean
}

/** One month of the timeline, newest first. */
export type JournalTimelineGroup = {
  /** `YYYY-MM` key used for stable rendering. */
  key: string
  year: number
  month: number
  /** Human-readable month heading, for example `March 2026`. */
  label: string
  entries: JournalTimelineEntry[]
}

/** Chronological journal view derived from the workspace's dated notes. */
export type JournalTimeline = {
  groups: JournalTimelineGroup[]
  total: number
  /** Path of the entry matching the supplied local date, when one exists. */
  todayPath: string | null
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

const JOURNAL_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.md$/i

/**
 * Returns the calendar day encoded in a daily-note filename, or `null`.
 *
 * Example: `2026-03-13.md` -> `2026-03-13`, while `2026-02-31.md` and
 * `meeting-notes.md` both return `null`.
 */
export function parseJournalDate(fileName: string): string | null {
  const match = JOURNAL_FILE_PATTERN.exec(fileName.trim())
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!isValidCalendarDate(year, month, day)) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

/** Returns the final path segment of a workspace path. */
function fileNameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

/** Returns the path relative to the journal folder, or the full path when outside it. */
function locationOf(path: string, journalFolder: string): string {
  const prefix = `${journalFolder.replace(/\/+$/, '')}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/**
 * Builds the chronological journal view from workspace paths.
 *
 * Groups are ordered newest month first and entries newest day first. Entries
 * sharing a calendar day are all kept and flagged so the UI can show their
 * location instead of silently collapsing them.
 */
export function buildJournalTimeline(
  paths: readonly string[],
  options: { journalFolder: string; today: string }
): JournalTimeline {
  const journalFolder = options.journalFolder.replace(/\/+$/, '')
  const dated: Array<{ path: string; date: string; location: string }> = []

  for (const path of paths) {
    const date = parseJournalDate(fileNameOf(path))
    if (!date) continue
    dated.push({ path, date, location: locationOf(path, journalFolder) })
  }

  const dateCounts = new Map<string, number>()
  for (const entry of dated) {
    dateCounts.set(entry.date, (dateCounts.get(entry.date) ?? 0) + 1)
  }

  const groupsByKey = new Map<string, JournalTimelineGroup>()
  for (const entry of dated) {
    const year = Number.parseInt(entry.date.slice(0, 4), 10)
    const month = Number.parseInt(entry.date.slice(5, 7), 10)
    const key = entry.date.slice(0, 7)
    let group = groupsByKey.get(key)
    if (!group) {
      group = { key, year, month, label: `${MONTH_LABELS[month - 1]} ${year}`, entries: [] }
      groupsByKey.set(key, group)
    }
    group.entries.push({
      path: entry.path,
      date: entry.date,
      year,
      month,
      location: entry.location,
      isToday: entry.date === options.today,
      duplicateDate: (dateCounts.get(entry.date) ?? 0) > 1
    })
  }

  const groups = Array.from(groupsByKey.values()).sort((left, right) => right.key.localeCompare(left.key))
  for (const group of groups) {
    group.entries.sort((left, right) => right.date.localeCompare(left.date) || left.location.localeCompare(right.location))
  }

  const todayEntry = groups.flatMap((group) => group.entries).find((entry) => entry.isToday) ?? null

  return { groups, total: dated.length, todayPath: todayEntry?.path ?? null }
}
