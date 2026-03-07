import type { Ref } from 'vue'

type OutlineHeadingNode = {
  level: 1 | 2 | 3
  text: string
}

type RevealAnchorRequest = {
  heading?: string
  blockId?: string
}

/**
 * Dependencies required by {@link useEditorOutlineNavigation}.
 */
export type UseEditorOutlineNavigationOptions = {
  holder: Ref<HTMLElement | null>
  virtualTitleBlockId: string
  emitOutline: (headings: OutlineHeadingNode[]) => void
  normalizeHeadingAnchor: (heading: string) => string
  slugifyHeading: (heading: string) => string
  normalizeBlockId: (blockId: string) => string
  nextUiTick: () => Promise<void>
}

/**
 * useEditorOutlineNavigation
 *
 * Purpose:
 * - Owns outline extraction and navigation/reveal helpers from editor DOM.
 *
 * Responsibilities:
 * - Parse visible headings while excluding virtual-title metadata block.
 * - Debounce outline emission after editor changes.
 * - Reveal anchors/snippets with retry semantics for delayed EditorJS DOM updates.
 *
 * Invariants:
 * - Outline nodes are limited to levels 1-3.
 * - Anchor reveal retries up to 12 attempts with 35ms spacing.
 */
export function useEditorOutlineNavigation(options: UseEditorOutlineNavigationOptions) {
  let outlineTimer: ReturnType<typeof setTimeout> | null = null

  /** Clears pending outline emission timer. */
  function clearOutlineTimer() {
    if (!outlineTimer) return
    clearTimeout(outlineTimer)
    outlineTimer = null
  }

  function parseOutlineFromDom(): OutlineHeadingNode[] {
    if (!options.holder.value) return []
    const headers = Array.from(options.holder.value.querySelectorAll('.ce-header')) as HTMLElement[]
    const out: OutlineHeadingNode[] = []

    for (const header of headers) {
      const block = header.closest('.ce-block') as HTMLElement | null
      if (block?.dataset.id === options.virtualTitleBlockId) continue
      const text = header.innerText.trim()
      if (!text) continue
      const tag = header.tagName.toLowerCase()
      const levelRaw = Number.parseInt(tag.replace('h', ''), 10)
      const level = (levelRaw >= 1 && levelRaw <= 3 ? levelRaw : 3) as 1 | 2 | 3
      out.push({ level, text })
    }

    return out
  }

  function getOutlineHeaderByIndex(index: number): HTMLElement | null {
    if (!options.holder.value || index < 0) return null
    const headers = Array.from(options.holder.value.querySelectorAll('.ce-header')) as HTMLElement[]
    let visibleIndex = 0

    for (const header of headers) {
      const block = header.closest('.ce-block') as HTMLElement | null
      if (block?.dataset.id === options.virtualTitleBlockId) continue
      const text = header.innerText.trim()
      if (!text) continue
      if (visibleIndex === index) return header
      visibleIndex += 1
    }

    return null
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function headingMatchesAnchor(headerText: string, anchorHeading: string): boolean {
    const wanted = options.normalizeHeadingAnchor(anchorHeading)
    if (!wanted) return false
    const actual = options.normalizeHeadingAnchor(headerText)
    if (actual === wanted) return true

    const wantedSlug = options.slugifyHeading(anchorHeading)
    const actualSlug = options.slugifyHeading(headerText)
    return Boolean(wantedSlug && actualSlug && wantedSlug === actualSlug)
  }

  function getHeaderByAnchor(heading: string): HTMLElement | null {
    if (!options.holder.value) return null
    const headers = Array.from(options.holder.value.querySelectorAll('.ce-header')) as HTMLElement[]
    for (const header of headers) {
      const block = header.closest('.ce-block') as HTMLElement | null
      if (block?.dataset.id === options.virtualTitleBlockId) continue
      const text = header.innerText.trim()
      if (!text) continue
      if (headingMatchesAnchor(text, heading)) return header
    }
    return null
  }

  function getBlockByAnchor(blockIdRaw: string): HTMLElement | null {
    if (!options.holder.value) return null
    const blockId = options.normalizeBlockId(blockIdRaw)
    if (!blockId) return null

    // Detects block anchors such as "^task-12" inside paragraph text.
    const matcher = new RegExp(`(^|\\s)\\^${escapeRegExp(blockId)}(\\s|$)`, 'i')
    const blocks = Array.from(options.holder.value.querySelectorAll('.ce-block')) as HTMLElement[]
    for (const block of blocks) {
      if (block.dataset.id === options.virtualTitleBlockId) continue
      const text = (block.innerText ?? '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      if (matcher.test(text)) return block
    }
    return null
  }

  async function revealAnchor(anchor: RevealAnchorRequest): Promise<boolean> {
    if (!options.holder.value) return false
    if (!anchor.heading && !anchor.blockId) return false

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await options.nextUiTick()
      const target = anchor.blockId
        ? getBlockByAnchor(anchor.blockId)
        : anchor.heading
          ? getHeaderByAnchor(anchor.heading)
          : null

      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        const focusTarget = target.matches('.ce-header')
          ? target
          : (target.querySelector('[contenteditable="true"], .ce-code__textarea') as HTMLElement | null)
        focusTarget?.focus()
        return true
      }

      await new Promise((resolve) => window.setTimeout(resolve, 35))
    }

    return false
  }

  async function revealOutlineHeading(index: number) {
    if (!options.holder.value) return
    await options.nextUiTick()
    const target = getOutlineHeaderByIndex(index)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function emitOutlineSoon() {
    clearOutlineTimer()
    outlineTimer = setTimeout(() => {
      options.emitOutline(parseOutlineFromDom())
    }, 120)
  }

  function getVisibleText(input: string): string {
    return input
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async function revealSnippet(snippet: string) {
    if (!options.holder.value || !snippet) return
    await options.nextUiTick()

    const targetSnippet = getVisibleText(snippet).toLowerCase()
    if (!targetSnippet) return

    const nodes = Array.from(options.holder.value.querySelectorAll('[contenteditable="true"], .ce-code__textarea')) as HTMLElement[]
    const match = nodes.find((node) => getVisibleText(node.innerText).toLowerCase().includes(targetSnippet))
    if (!match) return

    match.scrollIntoView({ block: 'center', behavior: 'smooth' })
    match.focus()
  }

  return {
    parseOutlineFromDom,
    revealAnchor,
    revealOutlineHeading,
    emitOutlineSoon,
    clearOutlineTimer,
    revealSnippet
  }
}
