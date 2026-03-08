<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import UiSelect from '../../../shared/components/ui/UiSelect.vue'
import {
  readAppSettings,
  writeAppSettings,
  discoverCodexModels as discoverCodexModelsApi
} from '../../../shared/api/settingsApi'
import type {
  AppSettingsView,
  CodexDiscoveredModel,
  SaveAppSettingsPayload,
  WriteAppSettingsResult
} from '../../../shared/api/apiTypes'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  cancel: []
  saved: [result: WriteAppSettingsResult]
}>()

const settingsActiveTab = ref<'llm' | 'embeddings'>('llm')
const settingsConfigPath = ref('~/.tomosona/conf.json')
const settingsLlmProviderPreset = ref<'openai' | 'anthropic' | 'codex' | 'custom'>('openai')
const settingsLlmApiKey = ref('')
const settingsLlmHasStoredApiKey = ref(false)
const settingsLlmModel = ref('gpt-4.1')
const settingsLlmBaseUrl = ref('')
const settingsLlmCustomProvider = ref('openai')
const settingsLlmLabel = ref('OpenAI Remote')
const settingsLlmCodexModels = ref<CodexDiscoveredModel[]>([])
const settingsLlmCodexModelsLoading = ref(false)
const settingsEmbeddingsMode = ref<'internal' | 'external'>('internal')
const settingsEmbeddingsProvider = ref<'openai'>('openai')
const settingsEmbeddingsApiKey = ref('')
const settingsEmbeddingsHasStoredApiKey = ref(false)
const settingsEmbeddingsModel = ref('text-embedding-3-small')
const settingsEmbeddingsBaseUrl = ref('')
const settingsEmbeddingsLabel = ref('OpenAI Embeddings')
const settingsModalError = ref('')

function applySettingsLlmPreset(provider: 'openai' | 'anthropic' | 'codex' | 'custom') {
  settingsLlmProviderPreset.value = provider
  settingsModalError.value = ''
  if (provider === 'openai') {
    settingsLlmLabel.value = 'OpenAI Remote'
    settingsLlmCustomProvider.value = 'openai'
    settingsLlmModel.value = 'gpt-4.1'
    settingsLlmBaseUrl.value = ''
    return
  }
  if (provider === 'anthropic') {
    settingsLlmLabel.value = 'Anthropic Claude'
    settingsLlmCustomProvider.value = 'anthropic'
    settingsLlmModel.value = 'claude-3-7-sonnet-latest'
    settingsLlmBaseUrl.value = ''
    return
  }
  if (provider === 'codex') {
    settingsLlmLabel.value = 'OpenAI Codex'
    settingsLlmCustomProvider.value = 'openai-codex'
    settingsLlmModel.value = 'gpt-5.2-codex'
    settingsLlmBaseUrl.value = ''
    if (!settingsLlmCodexModels.value.length && !settingsLlmCodexModelsLoading.value) {
      void discoverCodexModels()
    }
    return
  }
  settingsLlmLabel.value = 'Custom LLM'
  settingsLlmCustomProvider.value = 'openai_compatible'
  settingsLlmModel.value = ''
  settingsLlmBaseUrl.value = ''
}

function applySettingsDefaults() {
  settingsActiveTab.value = 'llm'
  settingsConfigPath.value = '~/.tomosona/conf.json'
  settingsLlmApiKey.value = ''
  settingsLlmHasStoredApiKey.value = false
  settingsLlmCodexModels.value = []
  settingsLlmCodexModelsLoading.value = false
  applySettingsLlmPreset('openai')
  settingsEmbeddingsMode.value = 'internal'
  settingsEmbeddingsProvider.value = 'openai'
  settingsEmbeddingsLabel.value = 'OpenAI Embeddings'
  settingsEmbeddingsModel.value = 'text-embedding-3-small'
  settingsEmbeddingsBaseUrl.value = ''
  settingsEmbeddingsApiKey.value = ''
  settingsEmbeddingsHasStoredApiKey.value = false
  settingsModalError.value = ''
}

async function discoverCodexModels() {
  settingsLlmCodexModelsLoading.value = true
  settingsModalError.value = ''
  try {
    const models = await discoverCodexModelsApi()
    settingsLlmCodexModels.value = models
    if (models.length && !models.some((item) => item.id === settingsLlmModel.value)) {
      settingsLlmModel.value = models[0]!.id
    }
  } catch (err) {
    settingsLlmCodexModels.value = []
    settingsModalError.value = err instanceof Error ? err.message : 'Could not discover Codex models.'
  } finally {
    settingsLlmCodexModelsLoading.value = false
  }
}

