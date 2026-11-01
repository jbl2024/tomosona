import { createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorerJournalOrganizeDialog from './ExplorerJournalOrganizeDialog.vue'
import type { MovePreflightEntry, MovePreflightIssue } from '../../../shared/api/apiTypes'
import type { JournalOrganizationPlan } from '../../../app/lib/journalOrganization'

const preflightMoveEntries = vi.fn()

vi.mock('../../../shared/api/workspaceApi', () => ({
  preflightMoveEntries: (...args: unknown[]) => preflightMoveEntries(...args)
}))

function preflightEntry(sourcePath: string, issue: MovePreflightIssue | null): MovePreflightEntry {
  return { sourcePath, destinationPath: null, sourceVersion: null, issue }
}

const plan: JournalOrganizationPlan = {
  moves: [
    { from: '/vault/journal/2020-02-09.md', to: '/vault/journal/2020/02/2020-02-09.md', date: '2020-02-09' },
    { from: '/vault/journal/archive/2020-02-10.md', to: '/vault/journal/2020/02/2020-02-10.md', date: '2020-02-10' }
  ],
  organized: 0,
  skipped: 0
}

type DialogProps = {
  plan: JournalOrganizationPlan
  onCancel?: () => void
  onConfirm?: (moves: unknown) => void
}

function mountDialog(props: DialogProps) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(() => h(ExplorerJournalOrganizeDialog, props))
  app.mount(root)
  return { root, app }
}

async function flush() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === label) as HTMLButtonElement
}

describe('ExplorerJournalOrganizeDialog', () => {
  beforeEach(() => {
    preflightMoveEntries.mockReset()
    preflightMoveEntries.mockImplementation(async (sources: string[]) => sources.map((source) => preflightEntry(source, null)))
  })

  afterEach(() => { document.body.innerHTML = '' })

  it('previews every source and destination before anything moves', async () => {
    const { root, app } = mountDialog({ plan })
    await flush()

    const rows = Array.from(root.querySelectorAll('.explorer-journal-plan-row'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('/vault/journal/2020-02-09.md')
    expect(rows[0].textContent).toContain('/vault/journal/2020/02/2020-02-09.md')
    expect(rows[0].textContent).toContain('Ready')
    // One preflight call per destination folder.
    expect(preflightMoveEntries).toHaveBeenCalledTimes(1)
    expect(preflightMoveEntries).toHaveBeenCalledWith(
      ['/vault/journal/2020-02-09.md', '/vault/journal/archive/2020-02-10.md'],
      '/vault/journal/2020/02'
    )
    app.unmount()
  })

  it('identifies collisions before execution', async () => {
    preflightMoveEntries.mockImplementation(async (sources: string[]) =>
      sources.map((source) => preflightEntry(source, source.includes('archive') ? 'collision' : null))
    )

    const { root, app } = mountDialog({ plan })
    await flush()

    const statuses = Array.from(root.querySelectorAll('.explorer-journal-plan-status')).map((el) => el.textContent?.trim())
    expect(statuses).toEqual(['Ready', 'Destination exists'])
    expect(root.textContent).toContain('1 destination already exists')
    expect(buttonByLabel(root, 'Organize').disabled).toBe(false)
    app.unmount()
  })

  it('cancels without emitting any move', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const { root, app } = mountDialog({ plan, onCancel, onConfirm })
    await flush()

    buttonByLabel(root, 'Cancel').click()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    app.unmount()
  })

  it('cancels on Escape', async () => {
    const onCancel = vi.fn()
    const { app } = mountDialog({ plan, onCancel })
    await flush()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('confirms with the planned moves', async () => {
    const onConfirm = vi.fn()
    const { root, app } = mountDialog({ plan, onConfirm })
    await flush()

    buttonByLabel(root, 'Organize').click()
    expect(onConfirm).toHaveBeenCalledWith(plan.moves)
    app.unmount()
  })

  it('blocks confirmation when every entry is blocked', async () => {
    preflightMoveEntries.mockImplementation(async (sources: string[]) =>
      sources.map((source) => preflightEntry(source, 'read_only'))
    )

    const { root, app } = mountDialog({ plan })
    await flush()

    expect(buttonByLabel(root, 'Organize').disabled).toBe(true)
    expect(root.textContent).toContain('2 notes cannot be moved')
    app.unmount()
  })

  it('reports a failed preview without enabling execution', async () => {
    preflightMoveEntries.mockRejectedValue(new Error('ipc down'))

    const { root, app } = mountDialog({ plan })
    await flush()

    expect(root.textContent).toContain('could not be checked')
    expect(buttonByLabel(root, 'Organize').disabled).toBe(true)
    app.unmount()
  })
})
