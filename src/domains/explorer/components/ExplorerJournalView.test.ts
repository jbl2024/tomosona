import { createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorerJournalView from './ExplorerJournalView.vue'
import type { TreeNode } from '../../../shared/api/apiTypes'
import { formatIsoDate } from '../../../app/lib/appShellPaths'
import { journalFolderStorageKey } from '../../../app/lib/journalFolder'

const listChildren = vi.fn()
const pathExists = vi.fn()

vi.mock('../../../shared/api/workspaceApi', () => ({
  listChildren: (...args: unknown[]) => listChildren(...args),
  pathExists: (...args: unknown[]) => pathExists(...args)
}))

function dirNode(path: string): TreeNode {
  return { name: path.split('/').pop() ?? path, path, is_dir: true, is_markdown: false, has_children: true }
}

function fileNode(path: string): TreeNode {
  return { name: path.split('/').pop() ?? path, path, is_dir: false, is_markdown: true, has_children: false }
}

/** Builds a `listChildren` implementation from a directory -> children map. */
function treeOf(map: Record<string, TreeNode[]>) {
  return async (dirPath: string) => {
    const children = map[dirPath]
    if (!children) throw new Error(`missing directory: ${dirPath}`)
    return children
  }
}

type ViewProps = {
  root: string
  activePath?: string
  onOpen?: (path: string) => void
  onOrganize?: (plan: unknown) => void
  onError?: (message: string) => void
}

function mountView(props: ViewProps) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(() => h(ExplorerJournalView, props))
  app.mount(root)
  return { root, app }
}

/** Lets the recursive directory walk settle before asserting on the DOM. */
async function flush() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

