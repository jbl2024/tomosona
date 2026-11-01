<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowPathIcon, CalendarDaysIcon, FolderIcon } from '@heroicons/vue/24/outline'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import type { JournalOrganizationPlan } from '../../../app/lib/journalOrganization'
import { useExplorerJournal } from '../composables/useExplorerJournal'

/**
 * Chronological journal view for the explorer.
 *
 * Renders dated notes found under the workspace journal folder without moving
 * them, and offers an explicit organization preview. Opening an entry emits the
 * real workspace path so navigation stays identical to the tree.
 */
const props = defineProps<{
  root: string
  activePath?: string
}>()

const emit = defineEmits<{
  open: [path: string]
  organize: [plan: JournalOrganizationPlan]
  error: [message: string]
}>()

const journal = useExplorerJournal({ root: computed(() => props.root) })
const folderDraft = ref(journal.journalFolder.value)
const editingFolder = ref(false)
const folderInput = ref<InstanceType<typeof UiInput> | null>(null)

const hasEntries = computed(() => journal.timeline.value.total > 0)
const canOrganize = computed(() => journal.organizationPlan.value.moves.length > 0)

/** Reveals the folder editor with the current value selected for replacement. */
async function startFolderEdit() {
  folderDraft.value = journal.journalFolder.value
  editingFolder.value = true
  await nextTick()
  folderInput.value?.focus()
  folderInput.value?.select()
}

/**
 * Persists the drafted folder and closes the editor.
 *
 * The `editingFolder` guard makes the commit idempotent: Enter closes the editor
 * and the resulting blur must not commit a second time.
 */
async function commitFolder() {
  if (!editingFolder.value) return
  editingFolder.value = false
  const next = folderDraft.value.trim()
  if (!next || next === journal.journalFolder.value) {
    folderDraft.value = journal.journalFolder.value
    return
  }
  await journal.setJournalFolder(next)
  folderDraft.value = journal.journalFolder.value
}

/** Discards the draft and closes the editor. */
function cancelFolderEdit() {
  folderDraft.value = journal.journalFolder.value
  editingFolder.value = false
}

async function refresh() {
  await journal.load()
}

function requestOrganize() {
  if (!canOrganize.value) return
  emit('organize', journal.organizationPlan.value)
}

watch(() => props.root, async () => {
  editingFolder.value = false
  folderDraft.value = journal.journalFolder.value
  await journal.load()
})

watch(() => journal.error.value, (message) => {
  if (message) emit('error', message)
})

onMounted(() => {
  void journal.load()
})
</script>

<template>
  <div class="explorer-journal flex h-full min-h-0 flex-col gap-2">
    <div class="explorer-journal-header flex flex-wrap items-center gap-1 border-b pb-1">
      <button
        v-if="!editingFolder"
        type="button"
        class="explorer-journal-folder mr-auto inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition"
        aria-label="Journal folder"
        :title="`Journal folder: ${journal.journalFolder.value} (click to change)`"
        @click="startFolderEdit"
      >
        <FolderIcon class="h-3.5 w-3.5 shrink-0" />
        <span class="explorer-journal-folder-name truncate">{{ journal.journalFolder.value }}</span>
      </button>
      <UiInput
        v-else
        ref="folderInput"
        v-model="folderDraft"
        size="sm"
        class-name="explorer-journal-folder-input mr-auto"
        placeholder="journal"
        aria-label="Journal folder path"
        @keydown.enter.prevent="commitFolder"
        @keydown.esc.prevent="cancelFolderEdit"
        @blur="commitFolder"
      />
      <button
        type="button"
        class="explorer-toolbar-btn inline-flex h-6.5 w-6.5 items-center justify-center rounded-md border border-transparent transition"
        title="Refresh journal"
        aria-label="Refresh journal"
        @click="refresh"
      >
        <ArrowPathIcon class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="explorer-journal-organize inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition disabled:opacity-40"
        :disabled="!canOrganize"
        :title="canOrganize ? 'Preview moving dated notes into year/month folders' : 'Every dated note is already organized'"
        @click="requestOrganize"
      >
        <CalendarDaysIcon class="h-3.5 w-3.5" />
        Organize…
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-0.5">
      <p v-if="journal.loading.value" class="explorer-empty-state px-2 py-1 text-xs">Loading journal…</p>
      <p v-else-if="journal.error.value" class="explorer-empty-state px-2 py-1 text-xs">{{ journal.error.value }}</p>
      <p v-else-if="!hasEntries" class="explorer-empty-state px-2 py-1 text-xs">
        No dated notes in “{{ journal.journalFolder.value }}” yet. Daily notes appear here once they exist.
      </p>

      <section v-for="group in journal.timeline.value.groups" :key="group.key" class="explorer-journal-group">
        <h4 class="explorer-journal-month px-2 pt-2 text-[11px] font-semibold">{{ group.label }}</h4>
        <ul class="explorer-journal-entries">
          <li v-for="entry in group.entries" :key="entry.path">
            <button
              type="button"
              class="explorer-journal-entry flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs"
              :class="{ 'explorer-journal-entry--active': entry.path === activePath }"
              :aria-current="entry.path === activePath ? 'true' : undefined"
              :title="entry.path"
              @click="emit('open', entry.path)"
            >
              <span class="explorer-journal-date shrink-0">{{ entry.date }}</span>
              <span v-if="entry.isToday" class="explorer-journal-today shrink-0 rounded px-1 text-[10px]">Today</span>
              <span v-if="entry.duplicateDate" class="explorer-journal-location truncate text-[10px]">{{ entry.location }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.explorer-journal-header {
  border-color: color-mix(in srgb, var(--border-strong) 72%, transparent);
}

.explorer-journal-folder {
  color: var(--text-soft);
}

.explorer-journal-folder:hover {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-journal-folder-name {
  max-width: 9rem;
}

.explorer-journal-folder-input {
  height: 1.6rem;
  max-width: 9rem;
  padding-left: 0.4rem;
  padding-right: 0.4rem;
}

.explorer-journal-organize {
  border-color: var(--panel-border);
  color: var(--text-main);
}

.explorer-journal-organize:hover:not(:disabled) {
  background: var(--explorer-toolbar-hover-bg);
}

.explorer-toolbar-btn {
  color: var(--text-soft);
}

.explorer-toolbar-btn:hover:not(:disabled) {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-journal-month {
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.explorer-journal-entries {
  margin: 0;
  padding: 0;
  list-style: none;
}

.explorer-journal-entry {
  color: var(--text-main);
}

.explorer-journal-entry:hover,
.explorer-journal-entry--active {
  background: var(--menu-item-hover-bg);
}

.explorer-journal-date {
  font-variant-numeric: tabular-nums;
}

.explorer-journal-today {
  background: var(--explorer-toolbar-hover-bg);
  color: var(--menu-text-strong);
}

.explorer-journal-location {
  color: var(--text-dim);
}

.explorer-empty-state {
  color: var(--text-dim);
}
</style>
