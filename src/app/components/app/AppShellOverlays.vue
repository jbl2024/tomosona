<script setup lang="ts">
import QuickOpenModal from './QuickOpenModal.vue'
import ThemePickerModal from './ThemePickerModal.vue'
import IndexStatusModal from './IndexStatusModal.vue'
import WorkspaceEntryModals from './WorkspaceEntryModals.vue'
import WorkspaceSetupWizardModal from './WorkspaceSetupWizardModal.vue'
import SettingsModal from '../settings/SettingsModal.vue'
import DesignSystemDebugModal from './DesignSystemDebugModal.vue'
import ShortcutsModal from './ShortcutsModal.vue'
import AboutModal from './AboutModal.vue'
import type { IndexActivityRow, IndexLogFilter } from '../../lib/indexActivity'
import type { ThemePickerItem } from '../../lib/appShellPresentation'
import type { IndexRuntimeStatus, WriteAppSettingsResult } from '../../../shared/api/apiTypes'
import type {
  QuickOpenActionGroup,
  QuickOpenBrowseAction,
  QuickOpenResult
} from '../../composables/useAppQuickOpen'
import type { ThemePreference } from '../../composables/useAppTheme'
import type { WorkspaceSetupOption, WorkspaceSetupUseCase } from '../../lib/workspaceSetupWizard'

/**
 * Module: AppShellOverlays
 *
 * Purpose:
 * - Keep the app-shell overlays and modal stack out of `App.vue`.
 *
 * Boundary:
 * - The parent still owns the actual workflow state.
 * - This component only assembles the modal stack and forwards interactions.
 */

defineProps<{
  toastMessage: string
  toastTone: 'info' | 'success' | 'warning' | 'error'
  toRelativePath: (path: string) => string
  indexStatusModalVisible: boolean
  indexRunning: boolean
  indexStatusBusy: boolean
  indexRuntimeStatus: IndexRuntimeStatus | null
  indexStatusBadgeLabel: string
  indexStatusBadgeClass: string
  indexShowProgressBar: boolean
  indexProgressPercent: number
  indexProgressLabel: string
  indexProgressSummary: string
  indexRunCurrentPath: string
  indexCurrentOperationLabel: string
  indexCurrentOperationDetail: string
  indexCurrentOperationPath: string
  indexCurrentOperationStatusLabel: string
  indexModelStateClass: string
  indexModelStatusLabel: string
  indexShowWarmupNote: boolean
  indexAlert: { level: 'error' | 'warning'; title: string; message: string } | null
  indexSemanticLinksCount: number
  indexIndexedNotesCount: number
  indexNotesTotalCount: number
  indexNotesTotalLoading: boolean
  lastRunFinishedAtMs: number | null
  lastRunTitle: string
  indexLogFilter: IndexLogFilter
  filteredIndexActivityRows: IndexActivityRow[]
  indexErrorCount: number
  indexSlowCount: number
  indexActionLabel: string
  formatDurationMs: (value: number | null) => string
  formatTimestamp: (value: number | null) => string
  quickOpenVisible: boolean
  quickOpenQuery: string
  quickOpenIsActionMode: boolean
  quickOpenHasTextQuery: boolean
  quickOpenActionGroups: QuickOpenActionGroup[]
  quickOpenBrowseRecentResults: QuickOpenResult[]
  quickOpenBrowseActionResults: QuickOpenBrowseAction[]
  quickOpenResults: QuickOpenResult[]
  quickOpenActiveIndex: number
  themePickerVisible: boolean
  themePickerQuery: string
  themePickerItems: ThemePickerItem[]
  themePickerActiveIndex: number
  themePreference: ThemePreference
  cosmosCommandLoadingVisible: boolean
  cosmosCommandLoadingLabel: string
  newFileModalVisible: boolean
  newFilePathInput: string
  newFileModalError: string
  newFolderModalVisible: boolean
  newFolderPathInput: string
  newFolderModalError: string
  openDateModalVisible: boolean
  openDateInput: string
  openDateModalError: string
  workspaceSetupWizardVisible: boolean
  workspaceSetupWizardBusy: boolean
  settingsModalVisible: boolean
  designSystemDebugVisible: boolean
  shortcutsModalVisible: boolean
  shortcutsFilterQuery: string
  filteredShortcutSections: Array<{ title: string; items: Array<{ keys: string; action: string }> }>
  aboutModalVisible: boolean
  appVersion: string
}>()

