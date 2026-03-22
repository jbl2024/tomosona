import { createApp, defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShellWorkspaceSurface, { type AppShellWorkspaceSurfaceExposed } from './AppShellWorkspaceSurface.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []
  const activeFilePath = '/vault/a.md'
  const enqueueMarkdownReindex = vi.fn()
  const surface = ref<AppShellWorkspaceSurfaceExposed | null>(null)

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(
          AppShellWorkspaceSurface,
          {
            ref: surface,
            sidebarVisible: true,
            sidebarMode: 'search',
            workingFolderPath: '/vault',
            hasWorkspace: true,
            leftPaneWidth: 280,
            rightPaneVisible: true,
            rightPaneWidth: 320,
            activeFilePath,
            activeNoteTitle: 'a',
            activeStateLabel: 'saved',
            backlinkCount: 0,
            semanticLinkCount: 0,
            activeNoteInContext: false,
            indexingState: 'out_of_sync',
            favoriteItems: [],
            favoritesLoading: false,
            searchQuery: 'hello',
            globalSearchMode: 'hybrid',
            searchModeOptions: [{ mode: 'hybrid', label: 'Hybrid' }],
            showSearchScore: false,
            hasSearched: true,
            searchLoading: false,
            groupedSearchResults: [{ path: '/vault/a.md', items: [] }],
            toRelativePath: (path: string) => path.replace('/vault/', ''),
            formatSearchScore: (value: number) => String(value),
            parseSearchSnippet: (snippet: string) => [{ text: snippet, highlighted: false }],
            canToggleFavorite: true,
            isFavorite: false,
            echoesItems: [],
            echoesLoading: false,
            echoesError: '',
            echoesHintVisible: false,
            localContextItems: [],
            pinnedContextItems: [],
            canReasonOnContext: false,
            isLaunchingContextAction: false,
            outline: [],
            semanticLinks: [],
            semanticLinksLoading: false,
            backlinks: [],
            backlinksLoading: false,
            metadataRows: [],
            propertiesPreview: [],
            propertyParseErrorCount: 0,
            onSetSidebarMode: (mode: string) => events.push(`mode:${mode}`),
            onSelectWorkingFolder: () => events.push('select-workspace'),
            onResizeStart: (side: string) => events.push(`resize:${side}`),
            onToggleFavorite: () => events.push('toggle-favorite'),
            onActiveNoteAddToContext: () => events.push('add-context'),
            onActiveNoteRemoveFromContext: () => events.push('remove-context'),
            onActiveNoteOpenCosmos: () => events.push('open-cosmos'),
            onContextOpenSecondBrain: () => events.push('context-second-brain'),
            onContextOpenCosmos: () => events.push('context-cosmos'),
            onContextOpenPulse: () => events.push('context-pulse'),
            onContextPin: () => events.push('context-pin'),
            onContextClearLocal: () => events.push('context-clear-local'),
            onContextClearPinned: () => events.push('context-clear-pinned'),
            onExplorerOpen: () => {},
            onExplorerPathRenamed: () => {},
            onExplorerPathsMoved: () => {},
            onExplorerPathsDeleted: () => {},
            onExplorerRequestCreate: () => {},
            onExplorerSelection: () => {},
            onExplorerError: () => {},
            onFavoritesOpen: () => {},
            onFavoritesRemove: () => {},
            onUpdateSearchQuery: () => {},
            onRunGlobalSearch: () => {},
            onSelectGlobalSearchMode: () => {},
            onOpenSearchResult: () => {},
            onContextOpen: () => {},
            onContextRemoveLocal: () => {},
            onContextRemovePinned: () => {},
            onEchoesOpen: () => {},
            onEchoesAddToContext: () => {},
            onEchoesRemoveFromContext: () => {},
            onEchoesReindex: () => enqueueMarkdownReindex(activeFilePath),
            onOutlineClick: () => {}
          },
          {
            center: () => h('div', { 'data-center-surface': 'true' })
          }
        )
    }
  }))

  app.mount(root)
  return { app, root, events, surface, enqueueMarkdownReindex }
}

describe('AppShellWorkspaceSurface', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('forwards sidebar actions, resize gestures, and exposes the reveal bridge', () => {
    const mounted = mountHarness()

    expect(typeof mounted.surface.value?.revealPathInView).toBe('function')

    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Explorer"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Favorites"]')?.click()
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Search"]')?.click()
    mounted.root.querySelector<HTMLDivElement>('.splitter')?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true })
    )
    mounted.root.querySelector<HTMLButtonElement>('.echoes-mark-btn')?.click()

    expect(mounted.events).toEqual([
      'mode:explorer',
      'mode:favorites',
      'mode:search',
      'resize:left'
    ])
    expect(mounted.enqueueMarkdownReindex).toHaveBeenCalledWith('/vault/a.md')

    mounted.app.unmount()
  })
})
