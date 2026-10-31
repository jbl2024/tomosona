import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellWorkspaceEntries } from './useAppShellWorkspaceEntries'

function createEntries() {
  const statePort = {
    workingFolderPath: ref('/vault'),
    activeFilePath: ref('/vault/current.md'),
    newFilePathInput: ref(''),
    newFileModalError: ref(''),
    newFileTemplatePath: ref(''),
    newFolderPathInput: ref(''),
    newFolderModalError: ref(''),
    openDateInput: ref(''),
    openDateModalError: ref('')
  }
  const documentPort = {
    normalizeRelativeNotePath: vi.fn((value: string) => value.trim().replace(/\\/g, '/')),
    hasForbiddenEntryNameChars: vi.fn((value: string) => /[<>:"\\|?*]/.test(value)),
    isReservedEntryName: vi.fn((value: string) => value.toUpperCase() === 'CON'),
    parentPrefixForModal: vi.fn((parentPath: string, root: string) => parentPath.replace(`${root}/`, '')),
    parseIsoDateInput: vi.fn((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null)
  }
    const fsPort = {
      listChildren: vi.fn(async () => [{ name: 'notes', is_dir: true }]),
      pathExists: vi.fn(async () => false),
      createEntry: vi.fn(async (parent: string, name: string) => `${parent}/${name}`),
      ensureParentFolders: vi.fn(async () => {}),
      readTextFile: vi.fn(async (_path: string) => ''),
      writeTextFile: vi.fn(async () => {}),
      openTabWithAutosave: vi.fn(async () => true),
    upsertWorkspaceFilePath: vi.fn(),
    openDailyNote: vi.fn(async () => true)
  }
  const modalPort = {
    openNewFileModal: vi.fn(async () => {}),
    closeNewFileModal: vi.fn(),
    openNewFolderModal: vi.fn(async () => {}),
    closeNewFolderModal: vi.fn(),
    openOpenDateModal: vi.fn(async () => {}),
    closeOpenDateModal: vi.fn()
  }

  const scope = effectScope()
  const api = scope.run(() => useAppShellWorkspaceEntries({
    statePort,
    documentPort,
    fsPort,
    modalPort
  }))
  if (!api) throw new Error('Expected workspace entries controller')

  return { api, scope, statePort, documentPort, fsPort, modalPort }
}

describe('useAppShellWorkspaceEntries', () => {
  it('suggests a notes/ prefix when opening a new file from the palette', async () => {
    const { api, scope, modalPort } = createEntries()

    expect(await api.createNewFileFromPalette()).toBe(true)
    expect(modalPort.openNewFileModal).toHaveBeenCalledWith('notes/')
    scope.stop()
  })

  it('prefills the active note directory when opening a new file from the keyboard shortcut', async () => {
    const { api, scope, statePort, modalPort, documentPort } = createEntries()
    statePort.activeFilePath.value = '/vault/test/foo.md'
    documentPort.parentPrefixForModal.mockReturnValue('test/')

    expect(await api.createNewFileFromActiveDirectory()).toBe(true)

    expect(documentPort.parentPrefixForModal).toHaveBeenCalledWith('/vault/test', '/vault')
    expect(modalPort.openNewFileModal).toHaveBeenCalledWith('test/')
    scope.stop()
  })

  it('opens the correct modal prefill from explorer create requests', () => {
    const { api, scope, modalPort } = createEntries()

    api.onExplorerRequestCreate({ parentPath: '/vault/projects', entryKind: 'folder' })
    api.onExplorerRequestCreate({ parentPath: '/vault/projects', entryKind: 'file' })

    expect(modalPort.openNewFolderModal).toHaveBeenCalledWith('projects')
    expect(modalPort.openNewFileModal).toHaveBeenCalledWith('projects')
    scope.stop()
  })

  it('validates and creates a new markdown file seeded with its title heading', async () => {
    const { api, scope, statePort, fsPort, modalPort } = createEntries()
    statePort.newFilePathInput.value = 'ideas/today'

    expect(await api.submitNewFileFromModal()).toBe(true)
    expect(fsPort.ensureParentFolders).toHaveBeenCalledWith('/vault/ideas/today.md')
    expect(fsPort.writeTextFile).toHaveBeenCalledWith('/vault/ideas/today.md', '# today')
    expect(fsPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/ideas/today.md')
    expect(modalPort.closeNewFileModal).toHaveBeenCalled()
    scope.stop()
  })

  it('copies template content when a template is selected', async () => {
    const { api, scope, statePort, fsPort } = createEntries()
    statePort.newFilePathInput.value = 'meetings/weekly'
    statePort.newFileTemplatePath.value = '/vault/_templates/meetings/regular.md'
    fsPort.readTextFile = vi.fn(async (path: string) => {
      if (path === '/vault/_templates/meetings/regular.md') {
        return '# Weekly meeting\n'
      }
      return ''
    })

    expect(await api.submitNewFileFromModal()).toBe(true)
    expect(fsPort.readTextFile).toHaveBeenCalledWith('/vault/_templates/meetings/regular.md')
    expect(fsPort.writeTextFile).toHaveBeenCalledWith('/vault/meetings/weekly.md', '# Weekly meeting\n')
    expect(fsPort.openTabWithAutosave).toHaveBeenCalledWith('/vault/meetings/weekly.md')
    scope.stop()
  })

  it('fails cleanly when the selected template cannot be read', async () => {
    const { api, scope, statePort, fsPort } = createEntries()
    statePort.newFilePathInput.value = 'ideas/template-fail'
    statePort.newFileTemplatePath.value = '/vault/_templates/missing.md'
    fsPort.readTextFile = vi.fn(async () => {
      throw new Error('missing template')
    })

    expect(await api.submitNewFileFromModal()).toBe(false)
    expect(statePort.newFileModalError.value).toBe('Could not read the selected template.')
    expect(fsPort.writeTextFile).not.toHaveBeenCalled()
    scope.stop()
  })

  it('rejects invalid folder paths and reserved names', async () => {
    const { api, scope, statePort } = createEntries()
    statePort.newFolderPathInput.value = '../bad'
    expect(await api.submitNewFolderFromModal()).toBe(false)
    expect(statePort.newFolderModalError.value).toContain('inside the workspace')

    statePort.newFolderPathInput.value = 'CON'
    expect(await api.submitNewFolderFromModal()).toBe(false)
    expect(statePort.newFolderModalError.value).toContain('reserved')
    scope.stop()
  })

  it('opens a valid specific date and closes the modal', async () => {
    const { api, scope, statePort, fsPort, modalPort } = createEntries()
    statePort.openDateInput.value = '2026-03-11'

    expect(await api.submitOpenDateFromModal()).toBe(true)
    expect(fsPort.openDailyNote).toHaveBeenCalledWith('2026-03-11')
    expect(modalPort.closeOpenDateModal).toHaveBeenCalled()
    scope.stop()
  })
})
