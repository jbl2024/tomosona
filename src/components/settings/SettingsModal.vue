<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import UiButton from '../ui/UiButton.vue'
import {
  readAppSettings,
  writeAppSettings,
  discoverCodexModels as discoverCodexModelsApi
} from '../../shared/api/settingsApi'
import type {
  AppSettingsView,
  CodexDiscoveredModel,
  SaveAppSettingsPayload,
  WriteAppSettingsResult
} from '../../shared/api/apiTypes'

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
      <h3 id="settings-title" class="confirm-title">Settings</h3>
      <div class="settings-tabs" role="tablist" aria-label="Settings tabs">
        <button type="button" class="settings-tab-btn" :class="{ active: settingsActiveTab === 'llm' }" @click="settingsActiveTab = 'llm'">LLM</button>
        <button type="button" class="settings-tab-btn" :class="{ active: settingsActiveTab === 'embeddings' }" @click="settingsActiveTab = 'embeddings'">Embeddings</button>
      </div>

      <div v-if="settingsActiveTab === 'llm'" class="settings-tab-panel">
        <label class="modal-field-label" for="settings-llm-provider">Provider preset</label>
        <select
          id="settings-llm-provider"
          class="tool-input"
          :value="settingsLlmProviderPreset"
          @change="applySettingsLlmPreset(($event.target as HTMLSelectElement).value as 'openai' | 'anthropic' | 'codex' | 'custom')"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="codex">OpenAI Codex</option>
          <option value="custom">Custom</option>
        </select>

        <label class="modal-field-label" for="settings-llm-label">Profile label</label>
        <input id="settings-llm-label" v-model="settingsLlmLabel" class="tool-input" placeholder="Profile label" @keydown="onSettingsInputKeydown" />

        <label v-if="settingsLlmProviderPreset === 'custom'" class="modal-field-label" for="settings-llm-custom-provider">Custom provider</label>
        <input
          v-if="settingsLlmProviderPreset === 'custom'"
          id="settings-llm-custom-provider"
          v-model="settingsLlmCustomProvider"
          class="tool-input"
          placeholder="openai_compatible"
          @keydown="onSettingsInputKeydown"
        />

        <label class="modal-field-label" for="settings-llm-model">Model</label>
        <div class="settings-model-group">
          <div class="settings-model-input-row">
            <input id="settings-llm-model" v-model="settingsLlmModel" class="tool-input" placeholder="Model name" @keydown="onSettingsInputKeydown" />
            <button
              v-if="settingsLlmProviderPreset === 'codex'"
              type="button"
              class="settings-discover-btn"
              :disabled="settingsLlmCodexModelsLoading"
              @click="discoverCodexModels"
            >
              {{ settingsLlmCodexModelsLoading ? 'Discovering...' : 'Discover models' }}
            </button>
          </div>
          <select
            v-if="settingsLlmProviderPreset === 'codex' && settingsLlmCodexModels.length > 0"
            class="tool-input"
            :value="settingsLlmModel"
            @change="settingsLlmModel = ($event.target as HTMLSelectElement).value"
          >
            <option
              v-for="item in settingsLlmCodexModels"
              :key="item.id"
              :value="item.id"
            >
              {{ item.display_name }} ({{ item.id }})
            </option>
          </select>
        </div>
        <p v-if="settingsLlmProviderPreset === 'codex'" class="modal-field-hint">
          Use the Codex CLI session (<code>~/.codex/auth.json</code>).
          You can also enter any model ID manually.
        </p>

        <label v-if="settingsLlmProviderPreset !== 'codex'" class="modal-field-label" for="settings-llm-base-url">Base URL (optional)</label>
        <input
          v-if="settingsLlmProviderPreset !== 'codex'"
          id="settings-llm-base-url"
          v-model="settingsLlmBaseUrl"
          class="tool-input"
          placeholder="https://... or http://localhost:11434/v1"
          @keydown="onSettingsInputKeydown"
        />

        <label class="modal-field-label" for="settings-llm-apikey">API key</label>
        <input
          id="settings-llm-apikey"
          v-model="settingsLlmApiKey"
          data-settings-llm-apikey="true"
          class="tool-input"
          type="password"
          :placeholder="settingsLlmProviderPreset === 'codex'
            ? 'not used for Codex'
            : settingsLlmHasStoredApiKey
              ? 'stored key (leave empty to keep)'
              : 'api key'"
          :disabled="settingsLlmProviderPreset === 'codex'"
          @keydown="onSettingsInputKeydown"
        />
      </div>

      <div v-else class="settings-tab-panel">
        <label class="modal-field-label settings-checkbox-row">
          <input v-model="settingsEmbeddingsMode" type="radio" value="internal" />
          <span>Internal model (fastembed)</span>
        </label>
        <label class="modal-field-label settings-checkbox-row">
          <input v-model="settingsEmbeddingsMode" type="radio" value="external" />
          <span>External model (API)</span>
        </label>

        <template v-if="settingsEmbeddingsMode === 'external'">
          <label class="modal-field-label" for="settings-emb-provider">Provider</label>
          <select id="settings-emb-provider" v-model="settingsEmbeddingsProvider" class="tool-input">
            <option value="openai">OpenAI</option>
          </select>

          <label class="modal-field-label" for="settings-emb-label">Profile label</label>
          <input id="settings-emb-label" v-model="settingsEmbeddingsLabel" class="tool-input" placeholder="OpenAI Embeddings" @keydown="onSettingsInputKeydown" />

          <label class="modal-field-label" for="settings-emb-model">Model</label>
          <input id="settings-emb-model" v-model="settingsEmbeddingsModel" class="tool-input" placeholder="text-embedding-3-small" @keydown="onSettingsInputKeydown" />

          <label class="modal-field-label" for="settings-emb-base-url">Base URL (optional)</label>
          <input id="settings-emb-base-url" v-model="settingsEmbeddingsBaseUrl" class="tool-input" placeholder="https://..." @keydown="onSettingsInputKeydown" />

          <label class="modal-field-label" for="settings-emb-apikey">API key</label>
          <input
            id="settings-emb-apikey"
            v-model="settingsEmbeddingsApiKey"
            class="tool-input"
            type="password"
            :placeholder="settingsEmbeddingsHasStoredApiKey ? 'stored key (leave empty to keep)' : 'api key'"
            @keydown="onSettingsInputKeydown"
          />
        </template>
      </div>

      <p v-if="settingsModalError" class="modal-input-error">{{ settingsModalError }}</p>
      <div class="settings-footer">
        <p class="settings-config-path"><code>{{ settingsConfigPath }}</code></p>
        <div class="settings-footer-actions">
          <button type="button" class="settings-cancel-btn" @click="emit('cancel')">Cancel</button>
          <UiButton size="sm" variant="primary" @click="submitSettingsModal">Save</UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-modal {
  width: min(960px, calc(100vw - 32px));
}

