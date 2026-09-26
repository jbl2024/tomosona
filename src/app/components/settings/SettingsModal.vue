<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../shared/components/ui/UiFilterableDropdown.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import UiSelect from '../../../shared/components/ui/UiSelect.vue'
import UiTextarea from '../../../shared/components/ui/UiTextarea.vue'
import {
  readAppSettings,
  discoverLlmModels as discoverLlmModelsApi,
  discoverEmbeddingModels as discoverEmbeddingModelsApi,
  writeAppSettings,
  discoverCodexModels as discoverCodexModelsApi
} from '../../../shared/api/settingsApi'
import type {
  AppSettingsView,
  CodexDiscoveredModel,
  DiscoverEmbeddingModelsPayload,
  LlmDiscoveredModel,
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
const settingsLlmApiKeyVisible = ref(false)
const settingsLlmModel = ref('gpt-4.1')
const settingsLlmTemperature = ref('0.15')
const settingsLlmSystemPrompt = ref('')
const settingsLlmBaseUrl = ref('')
const settingsLlmCustomProvider = ref('')
const settingsLlmLabel = ref('OpenAI Remote')
const settingsLlmCodexModels = ref<CodexDiscoveredModel[]>([])
const settingsLlmCodexModelsLoading = ref(false)
const settingsLlmAvailableModels = ref<LlmDiscoveredModel[]>([])
const settingsLlmModelsLoading = ref(false)
const settingsLlmModelPickerOpen = ref(false)
const settingsLlmModelPickerQuery = ref('')
const settingsLlmModelPickerActiveIndex = ref(0)
const settingsEmbeddingsMode = ref<'internal' | 'external'>('internal')
const settingsEmbeddingsProvider = ref<'openai'>('openai')
const settingsEmbeddingsApiKey = ref('')
const settingsEmbeddingsApiKeyVisible = ref(false)
const settingsEmbeddingsModel = ref('text-embedding-3-small')
const settingsEmbeddingsBaseUrl = ref('')
const settingsEmbeddingsLabel = ref('OpenAI Embeddings')
const settingsEmbeddingsAvailableModels = ref<LlmDiscoveredModel[]>([])
const settingsEmbeddingsModelsLoading = ref(false)
const settingsEmbeddingsModelPickerOpen = ref(false)
const settingsEmbeddingsModelPickerQuery = ref('')
const settingsEmbeddingsModelPickerActiveIndex = ref(0)
const settingsModalError = ref('')

const settingsLlmAvailableModelItems = computed<FilterableDropdownItem[]>(() =>
  settingsLlmAvailableModels.value.map((item) => ({
    id: item.id,
    label: item.display_name,
    display_name: item.display_name,
    group: item.group
  }))
)

const settingsLlmModelHelp = computed(() => {
  if (settingsLlmProviderPreset.value === 'codex') {
    return 'Use the Codex CLI session (~/.codex/auth.json). You can also enter any model ID manually.'
  }
  if (settingsLlmAvailableModels.value.length > 0) {
    return `${settingsLlmAvailableModels.value.length} models loaded from the endpoint.`
  }
  return 'Use Test to load models from the configured endpoint.'
})

const settingsLlmModelPlaceholder = computed(() => {
  if (settingsLlmProviderPreset.value === 'codex') {
    return 'gpt-5.2-codex'
  }
  if (settingsLlmProviderPreset.value === 'anthropic') {
    return 'claude-3-7-sonnet-latest'
  }
  if (settingsLlmProviderPreset.value === 'custom') {
    return 'openweight-medium'
  }
  return 'gpt-4.1'
})

const settingsLlmApiKeyPlaceholder = computed(() => {
  return 'api key'
})

const settingsEmbeddingsAvailableModelItems = computed<FilterableDropdownItem[]>(() =>
  settingsEmbeddingsAvailableModels.value.map((item) => ({
    id: item.id,
    label: item.display_name,
    display_name: item.display_name,
    group: item.group
  }))
)

const settingsEmbeddingsModelHelp = computed(() => {
  if (settingsEmbeddingsAvailableModels.value.length > 0) {
    return `${settingsEmbeddingsAvailableModels.value.length} embedding models loaded from the endpoint.`
  }
  return 'Use Test to load embedding models from the configured endpoint.'
})

const settingsEmbeddingsModelPlaceholder = computed(() => {
  return settingsEmbeddingsProvider.value === 'openai'
    ? 'text-embedding-3-small'
    : 'text-embedding-3-small'
})

const settingsEmbeddingsApiKeyPlaceholder = computed(() => {
  return 'api key'
})

function isSecretValueProvided(value: string): boolean {
  return value.trim().length > 0
}

function secretInputType(visible: boolean): 'text' | 'password' {
  return visible ? 'text' : 'password'
}

function formatSettingsError(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown
      cause?: unknown
      data?: unknown
      toString?: () => string
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim()
    }
    if (typeof candidate.data === 'string' && candidate.data.trim()) {
      return candidate.data.trim()
    }
    if (candidate.data && typeof candidate.data === 'object') {
      const nested = candidate.data as { message?: unknown; error?: unknown; detail?: unknown }
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message.trim()
      }
      if (typeof nested.error === 'string' && nested.error.trim()) {
        return nested.error.trim()
      }
      if (typeof nested.detail === 'string' && nested.detail.trim()) {
        return nested.detail.trim()
      }
    }
    if (typeof candidate.cause === 'object' && candidate.cause !== null) {
      const nested = candidate.cause as { message?: unknown }
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message.trim()
      }
    }
    if (typeof candidate.toString === 'function') {
      const text = candidate.toString()
      if (text && text !== '[object Object]') {
        return text
      }
    }
  }

  return fallback
}