function hydrateSettingsFromConfig(view: AppSettingsView) {
  settingsConfigPath.value = view.path || settingsConfigPath.value
  if (view.llm && view.llm.profiles.length > 0) {
    const active = view.llm.profiles.find((item) => item.id === view.llm!.active_profile) ?? view.llm.profiles[0]
    const provider = active.provider.trim().toLowerCase()
    settingsLlmProviderPreset.value = provider === 'openai'
      ? 'openai'
      : provider === 'anthropic'
        ? 'anthropic'
        : provider === 'openai-codex'
          ? 'codex'
          : 'custom'
    settingsLlmCustomProvider.value = active.provider
    settingsLlmLabel.value = active.label
    settingsLlmModel.value = active.model
    settingsLlmBaseUrl.value = active.base_url ?? ''
    settingsLlmHasStoredApiKey.value = active.has_api_key
    settingsLlmApiKey.value = ''
  }
  settingsEmbeddingsMode.value = view.embeddings.mode
  if (view.embeddings.external) {
    settingsEmbeddingsProvider.value = 'openai'
    settingsEmbeddingsLabel.value = view.embeddings.external.label
    settingsEmbeddingsModel.value = view.embeddings.external.model
    settingsEmbeddingsBaseUrl.value = view.embeddings.external.base_url ?? ''
    settingsEmbeddingsHasStoredApiKey.value = view.embeddings.external.has_api_key
    settingsEmbeddingsApiKey.value = ''
  } else {
    settingsEmbeddingsProvider.value = 'openai'
    settingsEmbeddingsLabel.value = 'OpenAI Embeddings'
    settingsEmbeddingsModel.value = 'text-embedding-3-small'
    settingsEmbeddingsBaseUrl.value = ''
    settingsEmbeddingsHasStoredApiKey.value = false
    settingsEmbeddingsApiKey.value = ''
  }
}

async function initializeSettingsModal() {
  applySettingsDefaults()
  try {
    const view = await readAppSettings()
    hydrateSettingsFromConfig(view)
    if (settingsLlmProviderPreset.value === 'codex') {
      void discoverCodexModels()
    }
  } catch (err) {
    settingsModalError.value = err instanceof Error ? err.message : 'Could not read settings.'
  }
}

function buildSaveSettingsPayload(): SaveAppSettingsPayload {
  const llmProvider = settingsLlmProviderPreset.value === 'openai'
    ? 'openai'
    : settingsLlmProviderPreset.value === 'anthropic'
      ? 'anthropic'
      : settingsLlmProviderPreset.value === 'codex'
        ? 'openai-codex'
        : settingsLlmCustomProvider.value.trim()
  const llmProfileId = settingsLlmProviderPreset.value === 'custom'
    ? 'custom-profile'
    : settingsLlmProviderPreset.value === 'codex'
      ? 'openai-codex-profile'
      : `${llmProvider}-profile`
  const capabilities = {
    text: true,
    image_input: settingsLlmProviderPreset.value !== 'custom' && settingsLlmProviderPreset.value !== 'codex',
    audio_input: false,
    tool_calling: true,
    streaming: true
  }
  const llmProfile = {
    id: llmProfileId,
    label: settingsLlmLabel.value.trim(),
    provider: llmProvider,
    model: settingsLlmModel.value.trim(),
    preserve_existing_api_key: settingsLlmProviderPreset.value !== 'codex'
      && settingsLlmHasStoredApiKey.value
      && !settingsLlmApiKey.value.trim(),
    capabilities,
    default_mode: 'freestyle',
    ...(settingsLlmProviderPreset.value !== 'codex' && settingsLlmApiKey.value.trim()
      ? { api_key: settingsLlmApiKey.value.trim() }
      : {}),
    ...(settingsLlmProviderPreset.value !== 'codex' && settingsLlmBaseUrl.value.trim()
      ? { base_url: settingsLlmBaseUrl.value.trim() }
      : {})
  }

  const payload: SaveAppSettingsPayload = {
    llm: {
      active_profile: llmProfileId,
      profiles: [llmProfile]
    },
    embeddings: {
      mode: settingsEmbeddingsMode.value
    }
  }
  if (settingsEmbeddingsMode.value === 'external') {
    payload.embeddings.external = {
      id: 'emb-openai-profile',
      label: settingsEmbeddingsLabel.value.trim() || 'OpenAI Embeddings',
      provider: settingsEmbeddingsProvider.value,
      model: settingsEmbeddingsModel.value.trim(),
      preserve_existing_api_key: settingsEmbeddingsHasStoredApiKey.value && !settingsEmbeddingsApiKey.value.trim(),
      ...(settingsEmbeddingsApiKey.value.trim() ? { api_key: settingsEmbeddingsApiKey.value.trim() } : {}),
      ...(settingsEmbeddingsBaseUrl.value.trim() ? { base_url: settingsEmbeddingsBaseUrl.value.trim() } : {})
    }
  }
  return payload
}

