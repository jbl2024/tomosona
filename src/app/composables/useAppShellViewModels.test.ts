import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { AppThemeDefinition } from '../../shared/lib/themeRegistry'
import type { AppSettingsAlters } from '../../shared/api/apiTypes'
import type { EchoesItem } from '../../domains/echoes/lib/echoes'
import type { DocumentHistoryEntry } from '../../domains/editor/composables/useDocumentHistory'
import {
  buildMetadataRows,
  buildShortcutSections,
  buildSystemThemeLabel,
  buildThemePickerItems
} from '../lib/appShellPresentation'
import { useAppShellViewModels } from './useAppShellViewModels'
import type { CosmosGraph, CosmosGraphNode } from '../../domains/cosmos/lib/graphIndex'
import type { LaunchpadRecentNote, LaunchpadRecentWorkspace } from '../lib/appShellViewModels'

describe('useAppShellViewModels', () => {
  it('derives shell view models from the provided shell state', () => {
    const availableThemes: AppThemeDefinition[] = [
      { id: 'tomosona-light', label: 'Tomosona Light', colorScheme: 'light', group: 'official' },
      { id: 'tokyo-night', label: 'Tokyo Night', colorScheme: 'dark', group: 'community' }
    ]
    const shortcutsFilterQuery = ref('tokyo')
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
    const semanticLinks = ref([
      { path: '/vault/notes/alpha.md', score: 0.8, direction: 'outgoing' as const }
    ])
    const constitutedContext = {
      contains: (path: string) => path === '/vault/notes/alpha.md',
      localItems: ref([{ path: '/vault/notes/alpha.md', title: 'Alpha' }]),
      pinnedItems: ref([{ path: '/vault/notes/pinned.md', title: 'Pinned' }])
    }
    const cosmosSelectedNode = ref<CosmosGraphNode>({
      id: 'n1',
      path: '/vault/notes/alpha.md',
      label: 'Alpha',
      degree: 1,
      tags: [],
      cluster: 0,
      importance: 1,
      opacityHint: 1,
      showLabelByDefault: false,
      displayLabel: 'Alpha',
      folderKey: 'vault',
      fullLabel: 'Alpha'
    })
    const cosmosGraph = ref<CosmosGraph>({
      nodes: [cosmosSelectedNode.value],
      edges: [],
      generated_at_ms: 0
    })
    const cosmos = {
      graph: cosmosGraph,
      loading: ref(false),
      error: ref(''),
      selectedNodeId: ref('n1'),
      focusMode: ref(false),
      focusDepth: ref(0),
      summary: ref({ nodes: 0, edges: 0 }),
      query: ref(''),
      queryMatches: ref<CosmosGraphNode[]>([]),
      showSemanticEdges: ref(false),
      selectedNode: cosmosSelectedNode,
      selectedLinkCount: ref(0),
      preview: ref(''),
      previewLoading: ref(false),
      previewError: ref(''),
      outgoingNodes: ref([]),
      incomingNodes: ref([])
    }

    const viewModels = useAppShellViewModels({
      theme: {
        activeColorScheme,
        availableThemes
      },
      search: {
        shortcutsFilterQuery
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
        semanticLinks
      },
      context: {
        constitutedContext
      },
      cosmos,
      launchpad: {
        recentWorkspaces: ref<LaunchpadRecentWorkspace[]>([]),
        recentViewedNotes: ref<LaunchpadRecentNote[]>([]),
        recentUpdatedNotes: ref<LaunchpadRecentNote[]>([]),
        showWizardAction: ref(false)
      },
      altersSettings: ref({
        default_mode: 'neutral',
        show_badge_in_chat: true,
        default_influence_intensity: 'balanced'
      } satisfies AppSettingsAlters),
      secondBrain: {
        workspacePath: ref('/vault'),
        allWorkspaceFiles: ref([]),
        requestedSessionId: ref(''),
        requestedSessionNonce: ref(0),
        requestedPrompt: ref(''),
        requestedPromptNonce: ref(0),
        requestedAlterId: ref(''),
        requestedAlterNonce: ref(0),
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
    expect(viewModels.shortcutSections.value[0].title).toBe('General')
    expect(viewModels.filteredShortcutSections.value).toHaveLength(0)
    expect(viewModels.metadataRows.value[0]).toEqual({ label: 'Path', value: 'notes/alpha.md' })
    expect(viewModels.backlinkCount.value).toBe(2)
    expect(viewModels.semanticLinkCount.value).toBe(1)
    expect(viewModels.activeNoteInContext.value).toBe(true)
    const selectedNode = viewModels.cosmosSelectedNodeForPanel.value
    expect(selectedNode).toBeTruthy()
    if (!selectedNode) throw new Error('Expected selected Cosmos node')
    expect(selectedNode.id).toBe('n1')
    expect(selectedNode.path).toBe('notes/alpha.md')
    expect(selectedNode.label).toBe('Alpha')
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
