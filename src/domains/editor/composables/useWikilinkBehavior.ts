import { computed, nextTick, ref, type Ref } from 'vue'
import { buildWikilinkDraftToken, buildWikilinkToken, parseWikilinkTarget } from '../lib/wikilinks'
import { hasWikilinkHint } from '../lib/editorPerf'

type EditableLinkToken =
  | { kind: 'wikilink'; target: string; label: string }
  | { kind: 'hyperlink'; href: string; label: string }

type EditableLinkRange = {
  start: number
  end: number
}

type ArrowLinkContext = {
  textNode: Text
  range: EditableLinkRange
}

type WikilinkResult = {
  id: string
  label: string
  target: string
  isCreate: boolean
}

type UseWikilinkBehaviorOptions = {
  holder: Ref<HTMLDivElement | null>
  currentPath: Ref<string>
  dirtyByPath: Ref<Record<string, boolean>>
  isMacOs: boolean
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  openLinkTarget: (target: string) => Promise<boolean>
  saveCurrentFile: (manual?: boolean) => Promise<void>
  clearAutosaveTimer: () => void
  setDirty: (path: string, dirty: boolean) => void
  setSaveError: (path: string, message: string) => void
  scheduleAutosave: () => void
  parseOutlineFromDom: () => Array<{ level: 1 | 2 | 3; text: string }>
}

/**
 * useWikilinkBehavior
 *
 * Purpose:
 * - Encapsulates wikilink autocomplete, token editing, and link-open interactions.
 *
 * Responsibilities:
 * - Manage menu state/results for note and heading suggestions.
 * - Convert typed markdown links/wikilinks to anchor nodes and back.
 * - Handle open-link flows with autosave safeguards.
 *
 * Boundaries:
 * - Operates on current editor DOM selection and holder.
 * - Does not own editor block rendering lifecycle.
 */
