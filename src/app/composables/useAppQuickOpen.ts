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

/**
 * Module: useAppQuickOpen
 *
 * Purpose:
 * - Derive quick-open and command-palette state from workspace files and actions.
 */

/** Browse cap for recent notes: the initial state stays deliberately short. */
const BROWSE_RECENT_LIMIT = 3
/** Maximum note results shown for a query (source spec: six to eight visible). */
const NOTE_RESULT_LIMIT = 6
/** Maximum command results mixed into a universal query. */
const COMMAND_RESULT_LIMIT = 3

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
  | { kind: 'passage'; path: string; title: string; folder: string; section?: string; snippet: string }
  | { kind: 'command'; actionId: string; label: string; matchKind: CommandMatchKind }
  | { kind: 'create'; title: string }
  | { kind: 'daily'; date: string; path: string; exists: boolean }

export type PaletteResultCategoryId = 'daily' | 'notes' | 'content' | 'commands' | 'create'

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
  create: 'Create'
}

/** Universal palette search mode, derived from the optional query prefix. */
export type PaletteMode = 'universal' | 'commands' | 'content' | 'help'

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
  const quickOpenActiveIndex = options.quickOpenActiveIndex ?? ref(0)
  /**
   * Notes-only restriction set by the opening shortcut (Cmd+P). It applies to
   * the current palette session: command results stay hidden until the
   * palette is closed or reopened through another entry.
   */
  const quickOpenNotesOnly = ref(false)

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
    return QUICK_OPEN_BROWSE_ACTION_IDS
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
    ...quickOpenBrowseRecentResults.value,
    ...quickOpenBrowseFavoriteResults.value,
    ...quickOpenBrowseActionResults.value
  ])

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
  const paletteResults = computed<PaletteResult[]>(() => {
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

    const commandResults: PaletteResult[] = quickOpenNotesOnly.value
      ? []
      : quickOpenPalettePort.paletteActions.value
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

    return [...dailyResults, ...noteMatches, ...commandResults, { kind: 'create', title: query }]
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
      daily: 'daily'
    }
    const byCategory = new Map<PaletteResultCategoryId, PaletteResult[]>()
    for (const result of paletteResults.value) {
      const id = categoryOf[result.kind]
      const items = byCategory.get(id)
      if (items) items.push(result)
      else byCategory.set(id, [result])
    }
    let startIndex = 0
    const order: PaletteResultCategoryId[] = ['daily', 'notes', 'content', 'commands', 'create']
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
   * Resets query, selection, and entry filter together so modal reopen
   * starts from a stable state (no stale search, no stale restriction).
   */
  function resetQuickOpenState(nextQuery = '', notesOnly = false) {
    quickOpenQuery.value = nextQuery
    quickOpenActiveIndex.value = 0
    quickOpenNotesOnly.value = notesOnly
  }

  return {
    quickOpenQuery,
    quickOpenActiveIndex,
    quickOpenIsActionMode,
    quickOpenActionQuery,
    quickOpenMode,
    rawQueryText,
    quickOpenNotesOnly,
    quickOpenResults,
    paletteResults,
    paletteCategories,
    quickOpenBrowseRecentResults,
    quickOpenBrowseFavoriteResults,
    quickOpenBrowseActionResults,
    quickOpenBrowseItems,
    quickOpenActionResults,
    quickOpenActionGroups,
    quickOpenHasTextQuery,
    quickOpenItemCount,
    moveQuickOpenSelection,
    setQuickOpenActiveIndex,
    resetQuickOpenState
  }
}
