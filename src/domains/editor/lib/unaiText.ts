/**
 * Replaces common AI and word-processor typography with plain Markdown-safe
 * punctuation while leaving every other character untouched.
 */
export function unaiText(value: string): string {
  return value
    .replace(/[—–]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[«»“”„‟]/g, '"')
}
