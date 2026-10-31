import { computed, ref, watch, type Ref } from 'vue'
import type { LaunchpadRecentNote } from '../lib/appShellViewModels'
import {
  compareNoteMatches,
  matchCommand,
  matchNoteTitle,
  normalizePaletteText,
  type CommandMatchKind,
  type NoteTitleMatchKind
} from '../lib/paletteSearch'
import { contextSuggestionIds, paletteContextKind, type PaletteContextSnapshot } from '../lib/paletteContext'
import { COMMAND_USAGE_RECENT_LIMIT, type CommandUsage } from '../lib/appShellPersistence'

/**
 * Module: useAppQuickOpen
 *
 * Purpose:
 * - Derive quick-open and command-palette state from workspace files and actions.
 */

/** Browse cap for recent notes: the initial state stays deliberately short. */
const BROWSE_RECENT_LIMIT = 3

/** Cap for personalized commands shown in the browse state. */
const BROWSE_HABIT_LIMIT = 5
/** Maximum note results shown for a query (source spec: six to eight visible). */
const NOTE_RESULT_LIMIT = 6
/** Maximum command results mixed into a universal query. */
const COMMAND_RESULT_LIMIT = 3
/** Maximum notes with content matches; one file must not flood the list. */
const CONTENT_NOTE_LIMIT = 5
/** Maximum passages grouped under a single note. */
const PASSAGES_PER_NOTE_LIMIT = 5
/** Debounce before hitting the search index (progressive results). */
const CONTENT_SEARCH_DEBOUNCE_MS = 180

/** Represents a row shown in quick-open, either an existing file or a daily-note shortcut. */
export type QuickOpenResult =
  | { kind: 'file'; path: string; label: string }
  | { kind: 'daily'; date: string; path: string; label: string; exists: boolean }
  | { kind: 'recent'; path: string; label: string; recencyLabel: string }
  | { kind: 'favorite'; path: string; label: string }

/** Represents a frequent action shown in quick-open browse mode. */
export type QuickOpenBrowseAction = {
  kind: 'action'
  id: string
  label: string
}

/** Secondary actions offered behind Tab on a note result. */
export type PaletteTabActionId = 'copy-link' | 'toggle-favorite' | 'open-new-tab' | 'open-adjacent' | 'reveal-location'

/** One row of the secondary-actions menu attached to a note result. */
export type QuickOpenTabMenuItem = {
  id: PaletteTabActionId
  label: string
}

/** Identifies the note a secondary-actions menu is attached to, plus the menu cursor. */
export type QuickOpenTabMenu = {
  path: string
  title: string
  itemIndex: number
}

export type QuickOpenBrowseItem = QuickOpenResult | QuickOpenBrowseAction

/** Palette families keep command palette sections stable and scannable. */
export type PaletteActionFamily =
  | 'navigation'
  | 'notes'
  | 'search'
  | 'workspace'
  | 'view'
  | 'layout'
  | 'theme'
  | 'utilities'

/** Describes a command-palette action shown in quick-open action mode. */
export type PaletteAction = {
  id: string
  label: string
  family: PaletteActionFamily
  run: () => boolean | Promise<boolean>
  closeBeforeRun?: boolean
  /** Extra search formulations that reach this command, e.g. ["docx", "convertir"]. */
  keywords?: string[]
  /** One-line description of the command's effect, shown under the label. */
  description?: string
  /** Right-aligned keyboard shortcut, when the command has one. */
  shortcutLabel?: string
  /**
   * Availability evaluated when results are derived. Unavailable commands are
   * hidden from the default listing but stay visible when they explicitly
   * match the query, so the user understands what is missing and why.
   */
  isEnabled?: () => boolean
  /** Why the command is currently unavailable, shown next to its disabled row. */
  unavailableReason?: string
}

/**
 * Unified palette result rows. One model feeds notes, content passages,
 * commands, and the create action, grouped by visible category.
 */