function applySettingsLlmPreset(provider: 'openai' | 'anthropic' | 'codex' | 'custom') {
  settingsLlmProviderPreset.value = provider
  settingsModalError.value = ''
  settingsLlmAvailableModels.value = []
  settingsLlmModelsLoading.value = false
  settingsLlmModelPickerOpen.value = false
  settingsLlmModelPickerQuery.value = ''
  settingsLlmModelPickerActiveIndex.value = 0
  if (provider === 'openai') {
    settingsLlmLabel.value = 'OpenAI Remote'
    settingsLlmCustomProvider.value = 'openai'
    settingsLlmModel.value = 'gpt-4.1'
    settingsLlmTemperature.value = '0.15'
    settingsLlmBaseUrl.value = ''
    return
  }
  if (provider === 'anthropic') {
    settingsLlmLabel.value = 'Anthropic Claude'
    settingsLlmCustomProvider.value = 'anthropic'
    settingsLlmModel.value = 'claude-3-7-sonnet-latest'
    settingsLlmTemperature.value = '0.15'
    settingsLlmBaseUrl.value = ''
    return
  }
  if (provider === 'codex') {
    settingsLlmLabel.value = 'OpenAI Codex'
    settingsLlmCustomProvider.value = 'openai-codex'
    settingsLlmModel.value = 'gpt-5.2-codex'
    settingsLlmTemperature.value = '0.15'
    settingsLlmBaseUrl.value = ''
    if (!settingsLlmCodexModels.value.length && !settingsLlmCodexModelsLoading.value) {
      void discoverCodexModels()
    }
    return
  }
  settingsLlmLabel.value = 'Custom LLM'
  settingsLlmCustomProvider.value = 'custom'
  settingsLlmModel.value = ''
  settingsLlmTemperature.value = '0.15'
  settingsLlmBaseUrl.value = ''
}

function applySettingsDefaults() {
  settingsActiveTab.value = 'llm'
  settingsConfigPath.value = '~/.tomosona/conf.json'
  settingsLlmApiKey.value = ''
  settingsLlmApiKeyVisible.value = false
  settingsLlmSystemPrompt.value = ''
  settingsLlmCodexModels.value = []
  settingsLlmCodexModelsLoading.value = false
  settingsLlmAvailableModels.value = []
  settingsLlmModelsLoading.value = false
  settingsLlmModelPickerOpen.value = false
  settingsLlmModelPickerQuery.value = ''
  settingsLlmModelPickerActiveIndex.value = 0
  settingsEmbeddingsAvailableModels.value = []
  settingsEmbeddingsModelsLoading.value = false
  settingsEmbeddingsModelPickerOpen.value = false
  settingsEmbeddingsModelPickerQuery.value = ''
  settingsEmbeddingsModelPickerActiveIndex.value = 0
  applySettingsLlmPreset('openai')
  settingsEmbeddingsMode.value = 'internal'
  settingsEmbeddingsProvider.value = 'openai'
  settingsEmbeddingsLabel.value = 'OpenAI Embeddings'
  settingsEmbeddingsModel.value = 'text-embedding-3-small'
  settingsEmbeddingsBaseUrl.value = ''
  settingsEmbeddingsApiKey.value = ''
  settingsEmbeddingsApiKeyVisible.value = false
  settingsModalError.value = ''
}