.settings-tabs {
  display: inline-flex;
  gap: 6px;
  margin: 2px 0 0;
}

.settings-tab-btn {
  border: 1px solid var(--modal-tab-border);
  border-bottom-color: transparent;
  background: var(--modal-tab-bg);
  border-radius: 8px 8px 0 0;
  font-size: 12px;
  padding: 6px 10px;
  color: var(--text-soft);
}

.settings-tab-btn.active {
  border-color: var(--modal-tab-active-border);
  border-bottom-color: var(--modal-tab-active-bg);
  background: var(--modal-tab-active-bg);
  color: var(--modal-tab-active-text);
  position: relative;
  z-index: 1;
}

.settings-tab-panel {
  border: 1px solid var(--modal-panel-border);
  border-top: 0;
  border-radius: 0 8px 8px 8px;
  padding: 12px;
  background: var(--modal-panel-bg);
}

.settings-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-model-group {
  margin: 0 0 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 8px;
  background: var(--modal-group-bg);
}

.settings-model-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.settings-discover-btn {
  border: 0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-soft);
  background: var(--modal-muted-btn-bg);
  cursor: pointer;
  white-space: nowrap;
}

.settings-discover-btn:hover:not(:disabled) {
  background: var(--modal-muted-btn-hover);
  color: var(--text-main);
}

.settings-discover-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.settings-footer {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.settings-config-path {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}

.settings-footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-cancel-btn {
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}

.settings-cancel-btn:hover {
  color: var(--text-main);
}
</style>