export type PaletteResult =
  | { kind: 'note'; path: string; title: string; folder: string; matchKind: NoteTitleMatchKind }
  | { kind: 'passage'; path: string; title: string; folder: string; matches: PalettePassageMatch[] }
  | { kind: 'command'; actionId: string; label: string; matchKind: CommandMatchKind }
  | { kind: 'create'; title: string }
  | { kind: 'daily'; date: string; path: string; exists: boolean }
  | { kind: 'help'; id: string; label: string; description: string }

export type PaletteResultCategoryId = 'daily' | 'notes' | 'content' | 'commands' | 'help' | 'create'

/** A rendered category section: header plus its slice of the flat result list. */
export type PaletteResultCategory = {
  id: PaletteResultCategoryId
  label: string
  results: PaletteResult[]
  startIndex: number
}

const PALETTE_CATEGORY_LABELS: Record<PaletteResultCategoryId, string> = {
  daily: 'Daily note',
  notes: 'Notes',
  content: 'In content',
  commands: 'Commands',
  help: 'Help',
  create: 'Create'
}

/**
 * Curated help entries for the `?` mode: each opens the existing shortcuts
 * surface pre-filtered on its topic, so help stays a discovery layer over
 * in-app documentation rather than a parallel one.
 */
const HELP_ENTRIES: Array<{ id: string; label: string; description: string; keywords: string[] }> = [
  { id: 'help-shortcuts', label: 'All Shortcuts', description: 'Browse every keyboard shortcut', keywords: ['raccourcis', 'shortcuts', 'keyboard'] },
  { id: 'help-links', label: 'Links Between Notes', description: 'Create and open wikilinks', keywords: ['link', 'wikilink', 'lien', 'liens'] },
  { id: 'help-backlinks', label: 'Backlinks', description: 'See which notes link here', keywords: ['backlink', 'backlinks', 'references'] },
  { id: 'help-daily-notes', label: 'Daily Notes', description: 'Journal, today, and yesterday', keywords: ['daily', 'journal', 'today', 'hier'] },
  { id: 'help-search', label: 'Searching Notes', description: 'Find notes by title or content', keywords: ['search', 'recherche', 'find'] },
  { id: 'help-panes', label: 'Panes and Tabs', description: 'Split, focus, and close editor panes', keywords: ['pane', 'tab', 'split', 'onglet'] }
]

/** Universal palette search mode, derived from the optional query prefix. */
export type PaletteMode = 'universal' | 'commands' | 'content' | 'help'

/**
 * Where a palette result opens: the active pane (Enter), forced as a new tab
 * in the active pane (Cmd+Enter), or the adjacent pane (Alt+Enter, degrading
 * to a new tab in the active pane when no other pane exists).
 */
export type PaletteOpenTarget = 'active' | 'new-tab' | 'adjacent'

/** One grouped content match inside a passage result. */
export type PalettePassageMatch = {
  snippet: string
  section?: string
}

/**
 * Async full-text search adapter over the workspace index (ftsSearch).
 * Injected so tests and non-index surfaces stay synchronous.
 */
export type AppQuickOpenContentPort = {
  searchNoteContent: (query: string) => Promise<Array<{ path: string; snippet: string; score: number }>>
}

/** Represents a grouped command-palette section in action mode. */
export type QuickOpenActionGroup = {
  family: PaletteActionFamily
  label: string
  items: PaletteAction[]
}

/** Groups the workspace-backed inputs required to derive file quick-open results. */
export type AppQuickOpenDataPort = {
  allWorkspaceFiles: Ref<string[]>
  workingFolderPath: Ref<string>
  recentViewedNotes: Ref<LaunchpadRecentNote[]>
  /** Favorite note paths, suggested in the browse state without duplicates. */
  favoritePaths?: Ref<string[]>
  /** Path of the active note; its folder is used as a ranking tie-breaker. */
  activeFilePath?: Ref<string>
}