export function useWikilinkBehavior(options: UseWikilinkBehaviorOptions) {
  const wikilinkMenuRef = ref<HTMLDivElement | null>(null)
  const wikilinkOpen = ref(false)
  const wikilinkIndex = ref(0)
  const wikilinkLeft = ref(0)
  const wikilinkTop = ref(0)
  const wikilinkQuery = ref('')
  const wikilinkTargets = ref<string[]>([])
  const wikilinkHeadingResults = ref<WikilinkResult[]>([])
  const wikilinkHeadingCache = ref<Record<string, string[]>>({})

  let wikilinkLoadToken = 0
  let wikilinkHeadingLoadToken = 0
  let suppressCollapseOnNextArrowKeyup = false
  let expandedLinkContext: ArrowLinkContext | null = null

  const wikilinkResults = computed<WikilinkResult[]>(() => {
    if (wikilinkHeadingResults.value.length > 0) {
      return wikilinkHeadingResults.value
    }
    const query = wikilinkQuery.value.trim().toLowerCase()
    const base = wikilinkTargets.value
      .filter((path) => !query || path.toLowerCase().includes(query))
      .slice(0, 12)
      .map((path) => ({ id: `existing:${path}`, label: path, target: path, isCreate: false }))

    const exact = base.some((item) => item.target.toLowerCase() === query)
    if (query && !exact) {
      base.unshift({
        id: `create:${query}`,
        label: `Create "${wikilinkQuery.value.trim()}"`,
        target: wikilinkQuery.value.trim(),
        isCreate: true
      })
    }

    return base
  })

  function setMenuElement(element: HTMLDivElement | null) {
    wikilinkMenuRef.value = element
  }

  function consumeSuppressCollapseOnArrowKeyup(): boolean {
    if (!suppressCollapseOnNextArrowKeyup) return false
    suppressCollapseOnNextArrowKeyup = false
    return true
  }

  function closeWikilinkMenu() {
    wikilinkOpen.value = false
    wikilinkIndex.value = 0
    wikilinkQuery.value = ''
    wikilinkHeadingResults.value = []
    wikilinkLoadToken += 1
    wikilinkHeadingLoadToken += 1
  }

  async function refreshWikilinkTargets() {
    const token = ++wikilinkLoadToken
    try {
      const paths = await options.loadLinkTargets()
      if (token !== wikilinkLoadToken) return
      wikilinkTargets.value = paths
    } catch {
      if (token !== wikilinkLoadToken) return
      wikilinkTargets.value = []
    }
  }

  function shouldSyncWikilinkFromSelection() {
    if (wikilinkOpen.value) return true
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false
    const node = selection.focusNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return false
    return hasWikilinkHint((node as Text).data)
  }

  function isWikilinkRelevantKey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false
    if (event.key === 'Backspace' || event.key === 'Delete') return true
    return event.key.length === 1
  }

  function openWikilinkMenuAtCaret(query: string, keepSelection = false) {
    if (!options.holder.value) return
    const holderEl = options.holder.value
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const caretRect = typeof range?.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : null
    const holderRect = holderEl.getBoundingClientRect()
    const padding = 8
    const baseLeft = (caretRect?.left ?? holderRect.left) - holderRect.left + holderEl.scrollLeft
    const baseTop = (caretRect?.bottom ?? holderRect.top) - holderRect.top + holderEl.scrollTop + padding

    wikilinkLeft.value = Math.max(holderEl.scrollLeft + padding, baseLeft)
    wikilinkTop.value = Math.max(holderEl.scrollTop + padding, baseTop)
    const previousCount = wikilinkResults.value.length
    const previousIndex = wikilinkIndex.value
    wikilinkQuery.value = query
    if (keepSelection && previousCount > 0) {
      const nextCount = wikilinkResults.value.length
      wikilinkIndex.value = nextCount > 0 ? Math.min(previousIndex, nextCount - 1) : 0
    } else {
      wikilinkIndex.value = 0
    }
    wikilinkOpen.value = true
    void nextTick().then(() => repositionWikilinkMenu())
    void refreshWikilinkHeadingResults(query)
  }

  function repositionWikilinkMenu() {
    if (!options.holder.value || !wikilinkMenuRef.value) return
    const holderEl = options.holder.value
    const menuRect = wikilinkMenuRef.value.getBoundingClientRect()
    const padding = 8

    const minLeft = holderEl.scrollLeft + padding
    const maxLeft = Math.max(minLeft, holderEl.scrollLeft + holderEl.clientWidth - menuRect.width - padding)
    wikilinkLeft.value = Math.min(Math.max(minLeft, wikilinkLeft.value), maxLeft)

    const minTop = holderEl.scrollTop + padding
    const maxTop = Math.max(minTop, holderEl.scrollTop + holderEl.clientHeight - menuRect.height - padding)
    wikilinkTop.value = Math.min(Math.max(minTop, wikilinkTop.value), maxTop)
  }

  function parseWikilinkQuery(raw: string): { notePart: string; headingPart: string | null } {
    const targetPart = raw.split('|', 1)[0]?.trim() ?? ''
    if (!targetPart) return { notePart: '', headingPart: null }
    if (targetPart.startsWith('#')) return { notePart: '', headingPart: targetPart.slice(1).trim() }
    const hashIndex = targetPart.indexOf('#')
    if (hashIndex < 0) return { notePart: targetPart, headingPart: null }
    return {
      notePart: targetPart.slice(0, hashIndex).trim(),
      headingPart: targetPart.slice(hashIndex + 1).trim()
    }
  }

  function uniqueHeadings(headings: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const heading of headings) {
      const text = heading.trim()
      if (!text) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(text)
    }
    return out
  }

  function headingResultsFor(baseTarget: string, headingQuery: string, headings: string[]) {
    const query = headingQuery.toLowerCase()
    return uniqueHeadings(headings)
      .filter((heading) => !query || heading.toLowerCase().includes(query))
      .slice(0, 24)
      .map((heading) => {
        const target = baseTarget ? `${baseTarget}#${heading}` : `#${heading}`
        return { id: `heading:${target}`, label: `#${heading}`, target, isCreate: false }
      })
  }

  async function refreshWikilinkHeadingResults(rawQuery: string) {
    if (!wikilinkOpen.value) return
    const parsed = parseWikilinkQuery(rawQuery)
    if (parsed.headingPart === null) {
      wikilinkHeadingResults.value = []
      return
    }

    if (!parsed.notePart) {
      const headings = options.parseOutlineFromDom().map((item) => item.text)
      wikilinkHeadingResults.value = headingResultsFor('', parsed.headingPart, headings)
      return
    }

    const cacheKey = parsed.notePart.toLowerCase()
    if (wikilinkHeadingCache.value[cacheKey]) {
      wikilinkHeadingResults.value = headingResultsFor(parsed.notePart, parsed.headingPart, wikilinkHeadingCache.value[cacheKey])
      return
    }

    const token = ++wikilinkHeadingLoadToken
    const headings = await options.loadLinkHeadings(parsed.notePart)
    if (token !== wikilinkHeadingLoadToken) return
    wikilinkHeadingCache.value = { ...wikilinkHeadingCache.value, [cacheKey]: headings }
    wikilinkHeadingResults.value = headingResultsFor(parsed.notePart, parsed.headingPart, headings)
  }

  function readWikilinkQueryAtCaret(): string | null {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return null
    const node = selection.focusNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return null
    const text = node.textContent ?? ''
    const offset = selection.focusOffset
    if (offset < 2) return null

    const uptoCaret = text.slice(0, offset)
    const start = uptoCaret.lastIndexOf('[[')
    if (start < 0) return null
    const closeFromStart = text.indexOf(']]', start + 2)
    if (closeFromStart >= 0 && offset >= closeFromStart + 2) return null
    if (uptoCaret.slice(start + 2).includes(']]')) return null
    const queryEnd = closeFromStart >= 0 ? Math.min(offset, closeFromStart) : offset
    const query = text.slice(start + 2, queryEnd)
    if (query.includes('\n')) return null
    if (query.includes('[') || query.includes(']')) return null
    return query
  }

  function parseWikilinkToken(token: string): { target: string; label: string } | null {
    if (!token.startsWith('[[') || !token.endsWith(']]')) return null
    const inner = token.slice(2, -2).trim()
    if (!inner) return null
    const [targetRaw, aliasRaw] = inner.split('|', 2)
    const target = targetRaw.trim()
    if (!target || target.includes('\n')) return null
    const defaultLabel = (() => {
      const parsed = parseWikilinkTarget(target)
      if (parsed.anchor?.heading && !parsed.notePath) return parsed.anchor.heading
      return target
    })()
    const label = (aliasRaw ?? '').trim() || defaultLabel
    return { target, label }
  }

  function parseHyperlinkToken(token: string): { href: string; label: string } | null {
    const match = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (!match) return null
    const label = match[1].trim()
    const href = match[2].trim()
    if (!label || !href || label.includes('\n') || href.includes('\n')) return null
    return { href, label }
  }

  function parseEditableLinkToken(token: string): EditableLinkToken | null {
    const wikilink = parseWikilinkToken(token)
    if (wikilink) return { kind: 'wikilink', target: wikilink.target, label: wikilink.label }
    const hyperlink = parseHyperlinkToken(token)
    if (hyperlink) return { kind: 'hyperlink', href: hyperlink.href, label: hyperlink.label }
    return null
  }

  function createWikilinkAnchor(target: string, label = target): HTMLAnchorElement {
    const anchor = document.createElement('a')
    anchor.href = `wikilink:${encodeURIComponent(target)}`
    anchor.dataset.wikilinkTarget = target
    anchor.textContent = label
    anchor.className = 'md-wikilink'
    return anchor
  }

  function createHyperlinkAnchor(href: string, label: string): HTMLAnchorElement {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.textContent = label
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    return anchor
  }

  function createAnchorFromToken(token: EditableLinkToken): HTMLAnchorElement {
    if (token.kind === 'wikilink') return createWikilinkAnchor(token.target, token.label)
    return createHyperlinkAnchor(token.href, token.label)
  }

  function readWikilinkTargetFromAnchor(anchor: HTMLAnchorElement): string {
    const dataTarget = anchor.dataset.wikilinkTarget?.trim()
    if (dataTarget) return dataTarget

    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (href.toLowerCase().startsWith('wikilink:')) {
      try {
        const decoded = decodeURIComponent(href.slice('wikilink:'.length)).trim()
        if (decoded) return decoded
      } catch {
        return ''
      }
    }

    if (href === '#') return anchor.textContent?.trim() ?? ''
    return ''
  }

  function replaceActiveWikilinkQuery(target: string, mode: 'final' | 'draft' = 'final') {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false
    const node = selection.focusNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return false
    const textNode = node as Text
    const text = textNode.data
    const offset = selection.focusOffset

    const start = text.slice(0, offset).lastIndexOf('[[')
    if (start < 0) return false
    const close = text.indexOf(']]', start + 2)
    const end = close >= 0 ? close + 2 : offset
    const currentQueryEnd = close >= 0 ? close : offset
    const currentQuery = text.slice(start + 2, currentQueryEnd)
    const explicitAlias = (currentQuery.split('|', 2)[1] ?? '').trim()

    const range = document.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, end)
    range.deleteContents()

    const rawToken = mode === 'final'
      ? buildWikilinkToken(target, explicitAlias || null)
      : buildWikilinkDraftToken(target)
    const insertedText = document.createTextNode(rawToken)
    range.insertNode(insertedText)
    expandedLinkContext = { textNode: insertedText, range: { start: 0, end: rawToken.length } }

    const nextRange = document.createRange()
    nextRange.setStart(insertedText, rawToken.length)
    nextRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(nextRange)
    return true
  }

  function defaultWikilinkLabel(target: string): string {
    const parsed = parseWikilinkTarget(target)
    if (parsed.anchor?.heading && !parsed.notePath) return parsed.anchor.heading
    return target
  }

  function tokenForAnchor(anchor: HTMLAnchorElement): string {
    const target = readWikilinkTargetFromAnchor(anchor)
    if (target) {
      const label = anchor.textContent?.trim() ?? ''
      const defaultLabel = defaultWikilinkLabel(target)
      if (label && label !== defaultLabel) return `[[${target}|${label}]]`
      return `[[${target}]]`
    }

    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (!href) return ''
    const label = anchor.textContent?.trim() ?? ''
    return `[${label || href}](${href})`
  }

  function nodeToEditableLinkAnchor(node: Node | null): HTMLAnchorElement | null {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null
    const element = node as HTMLElement
    if (element.tagName.toLowerCase() !== 'a') return null
    const anchor = element as HTMLAnchorElement
    return tokenForAnchor(anchor) ? anchor : null
  }

  function adjacentEditableLinkAnchor(selection: Selection, direction: 'left' | 'right'): HTMLAnchorElement | null {
    const node = selection.focusNode
    if (!node) return null
    const ownerElement =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : (node.parentElement as HTMLElement | null)
    const ownerAnchor = ownerElement?.closest('a') as HTMLAnchorElement | null
    if (ownerAnchor) return tokenForAnchor(ownerAnchor) ? ownerAnchor : null

    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text
      if (direction === 'left' && selection.focusOffset === 0) return nodeToEditableLinkAnchor(textNode.previousSibling)
      if (direction === 'right' && selection.focusOffset === textNode.length) return nodeToEditableLinkAnchor(textNode.nextSibling)
      return null
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      const childIndex = selection.focusOffset
      if (direction === 'left' && childIndex > 0) return nodeToEditableLinkAnchor(element.childNodes.item(childIndex - 1))
      if (direction === 'right' && childIndex < element.childNodes.length) return nodeToEditableLinkAnchor(element.childNodes.item(childIndex))
    }
    return null
  }

  function expandAdjacentLinkForEditing(direction: 'left' | 'right'): boolean {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false

    const anchor = adjacentEditableLinkAnchor(selection, direction)
    if (!anchor || !anchor.parentNode) return false
    const token = tokenForAnchor(anchor)
    if (!token) return false

    const textNode = document.createTextNode(token)
    anchor.parentNode.replaceChild(textNode, anchor)

    const range = document.createRange()
    const nextOffset = direction === 'left' ? Math.max(0, token.length - 1) : Math.min(token.length, 1)
    range.setStart(textNode, nextOffset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    expandedLinkContext = { textNode, range: { start: 0, end: token.length } }
    suppressCollapseOnNextArrowKeyup = true
    return true
  }

  function placeCaretAdjacentToAnchor(anchor: HTMLAnchorElement, place: 'before' | 'after', selection: Selection) {
    const parent = anchor.parentNode
    if (!parent) return false

    let textNode: Text | null = null
    let offset = 0
    if (place === 'after') {
      const next = anchor.nextSibling
      if (next && next.nodeType === Node.TEXT_NODE) {
        textNode = next as Text
        if ((textNode.textContent ?? '').length === 0) {
          textNode.textContent = ' '
          offset = 1
        } else {
          offset = 0
        }
      } else {
        textNode = document.createTextNode(' ')
        parent.insertBefore(textNode, next)
        offset = 1
      }
    } else {
      const prev = anchor.previousSibling
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        textNode = prev as Text
        if ((textNode.textContent ?? '').length === 0) textNode.textContent = ' '
        offset = (textNode.textContent ?? '').length
      } else {
        textNode = document.createTextNode(' ')
        parent.insertBefore(textNode, anchor)
        offset = 1
      }
    }

    const range = document.createRange()
    range.setStart(textNode, offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  function replaceTokenRangeWithAnchor(textNode: Text, start: number, end: number, place: 'before' | 'after'): boolean {
    if (!textNode.parentNode) return false
    if (start < 0 || end <= start || end > textNode.data.length) return false
    const token = textNode.data.slice(start, end)
    const parsed = parseEditableLinkToken(token)
    if (!parsed) return false

    const selection = window.getSelection()
    if (!selection) return false

    const range = document.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, end)
    range.deleteContents()

    const anchor = createAnchorFromToken(parsed)
    range.insertNode(anchor)
    if (!placeCaretAdjacentToAnchor(anchor, place, selection)) return false
    if (expandedLinkContext) expandedLinkContext = null
    return true
  }

  function caretRelationToTokenRange(selection: Selection, context: ArrowLinkContext): 'before' | 'inside' | 'after' {
    if (!selection.rangeCount || !selection.isCollapsed) return 'after'
    if (!context.textNode.isConnected) return 'after'
    if (context.range.start < 0 || context.range.end < context.range.start || context.range.end > context.textNode.data.length) return 'after'
    if (!selection.focusNode) return 'after'
    if (selection.focusNode.ownerDocument !== context.textNode.ownerDocument) return 'after'

    const tokenRange = context.textNode.ownerDocument.createRange()
    tokenRange.setStart(context.textNode, context.range.start)
    tokenRange.setEnd(context.textNode, context.range.end)

    if (selection.focusNode === context.textNode) {
      const offset = selection.focusOffset
      if (offset < context.range.start) return 'before'
      if (offset > context.range.end) return 'after'
      return 'inside'
    }

    try {
      const position = tokenRange.comparePoint(selection.focusNode as Node, selection.focusOffset)
      if (position < 0) return 'before'
      if (position > 0) return 'after'
      return 'inside'
    } catch {
      return 'after'
    }
  }

  function collapseExpandedLinkIfCaretOutside(): boolean {
    if (!expandedLinkContext) return false
    const context = expandedLinkContext
    if (!context.textNode.isConnected) {
      expandedLinkContext = null
      return false
    }
    if (context.range.start < 0 || context.range.end < context.range.start || context.range.end > context.textNode.data.length) {
      expandedLinkContext = null
      return false
    }

    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) {
      expandedLinkContext = null
      return false
    }

    let relation: 'before' | 'inside' | 'after' = 'after'
    try {
      relation = caretRelationToTokenRange(selection, context)
    } catch {
      expandedLinkContext = null
      return false
    }
    if (relation === 'inside') return false

    const place = relation === 'before' ? 'before' : 'after'
    const collapsed = replaceTokenRangeWithAnchor(context.textNode, context.range.start, context.range.end, place)
    if (!collapsed) expandedLinkContext = null
    return collapsed
  }

  function findMarkdownLinkRangeEndingAt(text: string, offset: number): { start: number; end: number } | null {
    if (offset < 1 || text[offset - 1] !== ')') return null
    const openParen = text.lastIndexOf('(', offset - 1)
    if (openParen < 0) return null
    const closeBracket = openParen - 1
    if (closeBracket < 0 || text[closeBracket] !== ']') return null
    const openBracket = text.lastIndexOf('[', closeBracket)
    if (openBracket < 0) return null
    if (openBracket > 0 && text[openBracket - 1] === '!') return null
    const token = text.slice(openBracket, offset)
    return parseHyperlinkToken(token) ? { start: openBracket, end: offset } : null
  }

  function findMarkdownLinkRangeStartingAt(text: string, offset: number): { start: number; end: number } | null {
    if (text[offset] !== '[' || text[offset + 1] === '[') return null
    if (offset > 0 && text[offset - 1] === '!') return null
    const closeBracket = text.indexOf('](', offset + 1)
    if (closeBracket < 0) return null
    const closeParen = text.indexOf(')', closeBracket + 2)
    if (closeParen < 0) return null
    const token = text.slice(offset, closeParen + 1)
    return parseHyperlinkToken(token) ? { start: offset, end: closeParen + 1 } : null
  }

  function collapseClosedLinkNearCaret(): boolean {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false
    const node = selection.focusNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return false
    const textNode = node as Text
    const text = textNode.data
    const offset = selection.focusOffset

    if (offset >= 2 && text.slice(offset - 2, offset) === ']]') {
      const start = text.lastIndexOf('[[', offset - 2)
      if (start >= 0) {
        const close = text.indexOf(']]', start + 2)
        if (close >= 0 && close + 2 === offset) {
          return replaceTokenRangeWithAnchor(textNode, start, offset, 'after')
        }
      }
    }

    if (text.slice(offset, offset + 2) === '[[') {
      const close = text.indexOf(']]', offset + 2)
      if (close >= 0) return replaceTokenRangeWithAnchor(textNode, offset, close + 2, 'before')
    }

    const endingMarkdown = findMarkdownLinkRangeEndingAt(text, offset)
    if (endingMarkdown) return replaceTokenRangeWithAnchor(textNode, endingMarkdown.start, endingMarkdown.end, 'after')
    const startingMarkdown = findMarkdownLinkRangeStartingAt(text, offset)
    if (startingMarkdown) return replaceTokenRangeWithAnchor(textNode, startingMarkdown.start, startingMarkdown.end, 'before')
    return false
  }

  async function applyWikilinkSelection(target: string) {
    const replaced = replaceActiveWikilinkQuery(target, 'final')
    closeWikilinkMenu()
    if (!replaced) return

    const path = options.currentPath.value
    if (path) {
      options.setDirty(path, true)
      options.setSaveError(path, '')
      options.scheduleAutosave()
    }
    await nextTick()
    collapseClosedLinkNearCaret()
  }

  async function applyWikilinkDraftSelection(target: string) {
    const replaced = replaceActiveWikilinkQuery(target, 'draft')
    closeWikilinkMenu()
    if (!replaced) return

    const path = options.currentPath.value
    if (path) {
      options.setDirty(path, true)
      options.setSaveError(path, '')
      options.scheduleAutosave()
    }
  }

  function extractTokenAtCaret(): string {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return ''
    const node = selection.focusNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return ''
    const text = node.textContent ?? ''
    const offset = selection.focusOffset
    const isBoundary = (value: string) => /[^\w\-\[\]\/|#]/.test(value)

    let start = offset
    while (start > 0 && !isBoundary(text[start - 1])) start -= 1
    let end = offset
    while (end < text.length && !isBoundary(text[end])) end += 1
    return text.slice(start, end).trim()
  }

  function isDateLinkModifierPressed(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'> | Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
    return options.isMacOs ? Boolean(event.metaKey) : Boolean(event.ctrlKey)
  }

  async function openLinkTargetWithAutosave(target: string) {
    const path = options.currentPath.value
    if (path && options.dirtyByPath.value[path]) {
      options.clearAutosaveTimer()
      await options.saveCurrentFile(false)
      if (options.dirtyByPath.value[path]) return
    }
    await options.openLinkTarget(target)
  }

  async function openLinkedTokenAtCaret() {
    const token = extractTokenAtCaret()
    if (!token) return
    const wikilink = parseWikilinkToken(token)
    if (wikilink) {
      await openLinkTargetWithAutosave(wikilink.target)
      return
    }
    const dateMatch = token.match(/^\d{4}-\d{2}-\d{2}$/)
    if (!dateMatch) return
    await openLinkTargetWithAutosave(dateMatch[0])
  }

  async function syncWikilinkMenuFromCaret() {
    const query = readWikilinkQueryAtCaret()
    if (query === null) {
      closeWikilinkMenu()
      return
    }
    if (!wikilinkOpen.value) await refreshWikilinkTargets()
    openWikilinkMenuAtCaret(query, true)
  }

  return {
    wikilinkOpen,
    wikilinkIndex,
    wikilinkLeft,
    wikilinkTop,
    wikilinkResults,
    closeWikilinkMenu,
    applyWikilinkSelection,
    applyWikilinkDraftSelection,
    expandAdjacentLinkForEditing,
    collapseExpandedLinkIfCaretOutside,
    consumeSuppressCollapseOnArrowKeyup,
    collapseClosedLinkNearCaret,
    shouldSyncWikilinkFromSelection,
    isWikilinkRelevantKey,
    syncWikilinkMenuFromCaret,
    readWikilinkTargetFromAnchor,
    openLinkTargetWithAutosave,
    isDateLinkModifierPressed,
    openLinkedTokenAtCaret,
    setMenuElement,
    repositionWikilinkMenu
  }
}
