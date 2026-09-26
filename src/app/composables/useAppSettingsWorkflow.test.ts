import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppSettingsWorkflow } from './useAppSettingsWorkflow'

const settingsApi = vi.hoisted(() => ({
  readAppSettings: vi.fn()
}))

vi.mock('../../shared/api/settingsApi', () => settingsApi)

describe('useAppSettingsWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsApi.readAppSettings.mockResolvedValue({
      exists: true,
      path: '/vault/.tomosona/conf.json',
      llm: null,
      embeddings: {
        mode: 'internal',
        external: null
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createWorkflow() {
    const markIndexOutOfSync = vi.fn()
    const notifySuccess = vi.fn()
    const notifyInfo = vi.fn()
    const closeSettingsModal = vi.fn()

    const workflow = useAppSettingsWorkflow({
      markIndexOutOfSync,
      notifySuccess,
      notifyInfo,
      closeSettingsModal
    })

    return {
      markIndexOutOfSync,
      notifySuccess,
      notifyInfo,
      closeSettingsModal,
      workflow
    }
  }

  it('applies save results and marks indexing out of sync when embeddings change', () => {
    const mounted = createWorkflow()

    mounted.workflow.onSettingsSaved({
      path: '/vault/.tomosona/conf.json',
      embeddings_changed: true,
    })

    expect(mounted.notifySuccess).toHaveBeenCalledWith('Settings saved at /vault/.tomosona/conf.json.')
    expect(mounted.markIndexOutOfSync).toHaveBeenCalledTimes(1)
    expect(mounted.notifyInfo).toHaveBeenCalledWith('Embedding settings changed. Rebuild index to resync semantic search.')
    expect(mounted.closeSettingsModal).toHaveBeenCalledTimes(1)
  })
})
