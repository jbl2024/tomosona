<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import type { MovePreflightIssue } from '../../../shared/api/apiTypes'
import { preflightMoveEntries } from '../../../shared/api/workspaceApi'
import type { JournalOrganizationMove, JournalOrganizationPlan } from '../../../app/lib/journalOrganization'
import { getParentPath } from '../lib/explorerTreeUtils'
import { preflightIssueMessage } from '../lib/mutationPreflight'

/**
 * Preview of the journal organization plan.
 *
 * Runs the read-only native preflight so collisions and blocked entries are
 * visible before anything moves. Confirming hands the plan to the explorer's
 * safe mutation boundary, which revalidates every entry and keeps the existing
 * conflict prompt for collisions.
 */
const props = defineProps<{
  plan: JournalOrganizationPlan
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [moves: JournalOrganizationMove[]]
}>()

type PreviewRow = JournalOrganizationMove & { issue: MovePreflightIssue | null }

const rows = ref<PreviewRow[]>(props.plan.moves.map((move) => ({ ...move, issue: null })))
const loading = ref(true)
const error = ref('')
const rootRef = ref<HTMLElement | null>(null)

const collisionCount = computed(() => rows.value.filter((row) => row.issue === 'collision').length)
const blockedCount = computed(() => rows.value.filter((row) => row.issue && row.issue !== 'collision').length)
// An unchecked preview must never enable execution: the plan is only advisory
// until the native preflight has looked at every destination.
const canConfirm = computed(() => !loading.value && !error.value && rows.value.length > blockedCount.value)

function statusLabel(issue: MovePreflightIssue | null): string {
  if (!issue) return 'Ready'
  if (issue === 'collision') return 'Destination exists'
  return preflightIssueMessage(issue)
}

async function runPreflight() {
  const byTarget = new Map<string, string[]>()
  for (const move of props.plan.moves) {
    const targetDir = getParentPath(move.to)
    byTarget.set(targetDir, [...(byTarget.get(targetDir) ?? []), move.from])
  }

  const issues = new Map<string, MovePreflightIssue | null>()
  try {
    for (const [targetDir, sources] of byTarget) {
      const entries = await preflightMoveEntries(sources, targetDir)
      for (const entry of entries) issues.set(entry.sourcePath, entry.issue)
    }
  } catch {
    error.value = 'The move preview could not be checked. Nothing has been changed.'
  } finally {
    loading.value = false
  }

  rows.value = props.plan.moves.map((move) => ({ ...move, issue: issues.get(move.from) ?? null }))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  rootRef.value?.focus()
  void runPreflight()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div class="explorer-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
    <div
      ref="rootRef"
      class="explorer-modal w-full max-w-2xl rounded-2xl border p-4 outline-none"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label="Organize dated notes"
    >
      <h3 class="explorer-modal-title text-sm font-semibold">Organize dated notes</h3>
      <p class="explorer-modal-copy mt-1 text-xs">
        {{ plan.moves.length }} dated {{ plan.moves.length === 1 ? 'note' : 'notes' }} will move into year/month folders.
        Nothing changes until you confirm.
      </p>

      <p v-if="loading" class="explorer-modal-copy mt-3 text-xs">Checking destinations…</p>
      <p v-else-if="error" class="explorer-modal-copy mt-3 text-xs">{{ error }}</p>
      <p v-else-if="collisionCount" class="explorer-journal-warning mt-3 text-xs">
        {{ collisionCount }} destination {{ collisionCount === 1 ? 'already exists' : 'already exist' }}. You will be asked how to handle each conflict; nothing is overwritten without your choice.
      </p>

      <ul class="explorer-journal-plan mt-2 max-h-64 overflow-y-auto rounded-lg border" aria-label="Proposed moves">
        <li v-for="row in rows" :key="row.from" class="explorer-journal-plan-row flex items-start justify-between gap-2 px-2 py-1.5 text-xs">
          <span class="min-w-0">
            <span class="explorer-journal-plan-source block truncate">{{ row.from }}</span>
            <span class="explorer-journal-plan-target block truncate text-[10px]">→ {{ row.to }}</span>
          </span>
          <span class="explorer-journal-plan-status shrink-0 text-[10px]" :class="{ 'explorer-journal-plan-status--blocked': row.issue && row.issue !== 'collision' }">
            {{ statusLabel(row.issue) }}
          </span>
        </li>
      </ul>

      <p v-if="!loading && blockedCount" class="explorer-modal-copy mt-2 text-xs">
        {{ blockedCount }} {{ blockedCount === 1 ? 'note cannot' : 'notes cannot' }} be moved and will be left in place.
      </p>

      <div class="mt-4 flex justify-end gap-2">
        <UiButton size="sm" variant="ghost" @click="emit('cancel')">Cancel</UiButton>
        <UiButton size="sm" variant="primary" :disabled="!canConfirm" @click="emit('confirm', plan.moves)">Organize</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.explorer-modal-backdrop {
  background: var(--menu-backdrop);
}

.explorer-modal {
  border-color: var(--panel-border);
  background: var(--surface-bg);
  box-shadow: var(--menu-shadow);
}

.explorer-modal-title {
  color: var(--text-main);
}

.explorer-modal-copy {
  color: var(--text-dim);
}

.explorer-journal-warning {
  color: var(--text-main);
}

.explorer-journal-plan {
  border-color: var(--panel-border);
  margin: 0;
  padding: 0;
  list-style: none;
}

.explorer-journal-plan-row {
  color: var(--text-main);
}

.explorer-journal-plan-source {
  font-variant-numeric: tabular-nums;
}

.explorer-journal-plan-target {
  color: var(--text-dim);
}

.explorer-journal-plan-status {
  color: var(--text-dim);
}

.explorer-journal-plan-status--blocked {
  color: var(--text-main);
}
</style>
