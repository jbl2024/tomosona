import type { Ref } from 'vue'

/** Groups workspace refs and input state used by shell entry flows. */
export type AppShellWorkspaceEntriesStatePort = {
  workingFolderPath: Readonly<Ref<string>>
  activeFilePath: Readonly<Ref<string>>
  newFilePathInput: Ref<string>
  newFileModalError: Ref<string>
  newFileTemplatePath: Ref<string>
  newFolderPathInput: Ref<string>
  newFolderModalError: Ref<string>
  openDateInput: Ref<string>
  openDateModalError: Ref<string>
}

/** Groups document/path helpers used by shell entry flows. */
export type AppShellWorkspaceEntriesDocumentPort = {
  normalizeRelativeNotePath: (value: string) => string | null
  hasForbiddenEntryNameChars: (name: string) => boolean
  isReservedEntryName: (name: string) => boolean
  parentPrefixForModal: (parentPath: string, workspaceRoot: string) => string
  parseIsoDateInput: (value: string) => string | null
}

/** Filesystem and navigation APIs used by shell entry flows. */
export type AppShellWorkspaceEntriesFsPort = {
  listChildren: (path: string) => Promise<Array<{ name: string; is_dir: boolean }>>
  pathExists: (path: string) => Promise<boolean>
  createEntry: (parentPath: string, name: string, kind: 'file' | 'folder', conflict: 'fail' | 'rename') => Promise<string>
  ensureParentFolders: (path: string) => Promise<void>
  readTextFile: (path: string) => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>
  openTabWithAutosave: (path: string, options?: { recordHistory?: boolean; targetPaneId?: string; revealInTargetPane?: boolean }) => Promise<boolean>
  upsertWorkspaceFilePath: (path: string) => void
  openDailyNote: (date: string) => Promise<boolean>
}

/** Modal actions used by shell entry flows. */
export type AppShellWorkspaceEntriesModalPort = {
  openNewFileModal: (prefill?: string) => Promise<void>
  closeNewFileModal: () => void
  openNewFolderModal: (prefill?: string) => Promise<void>
  closeNewFolderModal: () => void
  openOpenDateModal: () => Promise<void>
  closeOpenDateModal: () => void
}

/** Declares the dependencies required by the shell workspace entry controller. */
export type UseAppShellWorkspaceEntriesOptions = {
  statePort: AppShellWorkspaceEntriesStatePort
  documentPort: AppShellWorkspaceEntriesDocumentPort
  fsPort: AppShellWorkspaceEntriesFsPort
  modalPort: AppShellWorkspaceEntriesModalPort
}

/**
 * Owns shell workflows for new-file, new-folder, and open-date entry forms.
 *
 * Boundaries:
 * - Handles shell form wiring, prefix suggestions, and validation.
 * - Delegates actual persistence/navigation to injected public APIs.
 */