async function submitSettingsModal() {
  if (!settingsLlmModel.value.trim()) {
    settingsModalError.value = 'LLM model is required.'
    return
  }
  if (!settingsLlmLabel.value.trim()) {
    settingsModalError.value = 'LLM profile label is required.'
    return
  }
  if (settingsLlmProviderPreset.value === 'custom' && !settingsLlmCustomProvider.value.trim()) {
    settingsModalError.value = 'Custom LLM provider is required.'
    return
  }
  if (
    settingsLlmProviderPreset.value !== 'codex'
    && !settingsLlmHasStoredApiKey.value
    && !settingsLlmApiKey.value.trim()
  ) {
    settingsModalError.value = 'LLM API key is required.'
    return
  }
  if (settingsEmbeddingsMode.value === 'external' && !settingsEmbeddingsModel.value.trim()) {
    settingsModalError.value = 'Embeddings model is required.'
    return
  }
  if (settingsEmbeddingsMode.value === 'external' && !settingsEmbeddingsHasStoredApiKey.value && !settingsEmbeddingsApiKey.value.trim()) {
    settingsModalError.value = 'Embeddings API key is required for external mode.'
    return
  }
  settingsModalError.value = ''

  try {
    const result = await writeAppSettings(buildSaveSettingsPayload())
    emit('saved', result)
  } catch (err) {
    settingsModalError.value = err instanceof Error ? err.message : 'Could not save settings.'
  }
}

function onSettingsInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
    return
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    event.stopPropagation()
    void submitSettingsModal()
  }
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  void initializeSettingsModal()
})

