/**
 * Palette search matching and ranking.
 *
 * Owns the pure text contract behind the universal palette: case and accent
 * folding, multi-word matching in any order, per-word typo tolerance, the
 * title ranking ladder, command matching against labels and keywords, and
 * the documented tie-breakers. The palette composable decides which
 * candidates exist; this module only decides how a query scores them.
 *
 * Ranking ladder (higher first): exact title > title prefix > partial title
 * > fuzzy title > content matches (scored by the search index elsewhere) >
 * command matches. Tie-breakers for comparable results: recent note, favorite
 * note, current folder, then path for stable ordering.
 */

/** Normalizes text for comparison: lowercase, accents folded (NFD strip). */
export function normalizePaletteText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export type NoteTitleMatchKind = 'exact' | 'prefix' | 'partial' | 'fuzzy'

export type NoteTitleMatch = {
  kind: NoteTitleMatchKind
  score: number
}

const TITLE_SCORES: Record<NoteTitleMatchKind, number> = {
  exact: 400,
  prefix: 300,
  partial: 200,
  fuzzy: 100
}

export type CommandMatchKind = 'exact' | 'prefix' | 'label' | 'keyword'

export type CommandMatch = {
  kind: CommandMatchKind
  score: number
}

const COMMAND_SCORES: Record<CommandMatchKind, number> = {
  exact: 90,
  prefix: 70,
  label: 50,
  keyword: 30
}

function queryWords(query: string): string[] {
  return normalizePaletteText(query).split(/\s+/).filter(Boolean)
}

/** Substring containment on normalized text. */
function contains(haystack: string, needle: string): boolean {
  return haystack.includes(needle)
}

/**
 * Subsequence tolerance for missing letters, e.g. "ztl" within
 * "zettelkasten" (letters in order, gaps allowed). Only used for words of
 * 3+ characters so short fragments cannot match everything.
 */
function isSubsequence(haystack: string, needle: string): boolean {
  if (needle.length < 3) return false
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return false
}

/**
 * Damerau-Levenshtein distance bounded by `max`, with early exit. Covers
 * simple typos against whole title tokens: substitutions, insertions,
 * deletions, and adjacent transpositions ("roadamp" vs "roadmap").
 */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  const previousPrevious = new Array<number>(b.length + 1)
  const previous = new Array<number>(b.length + 1)
  const current = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    let rowMin = current[0]
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      )
      if (
        i > 1 && j > 1
        && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ) {
        current[j] = Math.min(current[j], previousPrevious[j - 2] + 1)
      }
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > max) return false
    for (let j = 0; j <= b.length; j += 1) {
      previousPrevious[j] = previous[j]
      previous[j] = current[j]
    }
  }
  return previous[b.length] <= max
}

function tokenMatchesWithTypo(haystack: string, word: string): boolean {
  return haystack
    .split(/\s+/)
    .some((token) => token.length >= 3 && editDistanceWithin(word, token, 1))
}

function wordMatches(haystack: string, word: string): 'substring' | 'fuzzy' | null {
  if (contains(haystack, word)) return 'substring'
  if (isSubsequence(haystack, word)) return 'fuzzy'
  if (tokenMatchesWithTypo(haystack, word)) return 'fuzzy'
  return null
}

/**
 * Matches a note title against a query. All query words must match in any
 * order; a word matches as a substring or, for simple typos, as a
 * subsequence. Returns the weakest matching kind achieved (the ladder entry
 * the result earns) or null when any word fails.
 *
 * Examples: "atom notes" and "notes atom" both match "Créer des notes
 * atomiques"; "methode zettel" matches "Méthode Zettelkasten" (accents
 * folded); "roadamp" matches "Roadmap" (subsequence).
 */
export function matchNoteTitle(title: string, query: string): NoteTitleMatch | null {
  const normalizedTitle = normalizePaletteText(title)
  const normalizedQuery = normalizePaletteText(query)
  if (!normalizedQuery) return null

  const words = queryWords(query)
  let weakest: NoteTitleMatchKind | null = null

  if (normalizedTitle === normalizedQuery) {
    return { kind: 'exact', score: TITLE_SCORES.exact }
  }
  if (normalizedTitle.startsWith(normalizedQuery)) {
    weakest = 'prefix'
  }

  for (const word of words) {
    const match = wordMatches(normalizedTitle, word)
    if (!match && weakest === 'prefix') break
    if (!match) return null
    if (match === 'fuzzy') {
      if (weakest !== 'prefix') weakest = 'fuzzy'
    } else if (weakest !== 'prefix' && weakest !== 'fuzzy') {
      weakest = 'partial'
    }
  }

  if (weakest) return { kind: weakest, score: TITLE_SCORES[weakest] }
  return null
}

/**
 * Matches a command against a query using its label and alias keywords.
 * All query words must match the label or one of the keywords. Returns the
 * earned match tier or null.
 */
export function matchCommand(label: string, keywords: string[], query: string): CommandMatch | null {
  const normalizedLabel = normalizePaletteText(label)
  const normalizedQuery = normalizePaletteText(query)
  if (!normalizedQuery) return null
  const normalizedKeywords = keywords.map(normalizePaletteText)

  if (normalizedLabel === normalizedQuery) return { kind: 'exact', score: COMMAND_SCORES.exact }
  if (normalizedLabel.startsWith(normalizedQuery)) return { kind: 'prefix', score: COMMAND_SCORES.prefix }

  const words = queryWords(query)
  if (!words.length) return null
  let labelOnly = true
  for (const word of words) {
    if (contains(normalizedLabel, word)) continue
    if (normalizedKeywords.some((keyword) => contains(keyword, word))) {
      labelOnly = false
      continue
    }
    return null
  }
  return labelOnly
    ? { kind: 'label', score: COMMAND_SCORES.label }
    : { kind: 'keyword', score: COMMAND_SCORES.keyword }
}

export type NoteCandidateContext = {
  /** Recent note paths, newest first. */
  recentPaths?: string[]
  /** Favorite note paths. */
  favoritePaths?: string[]
  /** Folder of the currently open note, used as a tie-breaker. */
  currentFolder?: string
}

export type RankableNoteMatch = {
  path: string
  title: string
  match: NoteTitleMatch
}

function folderOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

/**
 * Compares two matched notes for list ordering: match score first, then the
 * documented tie-breakers (recent, favorite, current folder), then path for
 * deterministic output on otherwise identical candidates.
 */
export function compareNoteMatches(a: RankableNoteMatch, b: RankableNoteMatch, context: NoteCandidateContext = {}): number {
  if (a.match.score !== b.match.score) return b.match.score - a.match.score

  const recentPaths = context.recentPaths ?? []
  const recentRank = (candidate: RankableNoteMatch) => {
    const index = recentPaths.indexOf(candidate.path)
    return index === -1 ? recentPaths.length : index
  }
  const aRecent = recentRank(a)
  const bRecent = recentRank(b)
  if (aRecent !== bRecent) return aRecent - bRecent

  const favorites = new Set(context.favoritePaths ?? [])
  const aFavorite = favorites.has(a.path)
  const bFavorite = favorites.has(b.path)
  if (aFavorite !== bFavorite) return aFavorite ? -1 : 1

  const currentFolder = context.currentFolder ?? ''
  const aInFolder = currentFolder ? folderOf(a.path) === currentFolder : false
  const bInFolder = currentFolder ? folderOf(b.path) === currentFolder : false
  if (aInFolder !== bInFolder) return aInFolder ? -1 : 1

  return a.path.localeCompare(b.path)
}
