import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { listChildren, pathExists } from '../../../shared/api/workspaceApi'
import { formatIsoDate } from '../../../app/lib/appShellPaths'
import { journalFolderPath, readJournalFolder, writeJournalFolder } from '../../../app/lib/journalFolder'
import { planJournalOrganization, type JournalOrganizationPlan } from '../../../app/lib/journalOrganization'
import { buildJournalTimeline, type JournalTimeline } from '../../../app/lib/journalTimeline'

/**
 * Module: useExplorerJournal
 *
 * Purpose:
 * - Own the explorer's chronological journal view: the workspace journal-folder
 *   preference, the dated notes found under it, and the derived timeline.
 *
 * Boundaries:
 * - Reads the workspace through the typed API wrappers only; it never mutates
 *   files. Organization is planned here and executed by the explorer's safe
 *   mutation boundary.
 * - Stale asynchronous loads are discarded by token so switching workspace or
 *   journal folder cannot publish an older result.
 */

/** Declares the dependencies required by the journal view controller. */
export type UseExplorerJournalOptions = {
  root: Readonly<Ref<string>>
  /** Local-date provider, injectable so tests are not clock dependent. */
  today?: () => string
}

/** Controller backing the explorer's chronological journal view. */
export function useExplorerJournal(options: UseExplorerJournalOptions) {
  const journalFolder = ref(readJournalFolder(options.root.value))
  const paths = ref<string[]>([])
  const loading = ref(false)
  const error = ref('')
  let loadToken = 0

  const today = () => (options.today ?? (() => formatIsoDate(new Date())))()

  const timeline: ComputedRef<JournalTimeline> = computed(() =>
    buildJournalTimeline(paths.value, {
      journalFolder: journalFolderPath(options.root.value, journalFolder.value),
      today: today()
    })
  )

  const organizationPlan: ComputedRef<JournalOrganizationPlan> = computed(() =>
    planJournalOrganization(
      timeline.value.groups.flatMap((group) => group.entries),
      { root: options.root.value, journalFolder: journalFolder.value }
    )
  )

  async function collectDatedNotes(dirPath: string, token: number, out: string[]): Promise<void> {
    const children = await listChildren(dirPath)
    for (const child of children) {
      if (token !== loadToken) return
      if (child.is_dir) {
        await collectDatedNotes(child.path, token, out)
      } else if (child.is_markdown) {
        out.push(child.path)
      }
    }
  }

  /** Reloads the dated notes under the configured journal folder. */
  async function load(): Promise<void> {
    const token = ++loadToken
    const root = options.root.value
    if (!root) {
      paths.value = []
      error.value = ''
      return
    }

    loading.value = true
    error.value = ''
    const folderPath = journalFolderPath(root, journalFolder.value)
    try {
      const exists = await pathExists(folderPath).catch(() => false)
      if (token !== loadToken) return
      if (!exists) {
        paths.value = []
        return
      }
      const collected: string[] = []
      await collectDatedNotes(folderPath, token, collected)
      if (token !== loadToken) return
      paths.value = collected
    } catch {
      if (token !== loadToken) return
      paths.value = []
      error.value = 'The journal folder could not be read.'
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  /**
   * Persists a new journal folder for the workspace and reloads the view.
   *
   * Invalid input is ignored so the previous folder stays in effect.
   */
  async function setJournalFolder(folder: string): Promise<void> {
    const root = options.root.value
    if (!root) return
    writeJournalFolder(root, folder)
    const next = readJournalFolder(root)
    if (next === journalFolder.value) return
    journalFolder.value = next
    await load()
  }

  return {
    journalFolder,
    paths,
    loading,
    error,
    timeline,
    organizationPlan,
    load,
    setJournalFolder
  }
}