watch(() => props.visible, async (visible) => {
  if (!visible) return
  await nextTick()
})
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('cancel')">
    <div
      class="modal settings-modal"
      data-modal="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <div class="settings-shell">
        <div class="settings-shell__eyebrow">Settings Panel</div>
        <div class="settings-panel">
          <header class="settings-panel__header">
            <h3 id="settings-title" class="settings-panel__title">
              {{ settingsActiveTab === 'llm' ? 'LLM SETTINGS' : 'EMBEDDINGS SETTINGS' }}
            </h3>
            <div class="settings-tabs" role="tablist" aria-label="Settings tabs">
              <button type="button" class="settings-tab-btn" :class="{ active: settingsActiveTab === 'llm' }" @click="settingsActiveTab = 'llm'">LLM</button>
              <button type="button" class="settings-tab-btn" :class="{ active: settingsActiveTab === 'embeddings' }" @click="settingsActiveTab = 'embeddings'">Embeddings</button>
            </div>
          </header>

          <div class="settings-panel__body">
            <div v-if="settingsActiveTab === 'llm'" class="settings-fields">
              <UiField for-id="settings-llm-provider" label="Provider preset">
                <template #default>
                  <UiSelect
                    id="settings-llm-provider"
                    :model-value="settingsLlmProviderPreset"
                    @update:model-value="applySettingsLlmPreset($event as 'openai' | 'anthropic' | 'codex' | 'custom')"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="codex">OpenAI Codex</option>
                    <option value="custom">Custom</option>
                  </UiSelect>
                </template>
              </UiField>

              <UiField for-id="settings-llm-label" label="Profile label">
                <template #default="{ describedBy, invalid }">
                  <UiInput
                    id="settings-llm-label"
                    v-model="settingsLlmLabel"
                    size="sm"
                    placeholder="OpenAI Codex"
                    :aria-describedby="describedBy"
                    :invalid="invalid"
                    @keydown="onSettingsInputKeydown"
                  />
                </template>
              </UiField>

              <UiField v-if="settingsLlmProviderPreset === 'custom'" for-id="settings-llm-custom-provider" label="Custom provider">
                <template #default="{ describedBy, invalid }">
                  <UiInput
                    id="settings-llm-custom-provider"
                    v-model="settingsLlmCustomProvider"
                    size="sm"
                    placeholder="openai_compatible"
                    :aria-describedby="describedBy"
                    :invalid="invalid"
                    @keydown="onSettingsInputKeydown"
                  />
                </template>
              </UiField>

              <UiField
                for-id="settings-llm-model"
                label="Model"
                :help="settingsLlmProviderPreset === 'codex'
                  ? 'Use the Codex CLI session (~/.codex/auth.json). You can also enter any model ID manually.'
                  : ''"
              >
                <template #default="{ describedBy, invalid }">
                  <div class="settings-model-group">
                    <UiInput
                      id="settings-llm-model"
                      v-model="settingsLlmModel"
                      size="sm"
                      placeholder="gpt-5.2-codex"
                      class-name="settings-model-input"
                      :aria-describedby="describedBy"
                      :invalid="invalid"
                      @keydown="onSettingsInputKeydown"
                    />
                    <div v-if="settingsLlmProviderPreset === 'codex'" class="settings-model-actions">
                      <UiButton
                        size="sm"
                        variant="ghost"
                        :loading="settingsLlmCodexModelsLoading"
                        class-name="settings-discover-btn"
                        @click="discoverCodexModels"
                      >
                        {{ settingsLlmCodexModelsLoading ? 'Discovering...' : 'Discover models' }}
                      </UiButton>
                    </div>
                    <UiField
                      v-if="settingsLlmProviderPreset === 'codex' && settingsLlmCodexModels.length > 0"
                      for-id="settings-llm-codex-model"
                      label="Discovered Codex models"
                    >
                      <template #default>
                        <UiSelect
                          id="settings-llm-codex-model"
                          :model-value="settingsLlmModel"
                          @update:model-value="settingsLlmModel = $event"
                        >
                          <option v-for="item in settingsLlmCodexModels" :key="item.id" :value="item.id">
                            {{ item.display_name }} ({{ item.id }})
                          </option>
                        </UiSelect>
                      </template>
                    </UiField>
                  </div>
                </template>
              </UiField>

              <UiField v-if="settingsLlmProviderPreset !== 'codex'" for-id="settings-llm-base-url" label="Base URL (optional)">
                <template #default="{ describedBy, invalid }">
                  <UiInput
                    id="settings-llm-base-url"
                    v-model="settingsLlmBaseUrl"
                    size="sm"
                    placeholder="https://... or http://localhost:11434/v1"
                    :aria-describedby="describedBy"
                    :invalid="invalid"
                    @keydown="onSettingsInputKeydown"
                  />
                </template>
              </UiField>

              <UiField
                for-id="settings-llm-apikey"
                label="API key"
                :help="settingsLlmProviderPreset === 'codex' ? 'Codex uses the local CLI session instead of a saved API key.' : ''"
              >
                <template #default="{ describedBy, invalid }">
                  <UiInput
                    id="settings-llm-apikey"
                    v-model="settingsLlmApiKey"
                    size="sm"
                    data-settings-llm-apikey="true"
                    type="password"
                    :placeholder="settingsLlmProviderPreset === 'codex'
                      ? 'not used for Codex'
                      : settingsLlmHasStoredApiKey
                        ? 'stored key (leave empty to keep)'
                        : 'api key'"
                    :disabled="settingsLlmProviderPreset === 'codex'"
                    :aria-describedby="describedBy"
                    :invalid="invalid"
                    @keydown="onSettingsInputKeydown"
                  />
                </template>
              </UiField>
            </div>

            <div v-else class="settings-fields">
              <fieldset class="settings-mode-group">
                <legend class="settings-mode-group__legend">Embedding mode</legend>
                <label class="settings-mode-option">
                  <input
                    :checked="settingsEmbeddingsMode === 'internal'"
                    type="radio"
                    name="settings-embeddings-mode"
                    value="internal"
                    @click="settingsEmbeddingsMode = 'internal'"
                  />
                  <span>Internal model (fastembed)</span>
                </label>
                <label class="settings-mode-option">
                  <input
                    :checked="settingsEmbeddingsMode === 'external'"
                    type="radio"
                    name="settings-embeddings-mode"
                    value="external"
                    @click="settingsEmbeddingsMode = 'external'"
                  />
                  <span>External model (API)</span>
                </label>
              </fieldset>

              <template v-if="settingsEmbeddingsMode === 'external'">
                <UiField for-id="settings-emb-provider" label="Provider">
                  <template #default>
                    <UiSelect id="settings-emb-provider" v-model="settingsEmbeddingsProvider">
                      <option value="openai">OpenAI</option>
                    </UiSelect>
                  </template>
                </UiField>

                <UiField for-id="settings-emb-label" label="Profile label">
                  <template #default="{ describedBy, invalid }">
                    <UiInput
                      id="settings-emb-label"
                      v-model="settingsEmbeddingsLabel"
                      size="sm"
                      placeholder="OpenAI Embeddings"
                      :aria-describedby="describedBy"
                      :invalid="invalid"
                      @keydown="onSettingsInputKeydown"
                    />
                  </template>
                </UiField>

                <UiField for-id="settings-emb-model" label="Model">
                  <template #default="{ describedBy, invalid }">
                    <UiInput
                      id="settings-emb-model"
                      v-model="settingsEmbeddingsModel"
                      size="sm"
                      placeholder="text-embedding-3-small"
                      :aria-describedby="describedBy"
                      :invalid="invalid"
                      @keydown="onSettingsInputKeydown"
                    />
                  </template>
                </UiField>

                <UiField for-id="settings-emb-base-url" label="Base URL (optional)">
                  <template #default="{ describedBy, invalid }">
                    <UiInput
                      id="settings-emb-base-url"
                      v-model="settingsEmbeddingsBaseUrl"
                      size="sm"
                      placeholder="https://..."
                      :aria-describedby="describedBy"
                      :invalid="invalid"
                      @keydown="onSettingsInputKeydown"
                    />
                  </template>
                </UiField>

                <UiField
                  for-id="settings-emb-apikey"
                  label="API key"
                  :help="settingsEmbeddingsHasStoredApiKey ? 'Leave empty to keep the stored key.' : ''"
                >
                  <template #default="{ describedBy, invalid }">
                    <UiInput
                      id="settings-emb-apikey"
                      v-model="settingsEmbeddingsApiKey"
                      size="sm"
                      type="password"
                      :placeholder="settingsEmbeddingsHasStoredApiKey ? 'stored key (leave empty to keep)' : 'api key'"
                      :aria-describedby="describedBy"
                      :invalid="invalid"
                      @keydown="onSettingsInputKeydown"
                    />
                  </template>
                </UiField>
              </template>
            </div>

            <p v-if="settingsConfigPath" class="settings-config-path"><code>{{ settingsConfigPath }}</code></p>
            <p v-if="settingsModalError" class="modal-input-error settings-error">{{ settingsModalError }}</p>
          </div>

          <footer class="settings-footer">
            <div class="settings-footer-actions">
              <UiButton size="sm" variant="ghost" @click="emit('cancel')">Cancel</UiButton>
              <UiButton size="sm" variant="primary" @click="submitSettingsModal">Save</UiButton>
            </div>
          </footer>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-modal {
  width: min(920px, calc(100vw - 40px));
  padding: 0;
  overflow: hidden;
}