function currentLlmProvider() {
  return settingsLlmProviderPreset.value === 'openai'
    ? 'openai'
    : settingsLlmProviderPreset.value === 'anthropic'
      ? 'anthropic'
      : settingsLlmProviderPreset.value === 'codex'
        ? 'openai-codex'
        : settingsLlmCustomProvider.value.trim() || 'custom'
}

function currentLlmProfileId() {
  return settingsLlmProviderPreset.value === 'custom'
    ? 'custom-profile'
    : settingsLlmProviderPreset.value === 'codex'
      ? 'openai-codex-profile'
      : `${currentLlmProvider()}-profile`
}

function clearLlmModelDiscoveryState() {
  settingsLlmAvailableModels.value = []
  settingsLlmModelsLoading.value = false
  settingsLlmModelPickerOpen.value = false
  settingsLlmModelPickerQuery.value = ''
  settingsLlmModelPickerActiveIndex.value = 0
}

function toggleLlmApiKeyVisibility() {
  settingsLlmApiKeyVisible.value = !settingsLlmApiKeyVisible.value
}

function toggleEmbeddingsApiKeyVisibility() {
  settingsEmbeddingsApiKeyVisible.value = !settingsEmbeddingsApiKeyVisible.value
}

function clearEmbeddingsModelDiscoveryState() {
  settingsEmbeddingsAvailableModels.value = []
  settingsEmbeddingsModelsLoading.value = false
  settingsEmbeddingsModelPickerOpen.value = false
  settingsEmbeddingsModelPickerQuery.value = ''
  settingsEmbeddingsModelPickerActiveIndex.value = 0
}

function selectDiscoveredLlmModel(item: FilterableDropdownItem) {
  settingsLlmModel.value = item.id
}

function selectDiscoveredEmbeddingModel(item: FilterableDropdownItem) {
  settingsEmbeddingsModel.value = item.id
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
    settingsModalError.value = formatSettingsError(err, 'Could not discover Codex models.')
  } finally {
    settingsLlmCodexModelsLoading.value = false
  }
}

function buildLlmModelMatcher(item: FilterableDropdownItem, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const modelItem = item as FilterableDropdownItem & { display_name?: string }
  const displayName = typeof modelItem.display_name === 'string'
    ? modelItem.display_name.toLowerCase()
    : item.label.toLowerCase()
  return item.id.toLowerCase().includes(needle) || displayName.includes(needle)
}

async function discoverSettingsLlmModels() {
  settingsLlmModelsLoading.value = true
  settingsModalError.value = ''
  try {
    const apiKeyProvided = isSecretValueProvided(settingsLlmApiKey.value)
    const models = await discoverLlmModelsApi({
      profile_id: currentLlmProfileId(),
      provider: currentLlmProvider(),
      api_key: apiKeyProvided ? settingsLlmApiKey.value.trim() : undefined,
      preserve_existing_api_key: false,
      base_url: settingsLlmBaseUrl.value.trim() || undefined
    })
    settingsLlmAvailableModels.value = models
    const selectedIndex = models.findIndex((item) => item.id === settingsLlmModel.value.trim())
    if (!settingsLlmModel.value.trim() && models.length > 0) {
      settingsLlmModel.value = models[0]!.id
    }
    settingsLlmModelPickerQuery.value = ''
    settingsLlmModelPickerActiveIndex.value = selectedIndex >= 0 ? selectedIndex : 0
    settingsLlmModelPickerOpen.value = models.length > 0
    if (!models.length) {
      settingsModalError.value = 'Model discovery returned no models.'
    }
  } catch (err) {
    clearLlmModelDiscoveryState()
    settingsModalError.value = formatSettingsError(err, 'Could not discover models.')
  } finally {
    settingsLlmModelsLoading.value = false
  }
}

