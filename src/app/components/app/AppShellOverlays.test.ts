import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppShellOverlays from './AppShellOverlays.vue'

function mountHarness() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const events: string[] = []

  const app = createApp(defineComponent({
    setup() {
      return () =>
        h(AppShellOverlays, {
          toastMessage: 'Saved',
          toastTone: 'success',
          toRelativePath: (path: string) => path,
          indexStatusModalVisible: false,
          indexRunning: false,
          indexStatusBusy: false,
          indexStatusBadgeLabel: 'Idle',
          indexStatusBadgeClass: 'status-item-indexed',
          indexShowProgressBar: false,
          indexProgressPercent: 0,
          indexProgressLabel: '',
          indexProgressSummary: '',
          indexRunCurrentPath: '',
          indexCurrentOperationLabel: '',
          indexCurrentOperationDetail: '',
          indexCurrentOperationPath: '',
          indexCurrentOperationStatusLabel: '',
          indexAlert: null,
          indexProcessedNotesCount: 0,
          indexNotesTotalCount: 0,
          indexNotesTotalLoading: false,
          lastRunFinishedAtMs: null,
          lastRunTitle: '',
          lastRunDurationMs: null,
          indexLogFilter: 'all',
          filteredIndexActivityRows: [],
          indexErrorCount: 0,
          indexSlowCount: 0,
          indexActionLabel: 'Rebuild',
          formatDurationMs: (value: number | null) => String(value ?? 0),
          formatTimestamp: (value: number | null) => String(value ?? 0),
          quickOpenVisible: true,
          quickOpenQuery: '',
          quickOpenIsActionMode: false,
          quickOpenHasTextQuery: false,
          quickOpenActionGroups: [],
          quickOpenBrowseRecentResults: [],
          quickOpenBrowseActionResults: [],
          quickOpenResults: [],
          quickOpenActiveIndex: 0,
          themePickerVisible: false,
          themePickerQuery: '',
          themePickerItems: [],
          themePickerActiveIndex: 0,
          themePreference: 'system',
          newFileModalVisible: false,
          newFilePathInput: '',
          newFileModalError: '',
          newFileTemplateItems: [],
          newFileTemplatePath: '',
          newFolderModalVisible: false,
          newFolderPathInput: '',
          newFolderModalError: '',
          openDateModalVisible: false,
          openDateInput: '',
          openDateModalError: '',
          spellcheckDictionaryModalVisible: false,
          spellcheckDictionaryWorkspacePath: '/Users/jbl2024/Documents/tomosona',
          spellcheckDictionaryWorkspaceLabel: 'tomosona',
          workspaceSetupWizardVisible: false,
          workspaceSetupWizardBusy: false,
          settingsModalVisible: false,
          designSystemDebugVisible: false,
          shortcutsModalVisible: false,
          shortcutsFilterQuery: '',
          filteredShortcutSections: [{ title: 'General', items: [{ keys: 'Cmd+S', action: 'Save' }] }],
          aboutModalVisible: false,
          appVersion: '1.0.0',
          onDismissToast: () => events.push('dismiss-toast'),
          onCloseIndexStatus: () => events.push('close-index-status'),
          onIndexPrimaryAction: () => events.push('index-action'),
          onUpdateIndexLogFilter: () => {},
          onCloseQuickOpen: () => events.push('close-quick-open'),
          onUpdateQuickOpenQuery: () => {},
          onQuickOpenKeydown: () => {},
          onQuickOpenSelectAction: () => {},
          onQuickOpenSelectResult: () => {},
          onQuickOpenSetActiveIndex: () => {},
          onCloseThemePicker: () => events.push('close-theme-picker'),
          onUpdateThemePickerQuery: () => {},
          onThemePickerSelect: () => {},
          onThemePickerPreview: () => {},
          onThemePickerKeydown: () => {},
          onThemePickerSetActiveIndex: () => {},
          onCloseNewFile: () => {},
          onUpdateNewFilePath: () => {},
          onKeydownNewFile: () => {},
          onSelectNewFileTemplate: () => {},
          onSubmitNewFile: () => {},
          onCloseNewFolder: () => {},
          onUpdateNewFolderPath: () => {},
          onKeydownNewFolder: () => {},
          onSubmitNewFolder: () => {},
          onCloseOpenDate: () => {},
          onUpdateOpenDate: () => {},
          onKeydownOpenDate: () => {},
          onSubmitOpenDate: () => {},
          onCloseSpellcheckDictionary: () => events.push('close-spellcheck-dictionary'),
          onCancelWorkspaceSetupWizard: () => {},
          onSubmitWorkspaceSetupWizard: () => {},
          onCancelSettings: () => {},
          onSettingsSaved: () => {},
          onCloseDesignSystemDebug: () => {},
          onCloseShortcuts: () => {},
          onUpdateShortcutsFilterQuery: () => {},
          onCloseAbout: () => {}
        })
    }
  }))

  app.mount(root)
  return { app, root, events }
}

describe('AppShellOverlays', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('forwards toast dismissal and quick-open close interactions', () => {
    const mounted = mountHarness()

    mounted.root.querySelector<HTMLButtonElement>('.toast-close')?.click()
    mounted.root.querySelector<HTMLDivElement>('.modal-overlay')?.click()

    expect(mounted.events).toEqual(['dismiss-toast', 'close-quick-open'])

    mounted.app.unmount()
  })
})