describe('ExplorerJournalView', () => {
  const today = formatIsoDate(new Date())

  beforeEach(() => {
    window.localStorage.clear()
    listChildren.mockReset()
    pathExists.mockReset()
    pathExists.mockResolvedValue(true)
  })

  afterEach(() => { document.body.innerHTML = '' })

  it('groups dated notes by month, newest first, and marks today', async () => {
    listChildren.mockImplementation(treeOf({
      '/vault/journal': [dirNode('/vault/journal/2020'), dirNode('/vault/journal/2026')],
      '/vault/journal/2020': [dirNode('/vault/journal/2020/01'), dirNode('/vault/journal/2020/02')],
      '/vault/journal/2020/01': [fileNode('/vault/journal/2020/01/2020-01-05.md')],
      '/vault/journal/2020/02': [fileNode('/vault/journal/2020/02/2020-02-09.md')],
      '/vault/journal/2026': [fileNode(`/vault/journal/2026/${today}.md`)]
    }))

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    const months = Array.from(root.querySelectorAll('.explorer-journal-month')).map((el) => el.textContent?.trim())
    expect(months).toHaveLength(3)
    expect(months[1]).toBe('February 2020')
    expect(months[2]).toBe('January 2020')

    const todayRow = Array.from(root.querySelectorAll('.explorer-journal-entry'))
      .find((el) => el.textContent?.includes(today))
    expect(todayRow?.querySelector('.explorer-journal-today')?.textContent).toBe('Today')
    app.unmount()
  })

  it('shows the location of duplicate dates and ignores invalid dates', async () => {
    listChildren.mockImplementation(treeOf({
      '/vault/journal': [dirNode('/vault/journal/archive'), fileNode('/vault/journal/2020-02-09.md'), fileNode('/vault/journal/2020-02-31.md'), fileNode('/vault/journal/notes.md')],
      '/vault/journal/archive': [fileNode('/vault/journal/archive/2020-02-09.md')]
    }))

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    const rows = Array.from(root.querySelectorAll('.explorer-journal-entry'))
    expect(rows).toHaveLength(2)
    const locations = rows.map((row) => row.querySelector('.explorer-journal-location')?.textContent?.trim())
    expect(locations).toEqual(['2020-02-09.md', 'archive/2020-02-09.md'])
    expect(root.textContent).not.toContain('2020-02-31')
    expect(root.textContent).not.toContain('notes.md')
    app.unmount()
  })

  it('opens the real workspace path of an entry', async () => {
    listChildren.mockImplementation(treeOf({
      '/vault/journal': [fileNode('/vault/journal/2020-02-09.md')]
    }))
    const onOpen = vi.fn()

    const { root, app } = mountView({ root: '/vault', onOpen })
    await flush()

    ;(root.querySelector('.explorer-journal-entry') as HTMLButtonElement).click()
    expect(onOpen).toHaveBeenCalledWith('/vault/journal/2020-02-09.md')
    app.unmount()
  })

  it('explains an empty journal instead of failing when the folder is missing', async () => {
    pathExists.mockResolvedValue(false)

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    expect(root.textContent).toContain('No dated notes')
    expect(listChildren).not.toHaveBeenCalled()
    app.unmount()
  })

  it('shows the journal folder as a button and only edits it on demand', async () => {
    listChildren.mockImplementation(treeOf({ '/vault/journal': [] }))

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    const folderButton = root.querySelector('button[aria-label="Journal folder"]') as HTMLButtonElement
    expect(folderButton.textContent?.trim()).toBe('journal')
    expect(root.querySelector('input[aria-label="Journal folder path"]')).toBeNull()

    folderButton.click()
    await flush()

    const input = root.querySelector('input[aria-label="Journal folder path"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('journal')
    expect(document.activeElement).toBe(input)
    app.unmount()
  })

  it('persists a new journal folder and reloads from it', async () => {
    listChildren.mockImplementation(treeOf({
      '/vault/daily': [fileNode('/vault/daily/2020-02-09.md')]
    }))

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    ;(root.querySelector('button[aria-label="Journal folder"]') as HTMLButtonElement).click()
    await flush()

    const input = root.querySelector('input[aria-label="Journal folder path"]') as HTMLInputElement
    input.value = 'daily'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()

    expect(window.localStorage.getItem(journalFolderStorageKey('/vault'))).toBe('daily')
    expect(listChildren).toHaveBeenCalledWith('/vault/daily')
    expect(root.querySelectorAll('.explorer-journal-entry')).toHaveLength(1)
    expect(root.querySelector('input[aria-label="Journal folder path"]')).toBeNull()
    expect(root.querySelector('button[aria-label="Journal folder"]')?.textContent?.trim()).toBe('daily')
    app.unmount()
  })

  it('discards the draft when the folder editor is cancelled', async () => {
    listChildren.mockImplementation(treeOf({ '/vault/journal': [] }))

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    ;(root.querySelector('button[aria-label="Journal folder"]') as HTMLButtonElement).click()
    await flush()

    const input = root.querySelector('input[aria-label="Journal folder path"]') as HTMLInputElement
    input.value = 'daily'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()

    expect(window.localStorage.getItem(journalFolderStorageKey('/vault'))).toBeNull()
    expect(root.querySelector('input[aria-label="Journal folder path"]')).toBeNull()
    expect(root.querySelector('button[aria-label="Journal folder"]')?.textContent?.trim()).toBe('journal')
    app.unmount()
  })

  it('offers organization only for dispersed dated notes', async () => {
    listChildren.mockImplementation(treeOf({
      '/vault/journal': [fileNode('/vault/journal/2020-02-09.md'), dirNode('/vault/journal/2020')],
      '/vault/journal/2020': [dirNode('/vault/journal/2020/02')],
      '/vault/journal/2020/02': [fileNode('/vault/journal/2020/02/2020-02-10.md')]
    }))
    const onOrganize = vi.fn()

    const { root, app } = mountView({ root: '/vault', onOrganize })
    await flush()

    const organizeButton = Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Organize')) as HTMLButtonElement
    expect(organizeButton.disabled).toBe(false)
    organizeButton.click()

    expect(onOrganize).toHaveBeenCalledTimes(1)
    const plan = onOrganize.mock.calls[0][0] as { moves: Array<{ from: string; to: string }>; organized: number }
    expect(plan.moves).toEqual([
      { from: '/vault/journal/2020-02-09.md', to: '/vault/journal/2020/02/2020-02-09.md', date: '2020-02-09' }
    ])
    expect(plan.organized).toBe(1)
    app.unmount()
  })

  it('disables organization when every dated note is already organized', async () => {
    listChildren.mockImplementation(treeOf({
      '/vault/journal': [dirNode('/vault/journal/2020')],
      '/vault/journal/2020': [dirNode('/vault/journal/2020/02')],
      '/vault/journal/2020/02': [fileNode('/vault/journal/2020/02/2020-02-10.md')]
    }))

    const { root, app } = mountView({ root: '/vault' })
    await flush()

    const organizeButton = Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Organize')) as HTMLButtonElement
    expect(organizeButton.disabled).toBe(true)
    app.unmount()
  })
})