async function discoverSettingsEmbeddingModels() {
  settingsEmbeddingsModelsLoading.value = true
  settingsModalError.value = ''
  try {
    const apiKeyProvided = isSecretValueProvided(settingsEmbeddingsApiKey.value)
    const payload: DiscoverEmbeddingModelsPayload = {
      profile_id: 'emb-openai-profile',
      api_key: apiKeyProvided ? settingsEmbeddingsApiKey.value.trim() : undefined,
      preserve_existing_api_key: false,
      base_url: settingsEmbeddingsBaseUrl.value.trim() || undefined
    }
    const models = await discoverEmbeddingModelsApi(payload)
    settingsEmbeddingsAvailableModels.value = models
    const selectedIndex = models.findIndex((item) => item.id === settingsEmbeddingsModel.value.trim())
    if (!settingsEmbeddingsModel.value.trim() && models.length > 0) {
      settingsEmbeddingsModel.value = models[0]!.id
    }
    settingsEmbeddingsModelPickerQuery.value = ''
    settingsEmbeddingsModelPickerActiveIndex.value = selectedIndex >= 0 ? selectedIndex : 0
    settingsEmbeddingsModelPickerOpen.value = models.length > 0
    if (!models.length) {
      settingsModalError.value = 'Embedding model discovery returned no models.'
    }
  } catch (err) {
    clearEmbeddingsModelDiscoveryState()
    settingsModalError.value = formatSettingsError(err, 'Could not discover embeddings models.')
  } finally {
    settingsEmbeddingsModelsLoading.value = false
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
    settingsLlmTemperature.value = String(active.default_temperature ?? 0.15)
    settingsLlmSystemPrompt.value = active.system_prompt ?? ''
    settingsLlmBaseUrl.value = active.base_url ?? ''
    settingsLlmApiKey.value = active.api_key
  }
  clearLlmModelDiscoveryState()
  clearEmbeddingsModelDiscoveryState()
  settingsEmbeddingsMode.value = view.embeddings.mode
  if (view.embeddings.external) {
    settingsEmbeddingsProvider.value = 'openai'
    settingsEmbeddingsLabel.value = view.embeddings.external.label
    settingsEmbeddingsModel.value = view.embeddings.external.model
    settingsEmbeddingsBaseUrl.value = view.embeddings.external.base_url ?? ''
    settingsEmbeddingsApiKey.value = view.embeddings.external.api_key
  } else {
    settingsEmbeddingsProvider.value = 'openai'
    settingsEmbeddingsLabel.value = 'OpenAI Embeddings'
    settingsEmbeddingsModel.value = 'text-embedding-3-small'
    settingsEmbeddingsBaseUrl.value = ''
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
    settingsModalError.value = formatSettingsError(err, 'Could not read settings.')
  }
}