export function useAppShellWorkspaceEntries(options: UseAppShellWorkspaceEntriesOptions) {
  async function suggestedNotePathPrefix(): Promise<string> {
    const root = options.statePort.workingFolderPath.value
    if (!root) return ''

    try {
      const rootChildren = await options.fsPort.listChildren(root)
      if (rootChildren.some((entry) => entry.is_dir && entry.name.toLowerCase() === 'notes')) {
        return 'notes/'
      }
    } catch {
      // Fall back to active path below.
    }

    const activePath = options.statePort.activeFilePath.value
    if (!activePath) return ''
    return options.documentPort.parentPrefixForModal(activePath.replace(/\/[^/]+$/, ''), root)
  }

  async function createNewFileFromPalette() {
    const prefill = await suggestedNotePathPrefix()
    await options.modalPort.openNewFileModal(prefill)
    return true
  }

  async function createNewFileFromActiveDirectory() {
    const root = options.statePort.workingFolderPath.value
    const activePath = options.statePort.activeFilePath.value
    const prefill = root && activePath
      ? options.documentPort.parentPrefixForModal(activePath.replace(/\/[^/]+$/, ''), root)
      : ''
    await options.modalPort.openNewFileModal(prefill)
    return true
  }

  async function openSpecificDateNote() {
    await options.modalPort.openOpenDateModal()
    return true
  }

  async function ensureParentDirectoriesForRelativePath(relativePath: string): Promise<string> {
    const root = options.statePort.workingFolderPath.value
    if (!root) {
      throw new Error('Working folder is not set.')
    }

    const parts = relativePath.split('/').filter(Boolean)
    if (parts.length <= 1) return root

    let current = root
    for (const segment of parts.slice(0, -1)) {
      const next = `${current}/${segment}`
      const exists = await options.fsPort.pathExists(next)
      if (!exists) {
        await options.fsPort.createEntry(current, segment, 'folder', 'fail')
      }
      current = next
    }

    return current
  }

  function onExplorerRequestCreate(payload: { parentPath: string; entryKind: 'file' | 'folder' }) {
    const prefill = options.documentPort.parentPrefixForModal(payload.parentPath, options.statePort.workingFolderPath.value)
    if (payload.entryKind === 'folder') {
      void options.modalPort.openNewFolderModal(prefill)
      return
    }
    void options.modalPort.openNewFileModal(prefill)
  }

  async function submitNewFileFromModal() {
    const root = options.statePort.workingFolderPath.value
    if (!root) {
      options.statePort.newFileModalError.value = 'Working folder is not set.'
      return false
    }

    const normalized = options.documentPort.normalizeRelativeNotePath(options.statePort.newFilePathInput.value)
    if (!normalized || normalized.endsWith('/')) {
      options.statePort.newFileModalError.value = 'Invalid file path.'
      return false
    }
    if (normalized.startsWith('../') || normalized === '..') {
      options.statePort.newFileModalError.value = 'Path must stay inside the workspace.'
      return false
    }

    const parts = normalized.split('/').filter(Boolean)
    if (parts.some((part) => options.documentPort.hasForbiddenEntryNameChars(part))) {
      options.statePort.newFileModalError.value = 'File names cannot include < > : " \\ | ? *'
      return false
    }

    const rawName = parts[parts.length - 1]
    const stem = rawName.replace(/\.(md|markdown)$/i, '')
    if (!stem) {
      options.statePort.newFileModalError.value = 'File name is required.'
      return false
    }
    if (options.documentPort.isReservedEntryName(stem)) {
      options.statePort.newFileModalError.value = 'That file name is reserved by the OS.'
      return false
    }
    const name = /\.(md|markdown)$/i.test(rawName) ? rawName : `${rawName}.md`
    const relativeWithExt = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/${name}` : name
    const fullPath = `${root}/${relativeWithExt}`
    const templatePath = options.statePort.newFileTemplatePath.value.trim()
    let templateContent = ''

    if (templatePath) {
      try {
        templateContent = await options.fsPort.readTextFile(templatePath)
      } catch {
        options.statePort.newFileModalError.value = 'Could not read the selected template.'
        return false
      }
    }

    try {
      if (await options.fsPort.pathExists(fullPath)) {
        options.statePort.newFileModalError.value = 'A note already exists at that path.'
        return false
      }

      await options.fsPort.ensureParentFolders(fullPath)
      // Without a template, seed the note with a `# <file name>` first line so
      // the title heading sync engages from creation; template content is
      // written verbatim.
      const initialContent = templatePath ? templateContent : `# ${stem}`
      await options.fsPort.writeTextFile(fullPath, initialContent)
      const opened = await options.fsPort.openTabWithAutosave(fullPath)
      if (!opened) return false
      options.fsPort.upsertWorkspaceFilePath(fullPath)
      options.modalPort.closeNewFileModal()
      return true
    } catch {
      options.statePort.newFileModalError.value = 'Could not create file.'
      return false
    }
  }

  async function submitNewFolderFromModal() {
    const root = options.statePort.workingFolderPath.value
    if (!root) {
      options.statePort.newFolderModalError.value = 'Working folder is not set.'
      return false
    }

    const normalized = options.documentPort.normalizeRelativeNotePath(options.statePort.newFolderPathInput.value)
    if (!normalized || normalized.endsWith('/')) {
      options.statePort.newFolderModalError.value = 'Invalid folder path.'
      return false
    }
    if (normalized.startsWith('../') || normalized === '..') {
      options.statePort.newFolderModalError.value = 'Path must stay inside the workspace.'
      return false
    }

    const parts = normalized.split('/').filter(Boolean)
    if (parts.some((part) => options.documentPort.hasForbiddenEntryNameChars(part))) {
      options.statePort.newFolderModalError.value = 'Folder names cannot include < > : " \\ | ? *'
      return false
    }

    const name = parts[parts.length - 1]
    if (!name) {
      options.statePort.newFolderModalError.value = 'Folder name is required.'
      return false
    }
    if (options.documentPort.isReservedEntryName(name)) {
      options.statePort.newFolderModalError.value = 'That folder name is reserved by the OS.'
      return false
    }

    try {
      const parentPath = await ensureParentDirectoriesForRelativePath(normalized)
      await options.fsPort.createEntry(parentPath, name, 'folder', 'fail')
      options.modalPort.closeNewFolderModal()
      return true
    } catch (err) {
      options.statePort.newFolderModalError.value = err instanceof Error ? err.message : 'Could not create folder.'
      return false
    }
  }

  async function submitOpenDateFromModal() {
    const isoDate = options.documentPort.parseIsoDateInput(options.statePort.openDateInput.value.trim())
    if (!isoDate) {
      options.statePort.openDateModalError.value = 'Invalid date. Use YYYY-MM-DD (example: 2026-02-22).'
      return false
    }
    const opened = await options.fsPort.openDailyNote(isoDate)
    if (!opened) return false
    options.modalPort.closeOpenDateModal()
    return true
  }

  return {
    createNewFileFromPalette,
    createNewFileFromActiveDirectory,
    openSpecificDateNote,
    ensureParentDirectoriesForRelativePath,
    onExplorerRequestCreate,
    submitNewFileFromModal,
    submitNewFolderFromModal,
    submitOpenDateFromModal
  }
}