.settings-shell {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.settings-shell__eyebrow {
  color: var(--text-faint);
  font-size: 0.7rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  padding: 16px 24px 12px;
}

.settings-panel :deep(.ui-field__label) {
  font-size: 0.72rem;
  color: var(--text-soft);
}

.settings-panel :deep(.ui-field__help) {
  font-size: 0.74rem;
  color: var(--text-dim);
}

.settings-panel {
  display: flex;
  flex-direction: column;
}

.settings-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 24px 16px;
  border-bottom: 1px solid var(--panel-border);
}

.settings-panel__title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--text-main);
  text-transform: uppercase;
}

.settings-tabs {
  display: inline-flex;
  gap: 12px;
  align-items: center;
}

.settings-tab-btn {
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-md);
  font-size: 0.82rem;
  font-weight: 600;
  padding: 6px 12px;
  color: var(--text-soft);
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
}

.settings-tab-btn.active {
  border-color: var(--button-secondary-border);
  background: var(--surface-bg);
  color: var(--text-main);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}

.settings-tab-btn:hover {
  color: var(--text-main);
  background: color-mix(in srgb, var(--surface-muted) 55%, transparent);
}

.settings-panel__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 24px 14px;
}

.settings-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-mode-group {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-mode-group__legend {
  margin: 0 0 4px;
  color: var(--field-label);
  font-size: 0.72rem;
  font-weight: 600;
}

.settings-mode-option {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-main);
  font-size: 0.82rem;
}

.settings-model-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-model-input {
  min-width: 0;
}

.settings-panel :deep(.ui-select) {
  height: 2.45rem;
  font-size: 0.9rem;
}

.settings-model-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: -1px;
}

.settings-discover-btn {
  white-space: nowrap;
  padding-inline: 0;
  height: auto;
  font-size: 0.74rem;
}

.settings-config-path {
  margin: 6px 0 0;
  color: var(--text-faint);
  font-size: 0.76rem;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  padding: 14px 24px 18px;
  border-top: 1px solid var(--panel-border);
}

.settings-footer-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.settings-error {
  margin-top: -2px;
}

@media (max-width: 720px) {
  .settings-panel__header {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-tabs {
    align-self: flex-start;
  }

  .settings-footer {
    padding-inline: 24px;
  }

  .settings-panel__body,
  .settings-panel__header,
  .settings-shell__eyebrow {
    padding-inline: 24px;
  }
}
</style>
