import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_JOURNAL_FOLDER,
  journalFolderPath,
  journalFolderStorageKey,
  normalizeJournalFolder,
  readJournalFolder,
  writeJournalFolder
} from './journalFolder'

describe('journalFolder', () => {
  afterEach(() => { window.localStorage.clear() })

  it('defaults to the historical lowercase journal folder', () => {
    expect(DEFAULT_JOURNAL_FOLDER).toBe('journal')
    expect(readJournalFolder('/vault')).toBe('journal')
    expect(journalFolderPath('/vault', 'journal')).toBe('/vault/journal')
  })

  it('normalizes separators and rejects paths escaping the workspace', () => {
    expect(normalizeJournalFolder('  daily/notes  ')).toBe('daily/notes')
    expect(normalizeJournalFolder('\\daily\\\\notes')).toBe('daily/notes')
    expect(normalizeJournalFolder('/daily/')).toBe('daily')
    expect(normalizeJournalFolder('../notes')).toBeNull()
    expect(normalizeJournalFolder('journal/../../etc')).toBeNull()
    expect(normalizeJournalFolder('')).toBeNull()
    expect(normalizeJournalFolder(null)).toBeNull()
  })

  it('persists a workspace-scoped preference and reads it back', () => {
    writeJournalFolder('/vault', 'daily/notes')
    expect(window.localStorage.getItem(journalFolderStorageKey('/vault'))).toBe('daily/notes')
    expect(readJournalFolder('/vault')).toBe('daily/notes')
    // Another workspace keeps its own default.
    expect(readJournalFolder('/other')).toBe('journal')
  })

  it('ignores invalid writes and malformed stored values', () => {
    writeJournalFolder('/vault', '../escape')
    expect(window.localStorage.getItem(journalFolderStorageKey('/vault'))).toBeNull()

    window.localStorage.setItem(journalFolderStorageKey('/vault'), '../escape')
    expect(readJournalFolder('/vault')).toBe('journal')
  })

  it('builds the absolute folder path from the preference', () => {
    expect(journalFolderPath('/vault/', 'daily/notes')).toBe('/vault/daily/notes')
    expect(journalFolderPath('/vault', '../escape')).toBe('/vault/journal')
  })
})
