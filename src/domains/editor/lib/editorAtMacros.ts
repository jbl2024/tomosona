/**
 * Pure editor macro catalog for text, markdown templates, tasks and note context.
 * Runtime insertion is owned by the editor menu composable.
 */
export type EditorAtMacroKind = 'insert_text' | 'insert_markdown' | 'dynamic_pick'

export type EditorAtMacroGroup = 'Time' | 'Document' | 'Templates' | 'Tasks' | 'Context'

export type EditorAtTemplateMacro = {
  path: string
  label: string
  relativePath: string
  group: string
}

export type EditorAtMacroContext = {
  title: string
  path: string
  now: Date
  bodyText?: string
  tags?: string[]
  backlinks?: string[]
  createdAt?: Date | null
  updatedAt?: Date | null
  userName?: string
  templates?: EditorAtTemplateMacro[]
}

export type EditorAtMacroEntry = {
  id: string
  label: string
  group: EditorAtMacroGroup
  kind: EditorAtMacroKind
  description: string
  replacement: string
  preview: string
  aliases: string[]
  templatePath?: string
}

type MacroDefinition = {
  id: string
  label: string
  group: EditorAtMacroGroup
  kind: EditorAtMacroKind
  description: string
  aliases: string[]
  acceptsArgument?: boolean
  resolve: (context: NormalizedMacroContext, argument: string) => Pick<EditorAtMacroEntry, 'replacement' | 'preview'>
}

type NormalizedMacroContext = Required<Omit<EditorAtMacroContext, 'createdAt' | 'updatedAt'>> & {
  createdAt: Date | null
  updatedAt: Date | null
}

const MACRO_IDS = [
  'today',
  'now',
  'yesterday',
  'tomorrow',
  'week',
  'month',
  'timestamp',
  'date-fr',
  'date',
  'title',
  'path',
  'filename',
  'folder',
  'created_at',
  'updated_at',
  'word_count',
  'tags',
  'backlinks',
  'task',
  'task.today',
  'task.me',
  'due',
  'priority',
  'blocked',
  'waiting',
  'link',
  'mention',
  'project',
  'source',
  'quote',
  'context',
  'related',
] as const