/** Groups document/path helpers so quick-open does not take a flat list of callbacks. */
export type AppQuickOpenDocumentPort = {
  isIsoDate: (value: string) => boolean
  toRelativePath: (path: string) => string
  dailyNotePath: (root: string, date: string) => string
}

/** Groups command palette inputs used only in action mode. */
export type AppQuickOpenPalettePort = {
  paletteActions: Ref<PaletteAction[]>
  paletteActionPriority: Record<string, number>
}

/** Frozen opening context feeding the browse-state suggestions. */
export type AppQuickOpenContextPort = {
  snapshot: Readonly<Ref<PaletteContextSnapshot>>
}

/**
 * Provides the grouped dependencies required to derive quick-open state.
 *
 * Ports keep workspace, document, and palette concerns readable without hiding
 * the optional controlled state refs, which remain top-level on purpose.
 */
export type UseAppQuickOpenOptions = {
  quickOpenDataPort: AppQuickOpenDataPort
  quickOpenDocumentPort: AppQuickOpenDocumentPort
  quickOpenPalettePort: AppQuickOpenPalettePort
  /** Optional content search; absent surfaces simply show no passages. */
  quickOpenContentPort?: AppQuickOpenContentPort
  /** Optional frozen opening context for the browse suggestions. */
  quickOpenContextPort?: AppQuickOpenContextPort
  /** Optional controlled command usage for browse personalization. */
  commandUsage?: Ref<CommandUsage>
  /** Debounce override for tests. */
  contentSearchDebounceMs?: number
  quickOpenQuery?: Ref<string>
  quickOpenActiveIndex?: Ref<number>
}

function normalizeSearchText(value: string) {
  return normalizePaletteText(value)
}

const QUICK_OPEN_BROWSE_ACTION_IDS = [
  'open-home-view',
  'open-today',
  'create-new-file',
  'convert-to-word',
  'open-favorites'
] as const

const PALETTE_ACTION_FAMILY_META: Record<PaletteActionFamily, { label: string; order: number }> = {
  navigation: { label: 'Navigation', order: 0 },
  notes: { label: 'Notes', order: 1 },
  search: { label: 'Search', order: 2 },
  workspace: { label: 'Workspace', order: 3 },
  view: { label: 'View', order: 4 },
  layout: { label: 'Layout', order: 5 },
  theme: { label: 'Theme', order: 6 },
  utilities: { label: 'Utilities', order: 7 }
}

/**
 * Derives quick-open search results, action matches, and list navigation state.
 */
