/**
 * editorPerf
 *
 * Utilities that keep editor-side feature detection and DOM mutation handling cheap.
 *
 * This module is intentionally small and side-effect free:
 * - quick text heuristics used during typing,
 * - narrow extraction of code-block nodes impacted by MutationObserver records.
 */

/**
 * Fast hint used while typing to decide whether wikilink-related UI work is needed.
 *
 * Example matches:
 * - "["
 * - "[[note"
 * - "note]]"
 */
export function hasWikilinkHint(text: string): boolean {
  return /[\[\]]/.test(text)
}

/**
 * Normalizes a DOM node to an Element.
 *
 * Mutation records can point to either element nodes or text nodes; callers need
 * a stable element anchor for `matches`, `closest`, and subtree queries.
 */
function elementFromNode(node: Node | null): Element | null {
  if (!node) return null
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element
  return node.parentElement
}

/**
 * Collects code blocks that are actually affected by a set of DOM mutations.
 *
 * Strategy:
 * - For each `record.target`, include only a direct code-block hit (`.ce-code` or closest ancestor).
 *   This avoids scanning whole containers and producing false positives on unrelated edits.
 * - For each `record.addedNodes`, also scan nested descendants to catch newly inserted code blocks.
 *
 * Returns unique `.ce-code` elements located inside `root`.
 */
export function collectAffectedCodeBlocks(records: readonly MutationRecord[], root: HTMLElement): HTMLElement[] {
  const out = new Set<HTMLElement>()

  /**
   * Attempts to resolve one node to impacted `.ce-code` blocks.
   *
   * `includeNested` should be true only for added nodes, where nested scans are
   * useful and bounded to the inserted subtree.
   */
  const addBlockFromNode = (node: Node | null, includeNested: boolean) => {
    const element = elementFromNode(node)
    if (!element || !root.contains(element)) return

    const direct = element.matches('.ce-code') ? element : element.closest('.ce-code')
    if (direct && root.contains(direct)) {
      out.add(direct as HTMLElement)
    }

    if (!includeNested) return

    if ('querySelectorAll' in element) {
      const nested = Array.from(element.querySelectorAll('.ce-code')) as HTMLElement[]
      nested.forEach((block) => {
        if (root.contains(block)) out.add(block)
      })
    }
  }

  records.forEach((record) => {
    addBlockFromNode(record.target, false)
    record.addedNodes.forEach((node) => addBlockFromNode(node, true))
  })

  return [...out]
}