const FRENCH_MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre'
]

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function atStartOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = atStartOfLocalDay(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatLocalDateTime(date: Date): string {
  return `${formatLocalDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatLocalTimestamp(date: Date): string {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatFrenchDate(date: Date): string {
  return `${date.getDate()} ${FRENCH_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function isoWeek(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${utc.getUTCFullYear()}-W${pad(week)}`
}

function fallbackTitleFromPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  const filename = trimmed.split(/[\\/]/).pop() ?? trimmed
  return filename.replace(/\.(md|markdown)$/i, '')
}

function folderNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2) return ''
  return segments[segments.length - 2] ?? ''
}

function fileNameFromPath(path: string): string {
  return path.trim().replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
}

function normalizeDocumentTitle(title: string, path: string): string {
  const trimmedTitle = title.trim()
  if (trimmedTitle) return trimmedTitle
  return fallbackTitleFromPath(path)
}

function normalizeContext(context: EditorAtMacroContext): NormalizedMacroContext {
  return {
    title: normalizeDocumentTitle(context.title, context.path),
    path: context.path.trim(),
    now: context.now,
    bodyText: context.bodyText ?? '',
    tags: context.tags ?? [],
    backlinks: context.backlinks ?? [],
    createdAt: context.createdAt ?? null,
    updatedAt: context.updatedAt ?? null,
    userName: context.userName?.trim() || 'me',
    templates: context.templates ?? []
  }
}

function wordCount(text: string): number {
  const words = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu)
  return words?.length ?? 0
}

function parseDayOffset(argument: string): number | null {
  const match = argument.trim().match(/^\+?(-?\d+)(?:d|day|days)?$/i)
  if (!match) return null
  return Number.parseInt(match[1], 10)
}

function parseDateArgument(argument: string, now: Date): Date {
  const trimmed = argument.trim().toLowerCase()
  if (!trimmed || trimmed === 'today') return atStartOfLocalDay(now)
  if (trimmed === 'tomorrow') return addDays(now, 1)
  if (trimmed === 'yesterday') return addDays(now, -1)
  const offset = parseDayOffset(trimmed)
  return offset === null ? atStartOfLocalDay(now) : addDays(now, offset)
}

function text(value: string): Pick<EditorAtMacroEntry, 'replacement' | 'preview'> {
  return { replacement: value, preview: value }
}

function markdown(value: string, preview?: string): Pick<EditorAtMacroEntry, 'replacement' | 'preview'> {
  return { replacement: value, preview: preview ?? value.split('\n')[0] ?? '' }
}

const TASK_TEMPLATE = '- [ ] '

const MACRO_DEFINITIONS: MacroDefinition[] = [
  {
    id: 'today',
    label: 'Today',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert the current local date',
    aliases: ['today', 'date'],
    resolve: ({ now }) => text(formatLocalDate(now))
  },
  {
    id: 'now',
    label: 'Now',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert the current local date and time',
    aliases: ['now', 'datetime', 'date time'],
    resolve: ({ now }) => text(formatLocalDateTime(now))
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert yesterday as a local date',
    aliases: ['yesterday', 'hier'],
    resolve: ({ now }) => text(formatLocalDate(addDays(now, -1)))
  },
  {
    id: 'tomorrow',
    label: 'Tomorrow',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert tomorrow as a local date',
    aliases: ['tomorrow', 'demain'],
    resolve: ({ now }) => text(formatLocalDate(addDays(now, 1)))
  },
  {
    id: 'week',
    label: 'This week',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert the current ISO week',
    aliases: ['week', 'semaine', 'hebdo'],
    resolve: ({ now }) => text(isoWeek(now))
  },
  {
    id: 'month',
    label: 'This month',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert the current month',
    aliases: ['month', 'mois', 'reporting'],
    resolve: ({ now }) => text(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)
  },
  {
    id: 'timestamp',
    label: 'Timestamp',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert a local ISO-like timestamp',
    aliases: ['timestamp', 'log', 'trace'],
    resolve: ({ now }) => text(formatLocalTimestamp(now))
  },
  {
    id: 'date-fr',
    label: 'French date',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert a readable French date',
    aliases: ['date-fr', 'date francaise', 'date lisible'],
    resolve: ({ now }) => text(formatFrenchDate(now))
  },
  {
    id: 'date',
    label: 'Date offset',
    group: 'Time',
    kind: 'insert_text',
    description: 'Insert today or a relative date',
    aliases: ['date', 'date+7', 'date +7'],
    acceptsArgument: true,
    resolve: ({ now }, argument) => text(formatLocalDate(parseDateArgument(argument, now)))
  },
  {
    id: 'title',
    label: 'Title',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the current note title',
    aliases: ['title', 'note title', 'document title'],
    resolve: ({ title }) => text(title)
  },
  {
    id: 'path',
    label: 'Path',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the current note path',
    aliases: ['path', 'file path', 'note path'],
    resolve: ({ path }) => text(path)
  },
  {
    id: 'filename',
    label: 'Filename',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the current file name',
    aliases: ['filename', 'file', 'nom fichier'],
    resolve: ({ path }) => text(fileNameFromPath(path))
  },
  {
    id: 'folder',
    label: 'Folder',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the current folder name',
    aliases: ['folder', 'directory', 'dossier'],
    resolve: ({ path }) => text(folderNameFromPath(path))
  },
  {
    id: 'created_at',
    label: 'Created at',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the known creation date',
    aliases: ['created_at', 'created', 'creation'],
    resolve: ({ createdAt }) => text(createdAt ? formatLocalDate(createdAt) : '')
  },
  {
    id: 'updated_at',
    label: 'Updated at',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the known update date',
    aliases: ['updated_at', 'updated', 'modified'],
    resolve: ({ updatedAt }) => text(updatedAt ? formatLocalDate(updatedAt) : '')
  },
  {
    id: 'word_count',
    label: 'Word count',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the current note word count',
    aliases: ['word_count', 'words', 'count'],
    resolve: ({ bodyText }) => text(String(wordCount(bodyText)))
  },
  {
    id: 'tags',
    label: 'Tags',
    group: 'Document',
    kind: 'insert_text',
    description: 'Insert the current note tags',
    aliases: ['tags', 'tag'],
    resolve: ({ tags }) => text(tags.join(', '))
  },
  {
    id: 'backlinks',
    label: 'Backlinks',
    group: 'Document',
    kind: 'insert_markdown',
    description: 'Insert known backlinks for the current note',
    aliases: ['backlinks', 'linked mentions'],
    resolve: ({ backlinks }) => markdown(backlinks.map((path) => `- [[${path}]]`).join('\n'), `${backlinks.length} backlink${backlinks.length === 1 ? '' : 's'}`)
  },
  {
    id: 'task',
    label: 'Task',
    group: 'Tasks',
    kind: 'insert_markdown',
    description: 'Insert a checklist task',
    aliases: ['task', 'todo', 'checklist'],
    resolve: () => markdown(TASK_TEMPLATE, TASK_TEMPLATE)
  },
  {
    id: 'task.today',
    label: 'Task due today',
    group: 'Tasks',
    kind: 'insert_markdown',
    description: 'Insert a checklist task due today',
    aliases: ['task.today', 'todo today', 'task due today'],
    resolve: ({ now }) => markdown(`- [ ]  -- due: ${formatLocalDate(now)}`)
  },
  {
    id: 'task.me',
    label: 'Task assigned to me',
    group: 'Tasks',
    kind: 'insert_markdown',
    description: 'Insert a checklist task assigned to the current user',
    aliases: ['task.me', 'todo me', 'assigned'],
    resolve: ({ userName }) => markdown(`- [ ]  -- assignee: ${userName}`)
  },
  {
    id: 'due',
    label: 'Due',
    group: 'Tasks',
    kind: 'insert_text',
    description: 'Insert a due-date marker',
    aliases: ['due', 'deadline marker', 'echeance'],
    acceptsArgument: true,
    resolve: ({ now }, argument) => text(`due: ${formatLocalDate(parseDateArgument(argument || 'today', now))}`)
  },
  {
    id: 'priority',
    label: 'Priority',
    group: 'Tasks',
    kind: 'insert_text',
    description: 'Insert a priority marker',
    aliases: ['priority', 'prio', 'high', 'medium', 'low'],
    acceptsArgument: true,
    resolve: (_context, argument) => text(`priority: ${(argument.trim() || 'medium').toLowerCase()}`)
  },
  {
    id: 'blocked',
    label: 'Blocked',
    group: 'Tasks',
    kind: 'insert_text',
    description: 'Insert a blocked status marker',
    aliases: ['blocked', 'bloque', 'stuck'],
    resolve: () => text('status: blocked')
  },
  {
    id: 'waiting',
    label: 'Waiting',
    group: 'Tasks',
    kind: 'insert_text',
    description: 'Insert a waiting status marker',
    aliases: ['waiting', 'attente', 'retour'],
    resolve: () => text('status: waiting')
  },
  {
    id: 'link',
    label: 'Link',
    group: 'Context',
    kind: 'dynamic_pick',
    description: 'Insert a note link placeholder',
    aliases: ['link', 'wikilink', 'note link'],
    resolve: () => text('[[ ]]')
  },
  {
    id: 'mention',
    label: 'Mention',
    group: 'Context',
    kind: 'dynamic_pick',
    description: 'Insert a mention placeholder',
    aliases: ['mention', 'person', 'people'],
    resolve: () => text('@')
  },
  {
    id: 'project',
    label: 'Project',
    group: 'Context',
    kind: 'dynamic_pick',
    description: 'Insert a project link placeholder',
    aliases: ['project', 'projet'],
    resolve: () => text('[[Projects/]]')
  },
  {
    id: 'source',
    label: 'Source',
    group: 'Context',
    kind: 'insert_markdown',
    description: 'Insert a source/reference block',
    aliases: ['source', 'reference', 'ref'],
    resolve: () => markdown(`> Source: `, 'Source block')
  },
  {
    id: 'quote',
    label: 'Quote',
    group: 'Context',
    kind: 'insert_markdown',
    description: 'Insert a quote block',
    aliases: ['quote', 'citation'],
    resolve: () => markdown('> ', 'Quote block')
  },
  {
    id: 'context',
    label: 'Context',
    group: 'Context',
    kind: 'insert_markdown',
    description: 'Insert a context block',
    aliases: ['context', 'contexte'],
    resolve: () => markdown(`### Context

`, 'Context section')
  },
  {
    id: 'related',
    label: 'Related notes',
    group: 'Context',
    kind: 'dynamic_pick',
    description: 'Insert a related notes section',
    aliases: ['related', 'notes liees'],
    resolve: ({ backlinks }) => markdown(['### Related', ...backlinks.slice(0, 5).map((path) => `- [[${path}]]`)].join('\n'), 'Related notes')
  },
]

function splitToken(token: string): { id: string; argument: string } {
  const trimmed = token.trim().toLowerCase()
  const compactOffset = trimmed.match(/^(date)([+-]\d+(?:d)?)$/)
  if (compactOffset) return { id: compactOffset[1], argument: compactOffset[2] }

  const firstSpace = trimmed.search(/\s/)
  if (firstSpace > 0) {
    return {
      id: trimmed.slice(0, firstSpace),
      argument: trimmed.slice(firstSpace + 1).trim()
    }
  }

  return { id: trimmed, argument: '' }
}

function resolveDefinition(definition: MacroDefinition, context: NormalizedMacroContext, argument = ''): EditorAtMacroEntry {
  const resolved = definition.resolve(context, argument)
  return {
    id: definition.id,
    label: definition.label,
    group: definition.group,
    kind: definition.kind,
    description: definition.description,
    aliases: definition.aliases,
    replacement: resolved.replacement,
    preview: resolved.preview,
  }
}

function templateMacroId(template: EditorAtTemplateMacro): string {
  return `template:${template.relativePath.toLowerCase()}`
}

function buildTemplateMacroEntries(context: NormalizedMacroContext): EditorAtMacroEntry[] {
  return context.templates.map((template) => ({
    id: templateMacroId(template),
    label: template.label,
    group: 'Templates',
    kind: 'insert_markdown',
    description: `Insert template ${template.relativePath}`,
    replacement: '',
    preview: template.relativePath,
    aliases: [
      'template',
      template.label,
      template.relativePath,
      template.group
    ],
    templatePath: template.path
  }))
}

/**
 * Builds the current set of editor `@` macros.
 */
export function buildEditorAtMacroEntries(context: EditorAtMacroContext, token = ''): EditorAtMacroEntry[] {
  const normalizedContext = normalizeContext(context)
  const { id, argument } = splitToken(token)
  const exactArgumentDefinition = MACRO_DEFINITIONS.find((definition) => definition.id === id && definition.acceptsArgument)
  if (exactArgumentDefinition && argument) {
    return [resolveDefinition(exactArgumentDefinition, normalizedContext, argument)]
  }
  return [
    ...MACRO_DEFINITIONS.map((definition) => resolveDefinition(definition, normalizedContext)),
    ...buildTemplateMacroEntries(normalizedContext)
  ]
}

/**
 * Resolves a known macro token to an executable macro entry.
 */
export function resolveEditorAtMacro(token: string, context: EditorAtMacroContext): EditorAtMacroEntry | null {
  const normalizedContext = normalizeContext(context)
  const { id, argument } = splitToken(token)
  const definition = MACRO_DEFINITIONS.find((macro) => macro.id === id)
  if (!definition) return null
  return resolveDefinition(definition, normalizedContext, definition.acceptsArgument ? argument : '')
}

/**
 * Returns whether a query can include spaces after the current macro id.
 */
export function canContinueEditorAtMacroArgument(query: string): boolean {
  const trimmed = query.trimStart().toLowerCase()
  if (!trimmed) return false
  const first = trimmed.split(/\s+/, 1)[0] ?? ''
  return MACRO_DEFINITIONS.some((definition) => definition.id === first && definition.acceptsArgument)
}

/**
 * Returns whether an entry matches a menu query or alias.
 */
export function editorAtMacroMatchesQuery(entry: EditorAtMacroEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const { id } = splitToken(needle)
  if (entry.id === id) return true
  const aliases = [entry.id, entry.label, entry.group, entry.description, entry.kind, ...entry.aliases]
  return aliases.some((value) => value.toLowerCase().includes(needle))
}

/**
 * Returns the stable macro ids supported by the editor.
 */
export function listEditorAtMacroIds(): Array<(typeof MACRO_IDS)[number]> {
  return [...MACRO_IDS]
}
