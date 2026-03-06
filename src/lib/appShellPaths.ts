/**
 * Module: appShellPaths
 *
 * Purpose:
 * - Centralize pure path/date helpers used by the app shell.
 *
 * Notes:
 * - Helpers in this module must stay side-effect free.
 * - Workspace-aware helpers operate on normalized forward-slash paths.
 */

/** Formats a date or time segment as a 2-digit string. */
export function normalizeDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

/** Returns true when the provided year-month-day tuple maps to a real calendar date. */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const value = new Date(year, month - 1, day)
  return value.getFullYear() === year && value.getMonth() + 1 === month && value.getDate() === day
}

/** Formats a Date as `YYYY-MM-DD`. */
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${normalizeDatePart(date.getMonth() + 1)}-${normalizeDatePart(date.getDate())}`
}

/** Formats a timestamp as `YYYY-MM-DD HH:mm:ss`, or `-` when invalid. */
export function formatTimestamp(value: number | null): string {
  if (!Number.isFinite(value) || value == null || value < 0) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return `${date.getFullYear()}-${normalizeDatePart(date.getMonth() + 1)}-${normalizeDatePart(date.getDate())} ${normalizeDatePart(date.getHours())}:${normalizeDatePart(date.getMinutes())}:${normalizeDatePart(date.getSeconds())}`
}

/** Returns true when the string is a valid ISO day in `YYYY-MM-DD` format. */
export function isIsoDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false
  const [yearRaw, monthRaw, dayRaw] = input.split('-')
  const year = Number.parseInt(yearRaw, 10)
  const month = Number.parseInt(monthRaw, 10)
  const day = Number.parseInt(dayRaw, 10)
  return isValidCalendarDate(year, month, day)
}

/** Parses an ISO day input and returns the normalized form, or `null` when invalid. */
export function parseIsoDateInput(input: string): string | null {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!isValidCalendarDate(year, month, day)) return null
  return `${year}-${normalizeDatePart(month)}-${normalizeDatePart(day)}`
}

/** Returns the canonical journal path for a daily note inside the workspace. */
export function dailyNotePath(root: string, date: string): string {
  return `${root}/journal/${date}.md`
}

/** Normalizes a user-provided relative path while preserving nested segments. */
export function sanitizeRelativePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

/**
 * Normalizes a workspace-relative note path.
 *
 * Rejects traversals that escape the workspace. For example `../secret.md`
 * returns `null`.
 */
export function normalizeRelativeNotePath(raw: string): string | null {
  const cleaned = raw.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!cleaned) return null

  const stack: string[] = []
  const segments = cleaned.split('/')
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) {
        return null
      }
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  if (!stack.length) return null
  return stack.join('/')
}

/** Normalizes a path to forward-slash separators. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Returns a case-insensitive key for path lookups. */
export function normalizePathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

/** Returns true when the path looks like a markdown document. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** Returns the final filename segment for the provided path. */
export function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

/** Splits a relative path into parent directory and file name parts. */
export function splitRelativePath(path: string): { directory: string; fileName: string } {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) {
    return { directory: '', fileName: normalized }
  }
  return {
    directory: normalized.slice(0, lastSlash),
    fileName: normalized.slice(lastSlash + 1)
  }
}
