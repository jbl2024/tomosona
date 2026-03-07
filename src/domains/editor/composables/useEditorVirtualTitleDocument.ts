import type { EditorBlock } from '../lib/markdownBlocks'

/**
 * Module: useEditorVirtualTitleDocument
 *
 * Groups pure virtual-title and title-normalization document helpers.
 */

/**
 * Identifier used for synthetic virtual-title heading block.
 */
export type VirtualTitleOptions = {
  virtualTitleBlockId?: string
  untitledLabel?: string
}

/**
 * useEditorVirtualTitleDocument
 *
 * Purpose:
 * - Provide pure helpers for virtual-title extraction and document normalization.
 *
 * Responsibilities:
 * - Normalize title from path stem.
 * - Build/strip/read synthetic virtual-title blocks.
 * - Keep virtual-title insertion idempotent for unchanged leading title blocks.
 *
 * Boundaries:
 * - No side effects; functions return derived values only.
 */
export function useEditorVirtualTitleDocument(options?: VirtualTitleOptions) {
  const virtualTitleBlockId = options?.virtualTitleBlockId ?? '__virtual_title__'
  const untitledLabel = options?.untitledLabel ?? 'Untitled'

  /**
   * Converts html-ish block text payload into plain text.
   */
  function extractPlainText(value: unknown): string {
    const html = String(value ?? '')
    if (!html.trim()) return ''
    const container = document.createElement('div')
    container.innerHTML = html
    return (container.textContent ?? '').replace(/\u200B/g, ' ').replace(/\s+/g, ' ').trim()
  }

  /**
   * Reads a text candidate from supported block payload fields.
   */
  function blockTextCandidate(block: EditorBlock | undefined): string {
    if (!block) return ''
    if (typeof block.data?.text !== 'undefined') return extractPlainText(block.data.text)
    if (typeof block.data?.code === 'string') return block.data.code.trim()
    return ''
  }

  /**
   * Derives a user-facing title from markdown file path.
   *
   * Regex example:
   * - `notes/Plan.MD` -> `Plan` (matches `/\.(md|markdown)$/i`).
   */
  function noteTitleFromPath(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/')
    const name = parts[parts.length - 1] || normalized
    const stem = name.replace(/\.(md|markdown)$/i, '').trim()
    return stem || untitledLabel
  }

  /**
   * Creates synthetic title heading block.
   */
  function virtualTitleBlock(title: string): EditorBlock {
    return {
      id: virtualTitleBlockId,
      type: 'header',
      data: { level: 1, text: title.trim() || untitledLabel }
    }
  }

  /**
   * Drops synthetic title block from collection.
   */
  function stripVirtualTitle(blocks: EditorBlock[]): EditorBlock[] {
    return blocks.filter((block) => block.id !== virtualTitleBlockId)
  }

  /**
   * Reads the current synthetic title text.
   */
  function readVirtualTitle(blocks: EditorBlock[]): string {
    const virtual = blocks.find((block) => block.id === virtualTitleBlockId)
    return blockTextCandidate(virtual)
  }

  /**
   * Ensures document starts with synthetic title block.
   *
   * Why/invariant:
   * - Returns `changed: false` only when the existing leading block already matches the desired
   *   synthetic title and there is no duplicate synthetic block in the remainder.
   */
  function withVirtualTitle(blocks: EditorBlock[], title: string): { blocks: EditorBlock[]; changed: boolean } {
    const content = stripVirtualTitle(blocks.map((block) => ({ ...block, data: { ...(block.data ?? {}) } })))
    const desired = title.trim() || untitledLabel
    const next = [virtualTitleBlock(desired), ...content]
    const first = blocks[0]
    const firstLevel = Number(first?.data?.level ?? 0)
    const firstText = blockTextCandidate(first)
    const hasSingleLeadingVirtual = Boolean(first) &&
      first.id === virtualTitleBlockId &&
      first.type === 'header' &&
      firstLevel === 1 &&
      firstText === desired &&
      !blocks.slice(1).some((block) => block.id === virtualTitleBlockId)

    return { blocks: next, changed: !hasSingleLeadingVirtual || blocks.length !== next.length }
  }

  return {
    virtualTitleBlockId,
    untitledLabel,
    extractPlainText,
    blockTextCandidate,
    noteTitleFromPath,
    virtualTitleBlock,
    stripVirtualTitle,
    readVirtualTitle,
    withVirtualTitle
  }
}