export function useAppQuickOpen(options: UseAppQuickOpenOptions) {
  const { quickOpenDataPort, quickOpenDocumentPort, quickOpenPalettePort } = options
  const quickOpenQuery = options.quickOpenQuery ?? ref('')

  /**
   * Command usage habits for browse personalization. Controlled ref so
   * App.vue seeds it from storage and persists changes; recording moves the
   * command to the front of recents (deduplicated, capped) and accumulates
   * its frequency count.
   */
  const commandUsage = options.commandUsage ?? ref<CommandUsage>({ counts: {}, recent: [] })

  function recordQuickOpenCommandUsage(id: string) {
    const usage = commandUsage.value
    commandUsage.value = {
      counts: { ...usage.counts, [id]: (usage.counts[id] ?? 0) + 1 },
      recent: [id, ...usage.recent.filter((recentId) => recentId !== id)].slice(0, COMMAND_USAGE_RECENT_LIMIT)
    }
  }
  const quickOpenActiveIndex = options.quickOpenActiveIndex ?? ref(0)
  /**
   * Content results from the search index, grouped one row per note. They
   * arrive asynchronously and merge below the note category without moving
   * the current selection.
   */
  const passageResults = ref<PaletteResult[]>([])
  const contentDebounceMs = options.contentSearchDebounceMs ?? CONTENT_SEARCH_DEBOUNCE_MS
  let passageSearchTimer: ReturnType<typeof setTimeout> | null = null
  let passageSearchEpoch = 0

  const quickOpenIsActionMode = computed(() => quickOpenQuery.value.trimStart().startsWith('>'))
  const quickOpenHasTextQuery = computed(() =>
    !quickOpenIsActionMode.value && quickOpenQuery.value.trim().length > 0
  )
  const quickOpenActionQuery = computed(() => quickOpenQuery.value.trimStart().slice(1).trim().toLowerCase())

  const quickOpenResults = computed<QuickOpenResult[]>(() => {
    if (!quickOpenHasTextQuery.value) return []
    const rawQuery = quickOpenQuery.value.trim()
    const q = normalizeSearchText(rawQuery)

    const fileResults = quickOpenDataPort.allWorkspaceFiles.value
      .filter((path) => {
        const relativePath = quickOpenDocumentPort.toRelativePath(path)
        return normalizeSearchText(path).includes(q) || normalizeSearchText(relativePath).includes(q)
      })
      .map((path) => ({ kind: 'file' as const, path, label: quickOpenDocumentPort.toRelativePath(path) }))
      .slice(0, 80)

    if (!quickOpenDocumentPort.isIsoDate(rawQuery) || !quickOpenDataPort.workingFolderPath.value) {
      return fileResults
    }

    const path = quickOpenDocumentPort.dailyNotePath(quickOpenDataPort.workingFolderPath.value, rawQuery)
    const exists = quickOpenDataPort.allWorkspaceFiles.value.some((item) => item.toLowerCase() === path.toLowerCase())
    const dateResult: QuickOpenResult = {
      kind: 'daily',
      date: rawQuery,
      path,
      exists,
      label: exists ? `Open daily note ${rawQuery}` : `Create daily note ${rawQuery}`
    }

    return [dateResult, ...fileResults]
  })

  const quickOpenBrowseRecentResults = computed<QuickOpenResult[]>(() => {
    if (quickOpenIsActionMode.value || quickOpenHasTextQuery.value) return []
    return quickOpenDataPort.recentViewedNotes.value.slice(0, BROWSE_RECENT_LIMIT).map((item) => ({
      kind: 'recent' as const,
      path: item.path,
      label: item.relativePath,
      recencyLabel: item.recencyLabel
    }))
  })

  const quickOpenBrowseActionResults = computed<QuickOpenBrowseAction[]>(() => {
    if (quickOpenIsActionMode.value || quickOpenHasTextQuery.value) return []
    const byId = new Map(quickOpenPalettePort.paletteActions.value.map((item) => [item.id, item] as const))
    // Habits only shape the empty-query browse state: recently used commands
    // come first (most recent first), then frequency, then the static quick
    // actions to fill the section. Explicit queries always rank by relevance.
    const usage = commandUsage.value
    const habitIds = [
      ...usage.recent,
      ...Object.keys(usage.counts).sort((left, right) => usage.counts[right] - usage.counts[left])
    ]
    const ids: string[] = []
    for (const id of [...habitIds, ...QUICK_OPEN_BROWSE_ACTION_IDS]) {
      if (byId.has(id) && !ids.includes(id)) ids.push(id)
      if (ids.length >= BROWSE_HABIT_LIMIT) break
    }
    return ids
      .map((id) => {
        const action = byId.get(id)
        if (!action) return null
        return {
          kind: 'action' as const,
          id: action.id,
          label: action.label
        }
      })
      .filter((item): item is QuickOpenBrowseAction => Boolean(item))
  })

  const quickOpenBrowseItems = computed<QuickOpenBrowseItem[]>(() => [
    ...quickOpenContextSuggestions.value,
    ...quickOpenBrowseRecentResults.value,
    ...quickOpenBrowseFavoriteResults.value,
    ...quickOpenBrowseActionResults.value
  ])

  /**
   * Context suggestions ranked first in the browse state: ids resolved from
   * the frozen opening snapshot, filtered to actions the catalog actually
   * provides so the browse never suggests dead entries.
   */
  const quickOpenContextSuggestions = computed<QuickOpenBrowseAction[]>(() => {
    const port = options.quickOpenContextPort
    if (!port) return []
    const ids = contextSuggestionIds(paletteContextKind(port.snapshot.value))
    const byId = new Map(quickOpenPalettePort.paletteActions.value.map((item) => [item.id, item] as const))
    return ids
      .map((id) => byId.get(id))
      .filter((item): item is PaletteAction => Boolean(item))
      .map((item) => ({ kind: 'action' as const, id: item.id, label: item.label }))
  })

  const quickOpenActionResults = computed(() => {
    if (!quickOpenIsActionMode.value) return []
    const q = quickOpenActionQuery.value
    const entries = quickOpenPalettePort.paletteActions.value
      .map((item) => {
        const available = item.isEnabled ? item.isEnabled() : true
        const match = q ? matchCommand(item.label, item.keywords ?? [], q) : null
        const priority = quickOpenPalettePort.paletteActionPriority[item.id] ?? Number.MAX_SAFE_INTEGER
        return { item, available, match, priority }
      })
      .filter((entry) => (q ? Boolean(entry.match) : entry.available))
      .sort((left, right) => {
        const leftScore = left.match?.score ?? 0
        const rightScore = right.match?.score ?? 0
        if (leftScore !== rightScore) return rightScore - leftScore
        if (left.available !== right.available) return left.available ? -1 : 1
        return left.priority - right.priority || left.item.label.localeCompare(right.item.label)
      })

    return entries.map((entry) => entry.item)
  })

  const quickOpenActionGroups = computed<QuickOpenActionGroup[]>(() => {
    if (!quickOpenIsActionMode.value) return []
    const groups = new Map<PaletteActionFamily, PaletteAction[]>()
    for (const item of quickOpenActionResults.value) {
      const items = groups.get(item.family)
      if (items) {
        items.push(item)
        continue
      }
      groups.set(item.family, [item])
    }

    return (Object.entries(PALETTE_ACTION_FAMILY_META) as Array<
      [PaletteActionFamily, (typeof PALETTE_ACTION_FAMILY_META)[PaletteActionFamily]]
    >)
      .sort((left, right) => left[1].order - right[1].order)
      .flatMap(([family, meta]) => {
        const items = groups.get(family)
        if (!items?.length) return []
        return [{ family, label: meta.label, items }]
      })
  })

  /**
   * Search mode derived from the optional, reversible query prefix:
   * `>` commands, `#` content, `?` help, otherwise universal.
   */
  const quickOpenMode = computed<PaletteMode>(() => {
    const raw = quickOpenQuery.value.trimStart()
    if (raw.startsWith('>')) return 'commands'
    if (raw.startsWith('#')) return 'content'
    if (raw.startsWith('?')) return 'help'
    return 'universal'
  })

  const rawQueryText = computed(() => {
    const raw = quickOpenQuery.value.trimStart()
    if (raw.startsWith('>') || raw.startsWith('#') || raw.startsWith('?')) {
      return raw.slice(1).trim()
    }
    return raw.trim()
  })

  function noteTitleOf(path: string): string {
    const relative = quickOpenDocumentPort.toRelativePath(path)
    const name = relative.split('/').pop() ?? relative
    return name.replace(/\.(md|markdown)$/i, '') || name
  }

  function noteFolderOf(path: string): string {
    const relative = quickOpenDocumentPort.toRelativePath(path)
    const segments = relative.split('/')
    segments.pop()
    return segments.join('/')
  }

  /**
   * Unrolls index hits into one flat passage row per match (capped per note
   * and in total), merged into the unified list below the notes while keeping
   * the selected item stable: insertion points at or after the current
   * selection shift the index. Flat rows make every match reachable by
   * keyboard and hover; the modal renders consecutive same-note rows as one
   * visual group.
   */
  function applyPassageHits(hits: Array<{ path: string; snippet: string; score: number }>) {
    const rows: PaletteResult[] = []
    const perNoteCount = new Map<string, number>()
    const notedPaths = new Set<string>()
    for (const hit of hits) {
      // Snippets keep the index's `<b>` markers so the palette can bold the
      // matched terms; the editor reveal strips tags on its own.
      if (!hit.snippet.trim()) continue
      const count = perNoteCount.get(hit.path) ?? 0
      if (count >= PASSAGES_PER_NOTE_LIMIT) continue
      if (count === 0) {
        if (notedPaths.size >= CONTENT_NOTE_LIMIT) continue
        notedPaths.add(hit.path)
      }
      perNoteCount.set(hit.path, count + 1)
      rows.push({
        kind: 'passage' as const,
        path: hit.path,
        title: noteTitleOf(hit.path),
        folder: noteFolderOf(hit.path),
        matches: [{ snippet: hit.snippet }]
      })
    }

    const previous = paletteResults.value
    const insertionIndex = previous.findIndex((result) => result.kind === 'command' || result.kind === 'create')
    if (insertionIndex >= 0 && quickOpenActiveIndex.value >= insertionIndex) {
      quickOpenActiveIndex.value += rows.length
    }
    passageResults.value = rows
  }

  watch(
    [rawQueryText, quickOpenMode],
    ([query, mode]) => {
      passageSearchEpoch += 1
      if (passageSearchTimer) clearTimeout(passageSearchTimer)
      passageResults.value = []

      const contentPort = options.quickOpenContentPort
      if (!contentPort || !query) return
      const contentSearchActive = mode === 'content' || mode === 'universal'
      if (!contentSearchActive) return

      const epoch = passageSearchEpoch
      passageSearchTimer = setTimeout(() => {
        void contentPort.searchNoteContent(query)
          .then((hits) => {
            if (epoch !== passageSearchEpoch) return
            applyPassageHits(hits)
          })
          .catch(() => {})
      }, contentDebounceMs)
    },
    { immediate: true }
  )

  const paletteNoteContext = computed(() => ({
    recentPaths: quickOpenDataPort.recentViewedNotes.value.map((item) => item.path),
    favoritePaths: quickOpenDataPort.favoritePaths?.value ?? [],
    currentFolder: quickOpenDataPort.activeFilePath?.value
      ? noteFolderOf(quickOpenDataPort.activeFilePath.value)
      : ''
  }))

  /**
   * Unified ranked results for a universal query: notes by title (ranked by
   * the matcher ladder and its tie-breakers), content passages (empty until
   * FTS lands), a few matching commands, and the create action last.
   */
  /**
   * Help entries for the `?` mode, filtered by the query: an empty query
   * lists everything, and matches use the same command matcher so wording
   * variants find their topic.
   */
  const helpResults = computed<PaletteResult[]>(() => {
    const query = rawQueryText.value
    return HELP_ENTRIES
      .filter((entry) => {
        if (!query) return true
        return Boolean(matchCommand(entry.label, entry.keywords, query))
      })
      .map((entry) => ({ kind: 'help' as const, ...entry }))
  })

  const paletteResults = computed<PaletteResult[]>(() => {
    if (quickOpenMode.value === 'content') return passageResults.value
    if (quickOpenMode.value === 'help') return helpResults.value
    if (quickOpenMode.value !== 'universal') return []
    const query = rawQueryText.value
    if (!query) return []

    const noteMatches = quickOpenDataPort.allWorkspaceFiles.value
      .map((path) => {
        const title = noteTitleOf(path)
        const match = matchNoteTitle(title, query)
        return match ? { path, title, match } : null
      })
      .filter((entry): entry is { path: string; title: string; match: NonNullable<ReturnType<typeof matchNoteTitle>> } => Boolean(entry))
      .sort((left, right) => compareNoteMatches(left, right, paletteNoteContext.value))
      .slice(0, NOTE_RESULT_LIMIT)
      .map((entry) => ({
        kind: 'note' as const,
        path: entry.path,
        title: entry.title,
        folder: noteFolderOf(entry.path),
        matchKind: entry.match.kind
      }))

    const dailyResults: PaletteResult[] = []
    if (quickOpenDocumentPort.isIsoDate(query) && quickOpenDataPort.workingFolderPath.value) {
      const path = quickOpenDocumentPort.dailyNotePath(quickOpenDataPort.workingFolderPath.value, query)
      const exists = quickOpenDataPort.allWorkspaceFiles.value.some((item) => item.toLowerCase() === path.toLowerCase())
      dailyResults.push({ kind: 'daily', date: query, path, exists })
    }

    const commandResults: PaletteResult[] = quickOpenPalettePort.paletteActions.value
      .map((action) => {
        const match = matchCommand(action.label, action.keywords ?? [], query)
        return match ? { action, match } : null
      })
      .filter((entry): entry is { action: PaletteAction; match: NonNullable<ReturnType<typeof matchCommand>> } => Boolean(entry))
      .sort((left, right) => right.match.score - left.match.score || left.action.label.localeCompare(right.action.label))
      .slice(0, COMMAND_RESULT_LIMIT)
      .map((entry) => ({
        kind: 'command' as const,
        actionId: entry.action.id,
        label: entry.action.label,
        matchKind: entry.match.kind
      }))

    const passages = passageResults.value

    return [...dailyResults, ...noteMatches, ...passages, ...commandResults, { kind: 'create', title: query }]
  })

  /**
   * Category sections for the unified results, preserving the flat list order
   * (daily, notes, content, commands, create) so list indices stay stable.
   */
  const paletteCategories = computed<PaletteResultCategory[]>(() => {
    const categoryOf: Record<PaletteResult['kind'], PaletteResultCategoryId> = {
      note: 'notes',
      passage: 'content',
      command: 'commands',
      create: 'create',
      daily: 'daily',
      help: 'help'
    }
    const byCategory = new Map<PaletteResultCategoryId, PaletteResult[]>()
    for (const result of paletteResults.value) {
      const id = categoryOf[result.kind]
      const items = byCategory.get(id)
      if (items) items.push(result)
      else byCategory.set(id, [result])
    }
    let startIndex = 0
    const order: PaletteResultCategoryId[] = ['daily', 'notes', 'content', 'commands', 'help', 'create']
    return order
      .filter((id) => byCategory.has(id))
      .map((id) => {
        const results = byCategory.get(id)!
        const category = { id, label: PALETTE_CATEGORY_LABELS[id], results, startIndex }
        startIndex += results.length
        return category
      })
  })

  /** Favorite notes suggested in the browse state, deduplicated against recents. */
  const quickOpenBrowseFavoriteResults = computed(() => {
    if (quickOpenIsActionMode.value || quickOpenHasTextQuery.value) return []
    const recentPaths = new Set(quickOpenDataPort.recentViewedNotes.value.map((item) => item.path))
    return (quickOpenDataPort.favoritePaths?.value ?? [])
      .filter((path) => !recentPaths.has(path))
      .slice(0, BROWSE_RECENT_LIMIT)
      .map((path) => ({
        kind: 'favorite' as const,
        path,
        label: quickOpenDocumentPort.toRelativePath(path)
      }))
  })

  const quickOpenItemCount = computed(() =>
    quickOpenIsActionMode.value
      ? quickOpenActionResults.value.length
      : quickOpenHasTextQuery.value
        ? paletteResults.value.length
        : quickOpenBrowseItems.value.length
  )

  watch(
    [quickOpenItemCount, quickOpenIsActionMode, quickOpenHasTextQuery],
    ([count]) => {
      if (count <= 0) {
        quickOpenActiveIndex.value = 0
        return
      }
      if (quickOpenActiveIndex.value >= count || quickOpenActiveIndex.value < 0) {
        quickOpenActiveIndex.value = 0
      }
    },
    { immediate: true }
  )

  /** Moves selection with wraparound so keyboard navigation never leaves the list. */
  function moveQuickOpenSelection(delta: number) {
    const count = quickOpenItemCount.value
    if (!count) return
    quickOpenActiveIndex.value = (quickOpenActiveIndex.value + delta + count) % count
  }

  /** Sets the active list index directly, typically from pointer hover. */
  function setQuickOpenActiveIndex(index: number) {
    quickOpenActiveIndex.value = index
  }

  /**
   * Secondary-actions menu attached to a note result (Tab). Owns only the
   * open menu, its items, and its cursor; execution flows through the modal
   * interactions port so App-level capabilities stay out of the model.
   */
  const quickOpenTabMenu = ref<QuickOpenTabMenu | null>(null)

  const quickOpenTabMenuItems = computed<QuickOpenTabMenuItem[]>(() => {
    const menu = quickOpenTabMenu.value
    if (!menu) return []
    const isFavorite = (quickOpenDataPort.favoritePaths?.value ?? []).some(
      (path) => path.toLowerCase() === menu.path.toLowerCase()
    )
    return [
      { id: 'copy-link', label: 'Copy note link' },
      { id: 'toggle-favorite', label: isFavorite ? 'Remove from favorites' : 'Add to favorites' },
      { id: 'open-new-tab', label: 'Open in new tab' },
      { id: 'open-adjacent', label: 'Open in adjacent pane' },
      { id: 'reveal-location', label: 'Reveal file location' }
    ]
  })

  function openQuickOpenTabMenu(path: string, title: string) {
    quickOpenTabMenu.value = { path, title, itemIndex: 0 }
  }

  function closeQuickOpenTabMenu() {
    quickOpenTabMenu.value = null
  }

  /** Moves the menu cursor with clamping; wraparound stays at the edges. */
  function moveQuickOpenTabMenuSelection(delta: number) {
    const menu = quickOpenTabMenu.value
    const count = quickOpenTabMenuItems.value.length
    if (!menu || !count) return
    const next = Math.min(Math.max(menu.itemIndex + delta, 0), count - 1)
    quickOpenTabMenu.value = { ...menu, itemIndex: next }
  }

  /** Sets the menu cursor directly, typically from pointer hover. */
  function setQuickOpenTabMenuItemIndex(index: number) {
    const menu = quickOpenTabMenu.value
    if (!menu) return
    const count = quickOpenTabMenuItems.value.length
    quickOpenTabMenu.value = { ...menu, itemIndex: Math.min(Math.max(index, 0), count - 1) }
  }

  watch(quickOpenQuery, () => {
    closeQuickOpenTabMenu()
  })

  /**
   * Resets query, selection, and entry filter together so modal reopen
   * starts from a stable state (no stale search, no stale restriction).
   */
  function resetQuickOpenState(nextQuery = '') {
    quickOpenQuery.value = nextQuery
    quickOpenActiveIndex.value = 0
    quickOpenTabMenu.value = null
  }

  return {
    quickOpenQuery,
    quickOpenActiveIndex,
    quickOpenIsActionMode,
    quickOpenActionQuery,
    quickOpenMode,
    rawQueryText,
    passageResults,
    quickOpenResults,
    paletteResults,
    paletteCategories,
    quickOpenBrowseRecentResults,
    quickOpenBrowseFavoriteResults,
    quickOpenBrowseActionResults,
    quickOpenBrowseItems,
    quickOpenContextSuggestions,
    quickOpenActionResults,
    quickOpenActionGroups,
    quickOpenHasTextQuery,
    quickOpenItemCount,
    commandUsage,
    recordQuickOpenCommandUsage,
    quickOpenTabMenu,
    quickOpenTabMenuItems,
    openQuickOpenTabMenu,
    closeQuickOpenTabMenu,
    moveQuickOpenTabMenuSelection,
    setQuickOpenTabMenuItemIndex,
    moveQuickOpenSelection,
    setQuickOpenActiveIndex,
    resetQuickOpenState
  }
}
