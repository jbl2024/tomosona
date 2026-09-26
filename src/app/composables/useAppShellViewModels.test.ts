import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { AppThemeDefinition } from '../../shared/lib/themeRegistry'
import type { EchoesItem } from '../../domains/echoes/lib/echoes'
import type { DocumentHistoryEntry } from '../../domains/editor/composables/useDocumentHistory'
import {
  buildMetadataRows,
  buildShortcutSections,
  buildSystemThemeLabel,
  buildThemePickerItems
} from '../lib/appShellPresentation'
import { useAppShellViewModels } from './useAppShellViewModels'
import type { LaunchpadRecentNote, LaunchpadRecentWorkspace } from '../lib/appShellViewModels'

describe('useAppShellViewModels', () => {
  it('derives shell view models from the provided shell state', () => {
    const availableThemes: AppThemeDefinition[] = [
      { id: 'tomosona-light', label: 'Tomosona Light', colorScheme: 'light', group: 'official' },
      { id: 'tokyo-night', label: 'Tokyo Night', colorScheme: 'dark', group: 'community' }
    ]
    const shortcutsFilterQuery = ref('tokyo')
    const themePickerQuery = ref('tokyo')
    const activeColorScheme = ref<'light' | 'dark'>('dark')
    const activeFilePath = ref('/vault/notes/alpha.md')
    const activeStatus = computed(() => ({ dirty: false, saving: false }))
    const activeFileMetadata = ref({ created_at_ms: 10, updated_at_ms: 20 })
    const virtualDocs = ref<Record<string, { content: string; titleLine: string }>>({})
    const editorZoom = ref(1.25)
    const backTargets = ref<Array<{ index: number; entry: DocumentHistoryEntry }>>([
      { index: 0, entry: { kind: 'note', path: '/vault/back.md', label: 'Back', stateKey: 'back-0' } }
    ])
    const forwardTargets = ref<Array<{ index: number; entry: DocumentHistoryEntry }>>([
      { index: 0, entry: { kind: 'note', path: '/vault/forward.md', label: 'Forward', stateKey: 'forward-0' } }
    ])
    const noteEchoes = ref([
      {
        path: '/vault/notes/alpha.md',
        title: 'Alpha',
        reasonLabel: 'Backlink',
        reasonLabels: ['Backlink'],
        score: 0.8,
        signalSources: ['backlink']
      },
      {
        path: '/vault/notes/beta.md',
        title: 'Beta',
        reasonLabel: 'Semantic',
        reasonLabels: ['Semantic'],
        score: 0.5,
        signalSources: ['semantic']
      }
    ] satisfies EchoesItem[])
    const backlinks = ref(['/vault/notes/alpha.md'])
    const semanticLinks = ref([
      { path: '/vault/notes/alpha.md', score: 0.8, direction: 'outgoing' as const }
    ])
    const constitutedContext = {
      contains: (path: string) => path === '/vault/notes/alpha.md',
      localItems: ref([{ path: '/vault/notes/alpha.md', title: 'Alpha' }]),
      pinnedItems: ref([{ path: '/vault/notes/pinned.md', title: 'Pinned' }])
    }

    const viewModels = useAppShellViewModels({
      theme: {
        activeColorScheme,
        availableThemes
      },
      search: {
        shortcutsFilterQuery,
        themePickerQuery
      },
      workspace: {
        workingFolderPath: ref('/vault'),
        activeFilePath,
        activeStatus,
        activeFileMetadata,
        virtualDocs,
        editorZoom,
        getActiveTab: () => ({ type: 'document' }),
        toRelativePath: (path: string) => path.replace('/vault/', '')
      },
      history: {
        backTargets,
        forwardTargets
      },
      notes: {
        noteEchoes,
        backlinks,
        semanticLinks
      },
      context: {
        constitutedContext
      },
      launchpad: {
        recentWorkspaces: ref<LaunchpadRecentWorkspace[]>([]),
        recentViewedNotes: ref<LaunchpadRecentNote[]>([]),
        recentUpdatedNotes: ref<LaunchpadRecentNote[]>([]),
        showWizardAction: ref(false)
      },
      secondBrain: {
        workspacePath: ref('/vault'),
        allWorkspaceFiles: ref([]),
        requestedSessionId: ref(''),
        requestedSessionNonce: ref(0),
        requestedPrompt: ref(''),
        requestedPromptNonce: ref(0),
        echoesRefreshToken: ref(0)
      },
      labels: {
        formatTimestamp: (value: number | null | undefined) => `ts:${value ?? 'none'}`
      },
      isMacOs: false,
      libs: {
        buildShortcutSections,
        buildMetadataRows,
        buildSystemThemeLabel,
        buildThemePickerItems,
        basenameLabel: (path: string) => path.split('/').filter(Boolean).pop() ?? path
      },
      historyLabels: {
        historyTargetLabel: (entry) => `history:${entry.stateKey}`
      }
    })

    expect(viewModels.systemThemeLabel.value).toBe('System (Tomosona Dark)')
    expect(viewModels.themePickerItems.value.map((item) => item.id)).toEqual(['tokyo-night'])
    shortcutsFilterQuery.value = 'alpha'
    expect(viewModels.themePickerItems.value.map((item) => item.id)).toEqual(['tokyo-night'])
    themePickerQuery.value = 'system'
    expect(viewModels.themePickerItems.value.map((item) => item.id)).toEqual(['system'])
    expect(viewModels.shortcutSections.value[0].title).toBe('General')
    expect(viewModels.filteredShortcutSections.value).toHaveLength(0)
    expect(viewModels.metadataRows.value[0]).toEqual({ label: 'Path', value: 'notes/alpha.md' })
    expect(viewModels.backlinkCount.value).toBe(1)
    expect(viewModels.semanticLinkCount.value).toBe(1)
    expect(viewModels.activeNoteInContext.value).toBe(true)
    expect(viewModels.backShortcutLabel.value).toBe('Alt+Left')
    expect(viewModels.primaryModLabel.value).toBe('Ctrl')
    expect(viewModels.zoomPercentLabel.value).toBe('125%')
    expect(viewModels.backHistoryItems.value[0]).toEqual({
      index: 0,
      key: 'back-0-back-0',
      label: 'history:back-0'
    })
  })
})
