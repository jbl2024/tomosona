import { describe, expect, it } from 'vitest'
import {
  buildEditorAtMacroEntries,
  canContinueEditorAtMacroArgument,
  editorAtMacroMatchesQuery,
  listEditorAtMacroIds,
  resolveEditorAtMacro
} from './editorAtMacros'

const context = {
  title: 'Planning note',
  path: 'notes/planning.md',
  now: new Date(2026, 3, 12, 14, 32, 5),
  bodyText: 'Alpha beta gamma',
  tags: ['work', 'planning'],
  backlinks: ['notes/back.md'],
  updatedAt: new Date(2026, 3, 11, 9, 0, 0)
}

describe('editorAtMacros', () => {
  it('builds deterministic entries from document metadata and local time', () => {
    const entries = buildEditorAtMacroEntries(context)

    expect(entries.find((entry) => entry.id === 'today')).toMatchObject({
      label: 'Today',
      group: 'Time',
      kind: 'insert_text',
      replacement: '2026-04-12',
      preview: '2026-04-12'
    })
    expect(entries.find((entry) => entry.id === 'now')?.replacement).toBe('2026-04-12 14:32')
    expect(entries.find((entry) => entry.id === 'timestamp')?.replacement).toBe('2026-04-12T14:32:05')
    expect(entries.find((entry) => entry.id === 'title')?.replacement).toBe('Planning note')
    expect(entries.find((entry) => entry.id === 'path')?.replacement).toBe('notes/planning.md')
    expect(entries.find((entry) => entry.id === 'filename')?.replacement).toBe('planning.md')
    expect(entries.find((entry) => entry.id === 'folder')?.replacement).toBe('notes')
    expect(entries.find((entry) => entry.id === 'word_count')?.replacement).toBe('3')
    expect(entries.find((entry) => entry.id === 'tags')?.replacement).toBe('work, planning')
    expect(entries.find((entry) => entry.id === 'updated_at')?.replacement).toBe('2026-04-11')
  })

  it('formats relative time macros and ISO week/month values', () => {
    expect(resolveEditorAtMacro('yesterday', context)?.replacement).toBe('2026-04-11')
    expect(resolveEditorAtMacro('tomorrow', context)?.replacement).toBe('2026-04-13')
    expect(resolveEditorAtMacro('week', context)?.replacement).toBe('2026-W15')
    expect(resolveEditorAtMacro('month', context)?.replacement).toBe('2026-04')
    expect(resolveEditorAtMacro('date-fr', context)?.replacement).toBe('12 avril 2026')
  })

  it('parses compact and natural date arguments', () => {
    expect(resolveEditorAtMacro('date+7', context)?.replacement).toBe('2026-04-19')
    expect(resolveEditorAtMacro('date +30', context)?.replacement).toBe('2026-05-12')
    expect(resolveEditorAtMacro('due tomorrow', context)?.replacement).toBe('due: 2026-04-13')
    expect(resolveEditorAtMacro('priority high', context)?.replacement).toBe('priority: high')
    expect(resolveEditorAtMacro('deadline +7d', context)).toBeNull()
  })

  it('resolves task macros as markdown checklists', () => {
    expect(resolveEditorAtMacro('task', context)).toMatchObject({
      kind: 'insert_markdown',
      replacement: '- [ ] '
    })
    expect(resolveEditorAtMacro('task.today', context)).toMatchObject({
      kind: 'insert_markdown',
      replacement: '- [ ]  -- due: 2026-04-12'
    })
  })

  it('falls back to the file name when the note title is empty', () => {
    const title = resolveEditorAtMacro('title', {
      title: '',
      path: '/vault/notes/planning.md',
      now: new Date(2026, 3, 12, 8, 5, 0)
    })

    expect(title?.replacement).toBe('planning')
  })

  it('adds workspace templates as markdown macro entries', () => {
    const entries = buildEditorAtMacroEntries({
      ...context,
      templates: [
        {
          path: '/vault/_templates/meetings/weekly.md',
          label: 'weekly.md',
          relativePath: 'meetings/weekly.md',
          group: 'meetings'
        }
      ]
    })
    const template = entries.find((entry) => entry.id === 'template:meetings/weekly.md')

    expect(template).toMatchObject({
      label: 'weekly.md',
      group: 'Templates',
      kind: 'insert_markdown',
      preview: 'meetings/weekly.md',
      templatePath: '/vault/_templates/meetings/weekly.md'
    })
    expect(editorAtMacroMatchesQuery(template!, 'weekly')).toBe(true)
    expect(editorAtMacroMatchesQuery(template!, 'template')).toBe(true)
  })

  it('does not register or resolve removed transformation macros', () => {
    const removed = ['summarize', 'summary', 'rewrite', 'expand', 'extract.tasks', 'extract.decisions', 'extract.risks', 'ask', 'brief', 'title.ai', 'tags.auto']
    const entries = buildEditorAtMacroEntries(context)
    for (const id of removed) {
      expect(listEditorAtMacroIds()).not.toContain(id)
      expect(entries.some(entry => entry.id === id)).toBe(false)
      expect(resolveEditorAtMacro(id, context)).toBeNull()
    }
  })

  it('matches aliases and exposes argument-capable query detection', () => {
    expect(editorAtMacroMatchesQuery(resolveEditorAtMacro('task', context)!, 'todo')).toBe(true)
    expect(canContinueEditorAtMacroArgument('date ')).toBe(true)
    expect(canContinueEditorAtMacroArgument('priority ')).toBe(true)
    expect(canContinueEditorAtMacroArgument('meeting ')).toBe(false)
  })

  it('exposes stable macro ids', () => {
    expect(listEditorAtMacroIds()).toContain('today')
    expect(listEditorAtMacroIds()).toContain('task')
    expect(listEditorAtMacroIds()).toContain('tags')
  })
})