const emit = defineEmits<{
  dismissToast: []
  closeIndexStatus: []
  indexPrimaryAction: []
  updateIndexLogFilter: [value: IndexLogFilter]
  closeQuickOpen: []
  updateQuickOpenQuery: [value: string]
  quickOpenKeydown: [event: KeyboardEvent]
  quickOpenSelectAction: [id: string]
  quickOpenSelectResult: [item: QuickOpenResult]
  quickOpenSetActiveIndex: [index: number]
  closeThemePicker: []
  updateThemePickerQuery: [value: string]
  themePickerSelect: [value: ThemePreference]
  themePickerPreview: [value: ThemePreference]
  themePickerKeydown: [event: KeyboardEvent]
  themePickerSetActiveIndex: [index: number]
  closeNewFile: []
  updateNewFilePath: [value: string]
  keydownNewFile: [event: KeyboardEvent]
  submitNewFile: []
  closeNewFolder: []
  updateNewFolderPath: [value: string]
  keydownNewFolder: [event: KeyboardEvent]
  submitNewFolder: []
  closeOpenDate: []
  updateOpenDate: [value: string]
  keydownOpenDate: [event: KeyboardEvent]
  submitOpenDate: []
  cancelWorkspaceSetupWizard: []
  submitWorkspaceSetupWizard: [payload: { useCase: WorkspaceSetupUseCase; options: WorkspaceSetupOption[] }]
  cancelSettings: []
  settingsSaved: [result: WriteAppSettingsResult]
  closeDesignSystemDebug: []
  closeShortcuts: []
  updateShortcutsFilterQuery: [value: string]
  closeAbout: []
}>()
</script>

