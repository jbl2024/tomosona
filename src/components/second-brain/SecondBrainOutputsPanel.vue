<script setup lang="ts">
import { ref } from 'vue'
import EditorView from '../EditorView.vue'

const props = defineProps<{
  draftPath: string
  openPaths: string[]
  openFile: (path: string) => Promise<string>
  saveFile: (path: string, text: string, options: { explicit: boolean }) => Promise<{ persisted: boolean }>
  renameFileFromTitle: (path: string, title: string) => Promise<{ path: string; title: string }>
  loadLinkTargets: () => Promise<string[]>
  loadLinkHeadings: (target: string) => Promise<string[]>
  loadPropertyTypeSchema: () => Promise<Record<string, string>>
  savePropertyTypeSchema: (schema: Record<string, string>) => Promise<void>
  openLinkTarget: (target: string) => Promise<boolean>
  savingDraft: boolean
  draftError: string
}>()

const emit = defineEmits<{
  'publish-new': [payload: { targetDir: string; fileName: string }]
  'publish-existing': [targetPath: string]
}>()

const targetDir = ref('')
const fileName = ref('')
const targetPath = ref('')
</script>

<template>
  <section class="sb-output-panel">
    <header class="sb-output-head">
      <h3>Brouillon</h3>
      <span>{{ savingDraft ? 'Sauvegarde...' : '' }}</span>
    </header>

    <div class="sb-output-editor-wrap">
      <EditorView
        :path="draftPath"
        :open-paths="openPaths"
        :open-file="openFile"
        :save-file="saveFile"
        :rename-file-from-title="renameFileFromTitle"
        :load-link-targets="loadLinkTargets"
        :load-link-headings="loadLinkHeadings"
        :load-property-type-schema="loadPropertyTypeSchema"
        :save-property-type-schema="savePropertyTypeSchema"
        :open-link-target="openLinkTarget"
      />
    </div>

    <div class="sb-publish">
      <div class="sb-publish-row">
        <input v-model="targetDir" class="sb-input" placeholder="Dossier absolu (nouvelle note)">
        <input v-model="fileName" class="sb-input" placeholder="Nom de fichier.md">
        <button type="button" class="sb-btn" @click="emit('publish-new', { targetDir, fileName })">Publier nouvelle note</button>
      </div>
      <div class="sb-publish-row">
        <input v-model="targetPath" class="sb-input" placeholder="Chemin absolu note existante">
        <button type="button" class="sb-btn" @click="emit('publish-existing', targetPath)">Publier note existante</button>
      </div>
      <p v-if="draftError" class="sb-error">{{ draftError }}</p>
    </div>
  </section>
</template>

<style scoped>
.sb-output-panel {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  min-height: 0;
  height: 100%;
}
.sb-output-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sb-output-head h3,
.sb-output-head span {
  margin: 0;
  font-size: 12px;
}
.sb-output-editor-wrap {
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  overflow: hidden;
  min-height: 0;
}
.sb-publish {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-publish-row {
  display: flex;
  gap: 6px;
}
.sb-input {
  flex: 1;
  height: 30px;
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  font-size: 12px;
  padding: 0 8px;
}
.sb-btn {
  border: 1px solid var(--sb-button-border);
  border-radius: 8px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  font-size: 12px;
  padding: 0 10px;
}
.sb-error {
  margin: 0;
  font-size: 12px;
  color: var(--sb-danger-text);
}
</style>
