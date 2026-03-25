/**
 * Mention resolution and suggestion workflow for Second Brain composers.
 *
 * This module keeps the `@`-mention behavior self-contained so the composer
 * runtime can ask for suggestions, insert them, and resolve them to explicit
 * workspace paths without knowing the filesystem details.
 */
import { computed, ref, type Ref } from 'vue'
import {
  normalizeWorkspacePath,
  toWorkspacePathKey,
  toWorkspaceRelativePath
} from '../../explorer/lib/workspacePaths'

export type SecondBrainAtMentionItem = {
  id: string
  relativePath: string
  absolutePath: string
}

type MentionTrigger = {
  start: number
  end: number
  query: string
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function extractMentionTrigger(text: string, caret: number): MentionTrigger | null {
  const beforeCaret = text.slice(0, caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) return null
  const previousChar = atIndex > 0 ? beforeCaret[atIndex - 1] : ''
  if (previousChar && !/\s|[([{]/.test(previousChar)) return null
  const query = beforeCaret.slice(atIndex + 1)
  if (/\s/.test(query)) return null
  return {
    start: atIndex,
    end: caret,
    query
  }
}

export function useSecondBrainAtMentions(params: {
  workspacePath: Ref<string>
  allWorkspaceFiles: Ref<string[]>
}) {
  const trigger = ref<MentionTrigger | null>(null)
  const activeIndex = ref(0)

  const mentionItems = computed<SecondBrainAtMentionItem[]>(() => {
    const entries = params.allWorkspaceFiles.value
      .filter((path) => isMarkdownPath(path))
      .map((absolutePath) => {
        const relativePath = toWorkspaceRelativePath(params.workspacePath.value, absolutePath)
        return {
          id: toWorkspacePathKey(relativePath),
          relativePath,
          absolutePath: normalizeWorkspacePath(absolutePath)
        }
      })

    const byRelativePath = new Map<string, SecondBrainAtMentionItem>()
    for (const item of entries) {
      if (!byRelativePath.has(item.id)) {
        byRelativePath.set(item.id, item)
      }
    }

    return Array.from(byRelativePath.values()).sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )
  })

  const suggestions = computed(() => {
    const current = trigger.value
    if (!current) return []
    const needle = current.query.trim().toLowerCase()
    const source = mentionItems.value
    if (!needle) return source.slice(0, 30)
    return source
      .filter((item) => item.relativePath.toLowerCase().includes(needle))
      .slice(0, 30)
  })

  const isOpen = computed(() => Boolean(trigger.value) && suggestions.value.length > 0)

  /**
   * Recomputes the active mention trigger from the current composer text.
   *
   * A null or invalid caret clears the menu, which keeps stale suggestion UI
   * from lingering after focus changes.
   */
  function updateTrigger(text: string, caret: number | null) {
    if (caret == null || caret < 0) {
      trigger.value = null
      return
    }
    trigger.value = extractMentionTrigger(text, caret)
    activeIndex.value = 0
  }

  /**
   * Closes the suggestion menu and resets the active index.
   */
  function close() {
    trigger.value = null
    activeIndex.value = 0
  }

  /**
   * Updates the highlighted suggestion while wrapping within the current list.
   */
  function setActiveIndex(next: number) {
    const total = suggestions.value.length
    if (!total) {
      activeIndex.value = 0
      return
    }
    activeIndex.value = (next + total) % total
  }

  /**
   * Moves the highlighted suggestion up or down by one item.
   */
  function moveActive(delta: 1 | -1) {
    setActiveIndex(activeIndex.value + delta)
  }

  /**
   * Inserts the selected mention into the composer text.
   *
   * The trailing space is intentional: it mirrors normal typing and keeps the
   * caret positioned after the inserted note path.
   */
  function applySuggestion(text: string, item: SecondBrainAtMentionItem): { text: string; caret: number } {
    const current = trigger.value
    if (!current) {
      return { text, caret: text.length }
    }

    const nextText = `${text.slice(0, current.start)}@${item.relativePath} ${text.slice(current.end)}`
    const caret = current.start + item.relativePath.length + 2
    close()
    return {
      text: nextText,
      caret
    }
  }

  /**
   * Resolves inline mentions to absolute workspace paths.
   *
   * Unresolved tokens are returned separately so the caller can explain what
   * was ignored instead of silently dropping user input.
   */
  function resolveMentionedPaths(text: string): { resolvedPaths: string[]; unresolved: string[] } {
    const resolved: string[] = []
    const unresolved: string[] = []
    const byRelative = new Map(mentionItems.value.map((item) => [toWorkspacePathKey(item.relativePath), item.absolutePath]))

    const regex = /(^|\s)@([^\s@]+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text))) {
      const token = (match[2] ?? '').trim()
      if (!token) continue
      const absolute = byRelative.get(toWorkspacePathKey(token))
      if (absolute) {
        resolved.push(absolute)
      } else {
        unresolved.push(token)
      }
    }

    return {
      resolvedPaths: Array.from(new Set(resolved)),
      unresolved: Array.from(new Set(unresolved))
    }
  }

  return {
    trigger,
    activeIndex,
    suggestions,
    isOpen,
    updateTrigger,
    close,
    moveActive,
    setActiveIndex,
    applySuggestion,
    resolveMentionedPaths
  }
}
