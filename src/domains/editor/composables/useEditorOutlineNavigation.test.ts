import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorOutlineNavigation } from './useEditorOutlineNavigation'

function createNavigation(overrides: Partial<Parameters<typeof useEditorOutlineNavigation>[0]> = {}) {
  const holder = ref<HTMLElement | null>(document.createElement('div'))
  const emitOutline = vi.fn()

  const nav = useEditorOutlineNavigation({
    holder,
    virtualTitleBlockId: '__virtual_title__',
    emitOutline,
    normalizeHeadingAnchor: (heading: string) => heading.trim().toLowerCase().replace(/\s+/g, '-'),
    slugifyHeading: (heading: string) => heading.trim().toLowerCase().replace(/\s+/g, '-'),
    normalizeBlockId: (blockId: string) => blockId.trim().replace(/^\^+/, '').toLowerCase(),
    nextUiTick: async () => {
      await Promise.resolve()
    },
    ...overrides
  })

  return { nav, holder, emitOutline }
}

function makeBlock(id: string, child: HTMLElement) {
  const block = document.createElement('div')
  block.className = 'ce-block'
  block.dataset.id = id
  block.appendChild(child)
  return block
}

describe('useEditorOutlineNavigation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('parses outline headings and excludes virtual title block', () => {
    const { nav, holder } = createNavigation()
    const holderEl = holder.value as HTMLElement

    const virtualHeader = document.createElement('h1')
    virtualHeader.className = 'ce-header'
    virtualHeader.innerText = 'Virtual'
    holderEl.appendChild(makeBlock('__virtual_title__', virtualHeader))

    const h2 = document.createElement('h2')
    h2.className = 'ce-header'
    h2.innerText = 'Section A'
    holderEl.appendChild(makeBlock('b1', h2))

    const h4 = document.createElement('h4')
    h4.className = 'ce-header'
    h4.innerText = 'Section B'
    holderEl.appendChild(makeBlock('b2', h4))

    expect(nav.parseOutlineFromDom()).toEqual([
      { level: 2, text: 'Section A' },
      { level: 3, text: 'Section B' }
    ])
  })

  it('reveals by heading slug and by block-id anchor marker', async () => {
    const { nav, holder } = createNavigation()
    const holderEl = holder.value as HTMLElement

    const header = document.createElement('h2')
    header.className = 'ce-header'
    header.innerText = 'My Heading'
    const headerScrollSpy = vi.fn()
    header.scrollIntoView = headerScrollSpy
    holderEl.appendChild(makeBlock('h1', header))

    const paragraph = document.createElement('div')
    paragraph.setAttribute('contenteditable', 'true')
    paragraph.focus = vi.fn()
    const block = makeBlock('b2', paragraph)
    Object.defineProperty(block, 'innerText', {
      configurable: true,
      value: 'Task with ^item-42 reference'
    })
    const blockScrollSpy = vi.fn()
    block.scrollIntoView = blockScrollSpy
    holderEl.appendChild(block)

    const byHeading = await nav.revealAnchor({ heading: 'my heading' })
    expect(byHeading).toBe(true)
    expect(headerScrollSpy).toHaveBeenCalledTimes(1)

    const byBlockId = await nav.revealAnchor({ blockId: 'item-42' })
    expect(byBlockId).toBe(true)
    expect(blockScrollSpy).toHaveBeenCalledTimes(1)
  })

  it('retries reveal until delayed anchor appears', async () => {
    vi.useFakeTimers()

    const { nav, holder } = createNavigation({
      nextUiTick: async () => {
        await Promise.resolve()
      }
    })
    const holderEl = holder.value as HTMLElement

    setTimeout(() => {
      const lateHeader = document.createElement('h2')
      lateHeader.className = 'ce-header'
      lateHeader.innerText = 'Late Heading'
      lateHeader.scrollIntoView = vi.fn()
      holderEl.appendChild(makeBlock('late', lateHeader))
    }, 40)

    const pending = nav.revealAnchor({ heading: 'late heading' })
    await vi.advanceTimersByTimeAsync(200)

    await expect(pending).resolves.toBe(true)
  })

  it('reveals snippet by normalized visible text', async () => {
    const { nav, holder } = createNavigation()
    const holderEl = holder.value as HTMLElement

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    Object.defineProperty(editable, 'innerText', {
      configurable: true,
      value: 'Alpha  Beta  Gamma'
    })
    const scrollSpy = vi.fn()
    const focusSpy = vi.fn()
    editable.scrollIntoView = scrollSpy
    editable.focus = focusSpy
    holderEl.appendChild(makeBlock('s1', editable))

    await nav.revealSnippet('<b>Alpha</b>&nbsp; Beta')

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })
})
