<script setup lang="ts">
import UiButton from '../../../shared/components/ui/UiButton.vue'

/**
 * Module: WorkspaceEntryModals
 *
 * Purpose:
 * - Render the shell modals used to create files, create folders, and open a
 *   specific daily note.
 */

/** Props required to render the workspace entry modals. */
defineProps<{
  newFileVisible: boolean
  newFilePathInput: string
  newFileError: string
  newFolderVisible: boolean
  newFolderPathInput: string
  newFolderError: string
  openDateVisible: boolean
  openDateInput: string
  openDateError: string
}>()

/** Events emitted by the modals so the parent shell owns validation and actions. */
const emit = defineEmits<{
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
}>()
</script>

<template>
  <div v-if="newFileVisible" class="modal-overlay" @click.self="emit('closeNewFile')">
    <div
      class="modal confirm-modal"
      data-modal="new-file"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-file-title"
      aria-describedby="new-file-description"
      tabindex="-1"
    >
      <h3 id="new-file-title" class="confirm-title">New Note</h3>
      <p id="new-file-description" class="confirm-text">Enter a workspace-relative note path. `.md` is added automatically.</p>
      <input
        :value="newFilePathInput"
        data-new-file-input="true"
        class="tool-input"
        placeholder="untitled"
        @input="emit('updateNewFilePath', ($event.target as HTMLInputElement).value)"
        @keydown="emit('keydownNewFile', $event)"
      />
      <p v-if="newFileError" class="modal-input-error">{{ newFileError }}</p>
      <div class="confirm-actions">
        <UiButton size="sm" variant="ghost" @click="emit('closeNewFile')">Cancel</UiButton>
        <UiButton size="sm" @click="emit('submitNewFile')">Create</UiButton>
      </div>
    </div>
  </div>

  <div v-if="newFolderVisible" class="modal-overlay" @click.self="emit('closeNewFolder')">
    <div
      class="modal confirm-modal"
      data-modal="new-folder"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-folder-title"
      aria-describedby="new-folder-description"
      tabindex="-1"
    >
      <h3 id="new-folder-title" class="confirm-title">New Folder</h3>
      <p id="new-folder-description" class="confirm-text">Enter a workspace-relative folder path.</p>
      <input
        :value="newFolderPathInput"
        data-new-folder-input="true"
        class="tool-input"
        placeholder="new-folder"
        @input="emit('updateNewFolderPath', ($event.target as HTMLInputElement).value)"
        @keydown="emit('keydownNewFolder', $event)"
      />
      <p v-if="newFolderError" class="modal-input-error">{{ newFolderError }}</p>
      <div class="confirm-actions">
        <UiButton size="sm" variant="ghost" @click="emit('closeNewFolder')">Cancel</UiButton>
        <UiButton size="sm" @click="emit('submitNewFolder')">Create</UiButton>
      </div>
    </div>
  </div>

  <div v-if="openDateVisible" class="modal-overlay" @click.self="emit('closeOpenDate')">
    <div
      class="modal confirm-modal"
      data-modal="open-date"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-date-title"
      aria-describedby="open-date-description"
      tabindex="-1"
    >
      <h3 id="open-date-title" class="confirm-title">Open Specific Date</h3>
      <p id="open-date-description" class="confirm-text">Enter a date as `YYYY-MM-DD`.</p>
      <input
        :value="openDateInput"
        data-open-date-input="true"
        class="tool-input"
        placeholder="2026-02-22"
        @input="emit('updateOpenDate', ($event.target as HTMLInputElement).value)"
        @keydown="emit('keydownOpenDate', $event)"
      />
      <p v-if="openDateError" class="modal-input-error">{{ openDateError }}</p>
      <div class="confirm-actions">
        <UiButton size="sm" variant="ghost" @click="emit('closeOpenDate')">Cancel</UiButton>
        <UiButton size="sm" @click="emit('submitOpenDate')">Open</UiButton>
      </div>
    </div>
  </div>
</template>