<template>
  <div
    v-if="toastMessage"
    class="toast"
    :class="`toast-${toastTone}`"
    role="status"
    aria-live="polite"
  >
    <span>{{ toastMessage }}</span>
    <button type="button" class="toast-close" aria-label="Dismiss notification" @click="emit('dismissToast')">
      ×
    </button>
  </div>

  <IndexStatusModal
    :visible="indexStatusModalVisible"
    :running="indexRunning"
    :busy="indexStatusBusy"
    :runtime-status="indexRuntimeStatus"
    :badge-label="indexStatusBadgeLabel"
    :badge-class="indexStatusBadgeClass"
    :show-progress-bar="indexShowProgressBar"
    :progress-percent="indexProgressPercent"
    :progress-label="indexProgressLabel"
    :progress-summary="indexProgressSummary"
    :current-path-label="indexRunCurrentPath ? toRelativePath(indexRunCurrentPath) : ''"
    :current-operation-label="indexCurrentOperationLabel"
    :current-operation-detail="indexCurrentOperationDetail"
    :current-operation-path="indexCurrentOperationPath"
    :current-operation-status-label="indexCurrentOperationStatusLabel"
    :model-state-class="indexModelStateClass"
    :model-status-label="indexModelStatusLabel"
    :show-warmup-note="indexShowWarmupNote"
    :alert="indexAlert"
    :semantic-links-count="indexSemanticLinksCount"
    :indexed-notes-count="indexIndexedNotesCount"
    :notes-total-count="indexNotesTotalCount"
    :notes-total-loading="indexNotesTotalLoading"
    :last-run-finished-at-ms="lastRunFinishedAtMs"
    :last-run-title="lastRunTitle"
    :log-filter="indexLogFilter"
    :filtered-rows="filteredIndexActivityRows"
    :error-count="indexErrorCount"
    :slow-count="indexSlowCount"
    :action-label="indexActionLabel"
    :format-duration-ms="formatDurationMs"
    :format-timestamp="formatTimestamp"
    @close="emit('closeIndexStatus')"
    @action="emit('indexPrimaryAction')"
    @update:log-filter="emit('updateIndexLogFilter', $event)"
  />

  <QuickOpenModal
    :visible="quickOpenVisible"
    :query="quickOpenQuery"
    :is-action-mode="quickOpenIsActionMode"
    :has-text-query="quickOpenHasTextQuery"
    :action-groups="quickOpenActionGroups"
    :recent-results="quickOpenBrowseRecentResults"
    :browse-action-results="quickOpenBrowseActionResults"
    :file-results="quickOpenResults"
    :active-index="quickOpenActiveIndex"
    @close="emit('closeQuickOpen')"
    @update:query="emit('updateQuickOpenQuery', $event)"
    @keydown="emit('quickOpenKeydown', $event)"
    @select-action="emit('quickOpenSelectAction', $event)"
    @select-result="emit('quickOpenSelectResult', $event)"
    @set-active-index="emit('quickOpenSetActiveIndex', $event)"
  />

  <ThemePickerModal
    :visible="themePickerVisible"
    :query="themePickerQuery"
    :items="themePickerItems"
    :active-index="themePickerActiveIndex"
    :selected-preference="themePreference"
    @close="emit('closeThemePicker')"
    @update:query="emit('updateThemePickerQuery', $event)"
    @select="emit('themePickerSelect', $event)"
    @preview="emit('themePickerPreview', $event)"
    @keydown="emit('themePickerKeydown', $event)"
    @set-active-index="emit('themePickerSetActiveIndex', $event)"
  />

  <div v-if="cosmosCommandLoadingVisible" class="modal-overlay">
    <div
      class="modal confirm-modal cosmos-command-loading-modal"
      data-modal="cosmos-command-loading"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby="cosmos-command-loading-title"
      tabindex="-1"
    >
      <h3 id="cosmos-command-loading-title" class="confirm-title">Opening Cosmos</h3>
      <p class="confirm-text">{{ cosmosCommandLoadingLabel }}</p>
      <div class="cosmos-command-loading-track">
        <div class="cosmos-command-loading-bar"></div>
      </div>
    </div>
  </div>

  <WorkspaceEntryModals
    :new-file-visible="newFileModalVisible"
    :new-file-path-input="newFilePathInput"
    :new-file-error="newFileModalError"
    :new-folder-visible="newFolderModalVisible"
    :new-folder-path-input="newFolderPathInput"
    :new-folder-error="newFolderModalError"
    :open-date-visible="openDateModalVisible"
    :open-date-input="openDateInput"
    :open-date-error="openDateModalError"
    @close-new-file="emit('closeNewFile')"
    @update-new-file-path="emit('updateNewFilePath', $event)"
    @keydown-new-file="emit('keydownNewFile', $event)"
    @submit-new-file="emit('submitNewFile')"
    @close-new-folder="emit('closeNewFolder')"
    @update-new-folder-path="emit('updateNewFolderPath', $event)"
    @keydown-new-folder="emit('keydownNewFolder', $event)"
    @submit-new-folder="emit('submitNewFolder')"
    @close-open-date="emit('closeOpenDate')"
    @update-open-date="emit('updateOpenDate', $event)"
    @keydown-open-date="emit('keydownOpenDate', $event)"
    @submit-open-date="emit('submitOpenDate')"
  />

  <WorkspaceSetupWizardModal
    :visible="workspaceSetupWizardVisible"
    :busy="workspaceSetupWizardBusy"
    @cancel="emit('cancelWorkspaceSetupWizard')"
    @submit="emit('submitWorkspaceSetupWizard', $event)"
  />

  <SettingsModal
    :visible="settingsModalVisible"
    @cancel="emit('cancelSettings')"
    @saved="emit('settingsSaved', $event)"
  />

  <DesignSystemDebugModal
    :visible="designSystemDebugVisible"
    @close="emit('closeDesignSystemDebug')"
  />

  <ShortcutsModal
    :visible="shortcutsModalVisible"
    :filter-query="shortcutsFilterQuery"
    :sections="filteredShortcutSections"
    @close="emit('closeShortcuts')"
    @update:filter-query="emit('updateShortcutsFilterQuery', $event)"
  />

  <AboutModal
    :visible="aboutModalVisible"
    :version="appVersion"
    @close="emit('closeAbout')"
  />
</template>