function buildSaveSettingsPayload(): SaveAppSettingsPayload {
  const llmProvider = currentLlmProvider()
  const llmProfileId = currentLlmProfileId()
  const llmApiKeyValue = settingsLlmApiKey.value.trim()
  const llmApiKeyProvided = isSecretValueProvided(settingsLlmApiKey.value)
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
    default_temperature: Number.parseFloat(settingsLlmTemperature.value),
    system_prompt: settingsLlmSystemPrompt.value.trim(),
    preserve_existing_api_key: false,
    capabilities,
    default_mode: 'freestyle',
    ...(settingsLlmProviderPreset.value !== 'codex' && llmApiKeyProvided
      ? { api_key: llmApiKeyValue }
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
    },
  }
  if (settingsEmbeddingsMode.value === 'external') {
    const embeddingApiKeyValue = settingsEmbeddingsApiKey.value.trim()
    const embeddingApiKeyProvided = isSecretValueProvided(settingsEmbeddingsApiKey.value)
    payload.embeddings.external = {
      id: 'emb-openai-profile',
      label: settingsEmbeddingsLabel.value.trim() || 'OpenAI Embeddings',
      provider: settingsEmbeddingsProvider.value,
      model: settingsEmbeddingsModel.value.trim(),
      preserve_existing_api_key: false,
      ...(embeddingApiKeyProvided ? { api_key: embeddingApiKeyValue } : {}),
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
  const temperature = Number.parseFloat(settingsLlmTemperature.value)
  if (Number.isNaN(temperature) || temperature < 0 || temperature > 1) {
    settingsModalError.value = 'LLM temperature must be between 0 and 1.'
    return
  }
  if (settingsLlmProviderPreset.value === 'custom' && !settingsLlmBaseUrl.value.trim()) {
    settingsModalError.value = 'Base URL is required for Custom LLM.'
    return
  }
  if (
    settingsLlmProviderPreset.value !== 'codex'
    && !settingsLlmApiKey.value.trim()
  ) {
    settingsModalError.value = 'LLM API key is required.'
    return
  }
  if (settingsEmbeddingsMode.value === 'external' && !settingsEmbeddingsModel.value.trim()) {
    settingsModalError.value = 'Embeddings model is required.'
    return
  }
  if (settingsEmbeddingsMode.value === 'external' && !settingsEmbeddingsApiKey.value.trim()) {
    settingsModalError.value = 'Embeddings API key is required for external mode.'
    return
  }
  settingsModalError.value = ''

  try {
    const result = await writeAppSettings(buildSaveSettingsPayload())
    emit('saved', result)
  } catch (err) {
    settingsModalError.value = formatSettingsError(err, 'Could not save settings.')
  }
}

function onSettingsInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
    return
  }

  if (event.key === 'Enter' && event.target instanceof HTMLTextAreaElement) {
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
  <div v-if="visible" class="modal-overlay settings-modal-overlay">
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
              {{
                settingsActiveTab === 'llm'
                  ? 'LLM SETTINGS'
                  : 'EMBEDDINGS SETTINGS'
              }}
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
                    size="sm"
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

              <UiField
                v-if="settingsLlmProviderPreset === 'custom'"
                for-id="settings-llm-custom-provider"
                label="Provider alias"
                help="Used as metadata only. The endpoint comes from Base URL."
              >
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
                :help="settingsLlmModelHelp"
              >
                <template #default="{ describedBy, invalid }">
                  <div class="settings-model-group">
                    <div class="settings-model-row">
                      <UiInput
                        id="settings-llm-model"
                        v-model="settingsLlmModel"
                        size="sm"
                        :placeholder="settingsLlmModelPlaceholder"
                        class-name="settings-model-input"
                        :aria-describedby="describedBy"
                        :invalid="invalid"
                        @keydown="onSettingsInputKeydown"
                      />
                      <div class="settings-model-actions">
                        <UiButton
                          v-if="settingsLlmProviderPreset === 'codex'"
                          size="sm"
                          variant="ghost"
                          :loading="settingsLlmCodexModelsLoading"
                          class-name="settings-discover-btn"
                          @click="discoverCodexModels"
                        >
                          {{ settingsLlmCodexModelsLoading ? 'Discovering...' : 'Discover models' }}
                        </UiButton>
                        <UiButton
                          v-else
                          size="sm"
                          variant="ghost"
                          :loading="settingsLlmModelsLoading"
                          class-name="settings-discover-btn"
                          @click="discoverSettingsLlmModels"
                        >
                          {{ settingsLlmModelsLoading ? 'Testing...' : 'Test' }}
                        </UiButton>
                      </div>
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
                          size="sm"
                          @update:model-value="settingsLlmModel = $event"
                        >
                          <option v-for="item in settingsLlmCodexModels" :key="item.id" :value="item.id">
                            {{ item.display_name }} ({{ item.id }})
                          </option>
                        </UiSelect>
                      </template>
                    </UiField>
                    <UiFilterableDropdown
                      v-if="settingsLlmProviderPreset !== 'codex' && settingsLlmAvailableModels.length > 0"
                      class="settings-model-picker"
                      :items="settingsLlmAvailableModelItems"
                      :model-value="settingsLlmModelPickerOpen"
                      :query="settingsLlmModelPickerQuery"
                      :active-index="settingsLlmModelPickerActiveIndex"
                      :filter-placeholder="'Filter models...'"
                      :menu-mode="'portal'"
                      :menu-class="'settings-model-dropdown'"
                      :matcher="buildLlmModelMatcher"
                      @open-change="settingsLlmModelPickerOpen = $event"
                      @query-change="settingsLlmModelPickerQuery = $event"
                      @active-index-change="settingsLlmModelPickerActiveIndex = $event"
                      @select="selectDiscoveredLlmModel($event)"
                    >
                      <template #trigger="{ toggleMenu, open }">
                        <UiButton
                          size="sm"
                          variant="secondary"
                          class-name="settings-model-picker-btn"
                          @click="toggleMenu"
                        >
                          {{ open ? 'Close models' : 'Models' }}
                        </UiButton>
                      </template>
                      <template #item="{ item }">
                        <div class="settings-model-option">
                          <strong>{{ item.display_name }}</strong>
                          <span>{{ item.id }}</span>
                          <em v-if="item.group">{{ item.group }}</em>
                        </div>
                      </template>
                      <template #empty>
                        <span>No models found</span>
                      </template>
                    </UiFilterableDropdown>
                  </div>
                </template>
              </UiField>

              <UiField
                for-id="settings-llm-temperature"
                label="Default temperature"
                help="Used when a flow does not set a specific temperature."
              >
                <template #default="{ describedBy, invalid }">
                  <UiInput
                    id="settings-llm-temperature"
                    v-model="settingsLlmTemperature"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    inputmode="decimal"
                    size="sm"
                    placeholder="0.15"
                    :aria-describedby="describedBy"
                    :invalid="invalid"
                    @keydown="onSettingsInputKeydown"
                  />
                </template>
              </UiField>

              <UiField
                for-id="settings-llm-system-prompt"
                label="System prompt"
                help="Prepended to every LLM system prompt."
              >
                <template #default="{ describedBy, invalid }">
                  <UiTextarea
                    id="settings-llm-system-prompt"
                    v-model="settingsLlmSystemPrompt"
                    :rows="5"
                    placeholder="Global instruction added before every LLM system prompt."
                    :aria-describedby="describedBy"
                    :invalid="invalid"
                    @keydown="onSettingsInputKeydown"
                  />
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
                  <div class="settings-secret-row">
                    <UiInput
                      id="settings-llm-apikey"
                      v-model="settingsLlmApiKey"
                      size="sm"
                      data-settings-llm-apikey="true"
                      :type="secretInputType(settingsLlmApiKeyVisible)"
                      :placeholder="settingsLlmProviderPreset === 'codex'
                        ? 'not used for Codex'
                        : settingsLlmApiKeyPlaceholder"
                      :disabled="settingsLlmProviderPreset === 'codex'"
                      :aria-describedby="describedBy"
                      :invalid="invalid"
                      @keydown="onSettingsInputKeydown"
                    />
                    <UiIconButton
                      v-if="settingsLlmProviderPreset !== 'codex'"
                      size="sm"
                      variant="ghost"
                      :aria-label="settingsLlmApiKeyVisible ? 'Hide API key' : 'Reveal API key'"
                      :title="settingsLlmApiKeyVisible ? 'Hide API key' : 'Reveal API key'"
                      class-name="settings-secret-toggle"
                      @click="toggleLlmApiKeyVisibility"
                    >
                      <EyeSlashIcon v-if="settingsLlmApiKeyVisible" />
                      <EyeIcon v-else />
                    </UiIconButton>
                  </div>
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
                    <UiSelect id="settings-emb-provider" v-model="settingsEmbeddingsProvider" size="sm">
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

                <UiField for-id="settings-emb-model" label="Model" :help="settingsEmbeddingsModelHelp">
                  <template #default="{ describedBy, invalid }">
                    <div class="settings-model-group">
                      <div class="settings-model-row">
                        <UiInput
                          id="settings-emb-model"
                          v-model="settingsEmbeddingsModel"
                          size="sm"
                          :placeholder="settingsEmbeddingsModelPlaceholder"
                          class-name="settings-model-input"
                          :aria-describedby="describedBy"
                          :invalid="invalid"
                          @keydown="onSettingsInputKeydown"
                        />
                        <div class="settings-model-actions">
                          <UiButton
                            size="sm"
                            variant="ghost"
                            :loading="settingsEmbeddingsModelsLoading"
                            class-name="settings-discover-btn"
                            @click="discoverSettingsEmbeddingModels"
                          >
                            {{ settingsEmbeddingsModelsLoading ? 'Testing...' : 'Test' }}
                          </UiButton>
                        </div>
                      </div>
                      <UiFilterableDropdown
                        v-if="settingsEmbeddingsAvailableModels.length > 0"
                        class="settings-model-picker"
                        :items="settingsEmbeddingsAvailableModelItems"
                        :model-value="settingsEmbeddingsModelPickerOpen"
                        :query="settingsEmbeddingsModelPickerQuery"
                        :active-index="settingsEmbeddingsModelPickerActiveIndex"
                        :filter-placeholder="'Filter embedding models...'"
                        :menu-mode="'portal'"
                        :menu-class="'settings-model-dropdown'"
                        :matcher="buildLlmModelMatcher"
                        @open-change="settingsEmbeddingsModelPickerOpen = $event"
                        @query-change="settingsEmbeddingsModelPickerQuery = $event"
                        @active-index-change="settingsEmbeddingsModelPickerActiveIndex = $event"
                        @select="selectDiscoveredEmbeddingModel($event)"
                      >
                        <template #trigger="{ toggleMenu, open }">
                          <UiButton
                            size="sm"
                            variant="secondary"
                            class-name="settings-model-picker-btn"
                            @click="toggleMenu"
                          >
                            {{ open ? 'Close models' : 'Models' }}
                          </UiButton>
                        </template>
                        <template #item="{ item }">
                          <div class="settings-model-option">
                            <strong>{{ item.display_name }}</strong>
                            <span>{{ item.id }}</span>
                            <em v-if="item.group">{{ item.group }}</em>
                          </div>
                        </template>
                        <template #empty>
                          <span>No embedding models found</span>
                        </template>
                      </UiFilterableDropdown>
                    </div>
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
                >
                  <template #default="{ describedBy, invalid }">
                    <div class="settings-secret-row">
                      <UiInput
                        id="settings-emb-apikey"
                        v-model="settingsEmbeddingsApiKey"
                        size="sm"
                        :type="secretInputType(settingsEmbeddingsApiKeyVisible)"
                        :placeholder="settingsEmbeddingsApiKeyPlaceholder"
                        :aria-describedby="describedBy"
                        :invalid="invalid"
                        @keydown="onSettingsInputKeydown"
                      />
                      <UiIconButton
                        size="sm"
                        variant="ghost"
                        :aria-label="settingsEmbeddingsApiKeyVisible ? 'Hide API key' : 'Reveal API key'"
                        :title="settingsEmbeddingsApiKeyVisible ? 'Hide API key' : 'Reveal API key'"
                        class-name="settings-secret-toggle"
                        @click="toggleEmbeddingsApiKeyVisibility"
                      >
                        <EyeSlashIcon v-if="settingsEmbeddingsApiKeyVisible" />
                        <EyeIcon v-else />
                      </UiIconButton>
                    </div>
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
  width: min(860px, calc(100vw - 40px));
  max-height: calc(100dvh - 40px);
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-shell {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 0;
  min-height: 0;
}

.settings-modal-overlay {
  align-items: center;
  padding: 20px;
  padding-top: 20px;
}

.settings-shell__eyebrow {
  flex: 0 0 auto;
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
  flex: 1 1 auto;
  min-height: 0;
}

.settings-panel__header {
  flex: 0 0 auto;
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
  flex: 1 1 auto;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 24px 14px;
  scrollbar-gutter: stable;
}

.settings-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-main);
  font-size: 0.82rem;
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

.settings-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-model-input {
  flex: 1 1 auto;
  min-width: 0;
}

.settings-model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-discover-btn {
  white-space: nowrap;
  padding-inline: 0;
  height: auto;
  font-size: 0.74rem;
}

.settings-model-picker {
  width: 100%;
}

.settings-model-picker-btn {
  white-space: nowrap;
}

.settings-model-dropdown {
  width: min(680px, calc(100vw - 48px));
}

.settings-model-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-model-option strong {
  font-size: 0.82rem;
  font-weight: 600;
}

.settings-model-option span {
  font-size: 0.72rem;
  color: var(--text-dim);
}

.settings-model-option em {
  font-size: 0.68rem;
  font-style: normal;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.settings-secret-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-secret-row :deep(.ui-input) {
  flex: 1 1 auto;
  min-width: 0;
}

.settings-secret-toggle {
  flex: 0 0 auto;
}

.settings-config-path {
  margin: 6px 0 0;
  color: var(--text-faint);
  font-size: 0.76rem;
}

.settings-footer {
  flex: 0 0 auto;
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
  .settings-modal-overlay {
    padding: 12px;
  }

  .settings-modal {
    width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
  }

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
