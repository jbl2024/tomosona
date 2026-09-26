/**
 * Resolves the small command vocabulary owned by Tomosona's terminal panel.
 * These commands are expanded locally before the native shell receives them.
 */

function directoryForPath(path: string, fallback: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator > 0 ? path.slice(0, separator) : fallback
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'"'"'`)}'`
}

/**
 * Expands `@current` to the active file's directory and `@home` to the
 * workspace root. Returns `null` for ordinary shell input.
 */
export function resolveTerminalBuiltinCommand(
  input: string,
  currentFilePath: string,
  workspacePath: string
): string | null {
  if (input.trim() === '@current') {
    return `cd ${shellQuote(directoryForPath(currentFilePath, workspacePath))}`
  }
  if (input.trim() === '@home') return `cd ${shellQuote(workspacePath)}`
  return null
}
