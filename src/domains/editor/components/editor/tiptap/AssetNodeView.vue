<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowUpTrayIcon, PhotoIcon } from '@heroicons/vue/24/outline'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { AssetNodeExtensionOptions } from '../../../lib/tiptap/extensions/AssetNode'
import type { AssetPreviewPayload } from '../../../composables/useAssetPreviewDialog'
import { readImageDataUrl } from '../../../../../shared/api/workspaceApi'
import { decodeWorkspacePathSegments, isAbsoluteWorkspacePath } from '../../../../../domains/explorer/lib/workspacePaths'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../../shared/components/ui/UiFilterableDropdown.vue'
import UiIconButton from '../../../../../shared/components/ui/UiIconButton.vue'
import type { AssetBrowserDropdownItem } from '../../../lib/tiptap/assetBrowser'

const DATA_IMAGE_RE = /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);(?:base64,|charset=[^;,]+,)/i

const props = defineProps<{
  node: { attrs: { src?: string; alt?: string; title?: string; autoEdit?: boolean } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
  extension?: { options?: AssetNodeExtensionOptions }
}>()

const src = computed(() => String(props.node.attrs.src ?? '').trim())
const alt = computed(() => String(props.node.attrs.alt ?? ''))
const title = computed(() => String(props.node.attrs.title ?? ''))
const autoEdit = computed(() => Boolean(props.node.attrs.autoEdit))
const srcInputEl = ref<HTMLInputElement | null>(null)
const previewFailed = ref(false)
const previewLoading = ref(false)
const previewSrc = ref<string | null>(null)
const showFields = ref(false)
const showMediaBrowser = ref(false)
const mediaBrowserQuery = ref('')
const mediaBrowserActiveIndex = ref(0)
const uploadPending = ref(false)
let previewRequestToken = 0

function sanitizeBrowserSafeAssetSrc(raw: string): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  if (value.startsWith('data:')) {
    return DATA_IMAGE_RE.test(value) ? value : null
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    try {
      const protocol = new URL(value, 'https://tomosona.local').protocol.toLowerCase()
      return protocol === 'http:' || protocol === 'https:' || protocol === 'blob:' || protocol === 'asset:' || protocol === 'tauri:' ? value : null
    } catch {
      return null
    }
  }
  return null
}

const previewCandidate = computed(() => {
  const resolver = props.extension?.options?.resolvePreviewSrc
  return String(resolver ? resolver(src.value) ?? '' : src.value).trim()
})

const mediaItems = computed<AssetBrowserDropdownItem[]>(() =>
  props.extension?.options?.getAssetBrowserItems?.() ?? []
)

const remotePreviewSrc = computed(() => sanitizeBrowserSafeAssetSrc(previewCandidate.value))
const localPreviewPath = computed(() => {
  if (remotePreviewSrc.value) return null
  const normalized = decodeWorkspacePathSegments(previewCandidate.value)
  if (!normalized || !isAbsoluteWorkspacePath(normalized)) return null
  return normalized
})
const previewLabel = computed(() => alt.value || title.value || src.value || 'Asset')
const isEditing = computed(() => props.editor.isEditable && showFields.value)

function normalizeSearchText(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function mediaMatcher(item: FilterableDropdownItem, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true

  const fields = [
    item.label,
    String((item as AssetBrowserDropdownItem).meta ?? ''),
    String((item as AssetBrowserDropdownItem).path ?? '')
  ].map(normalizeSearchText)

  return fields.some((field) => field.includes(normalizedQuery))
}

function mediaItemMeta(item: FilterableDropdownItem): string {
  return String((item as AssetBrowserDropdownItem).meta ?? '')
}

function onMediaBrowserOpenChange(open: boolean) {
  showMediaBrowser.value = open
  if (open) {
    mediaBrowserQuery.value = ''
    mediaBrowserActiveIndex.value = 0
  }
}

function onMediaBrowserSelect(item: FilterableDropdownItem) {
  const path = String((item as AssetBrowserDropdownItem).path ?? '').trim()
  if (!path) return
  props.updateAttributes({ src: path })
  void nextTick().then(() => {
    focusSrcInput()
  })
}

async function uploadAssets() {
  const importer = props.extension?.options?.importAssetFiles
  if (!importer || uploadPending.value) return
  uploadPending.value = true
  try {
    const imported = await importer()
    if (imported[0]) {
      props.updateAttributes({ src: imported[0] })
    }
  } catch (error) {
    console.warn('[editor] asset-upload failed', error)
  } finally {
    uploadPending.value = false
  }
}

async function refreshPreview() {
  const token = ++previewRequestToken
  previewFailed.value = false
  previewLoading.value = false

  if (remotePreviewSrc.value) {
    previewSrc.value = remotePreviewSrc.value
    return
  }

  previewSrc.value = null
  const absolutePath = localPreviewPath.value
  if (!absolutePath) return

  previewLoading.value = true
  try {
    const dataUrl = await readImageDataUrl(absolutePath)
    if (token !== previewRequestToken) return
    previewSrc.value = sanitizeBrowserSafeAssetSrc(dataUrl)
    previewFailed.value = !previewSrc.value
  } catch (error) {
    if (token !== previewRequestToken) return
    previewSrc.value = null
    previewFailed.value = true
    console.warn('[editor] asset-preview failed', {
      src: src.value,
      previewCandidate: previewCandidate.value,
      absolutePath,
      error
    })
  } finally {
    if (token === previewRequestToken) {
      previewLoading.value = false
    }
  }
}

function onInput(key: 'src' | 'alt' | 'title', event: Event) {
  const input = event.target as HTMLInputElement | null
  props.updateAttributes({ [key]: input?.value ?? '' })
}

function focusSrcInput() {
  const input = srcInputEl.value
  if (!input) return
  input.focus({ preventScroll: true })
  input.setSelectionRange(0, input.value.length)
}

function requestAnimationFrameLike(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return window.setTimeout(() => callback(performance.now()), 16)
}

function openEditor() {
  if (!props.editor.isEditable) return
  showFields.value = true
  void nextTick().then(() => {
    requestAnimationFrameLike(() => {
      focusSrcInput()
    })
  })
}

function closeEditor() {
  showFields.value = false
}

function toggleEditor(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  if (showFields.value) {
    closeEditor()
    return
  }
  openEditor()
}

function openZoomPreview(event?: MouseEvent) {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  const payload: AssetPreviewPayload = {
    src: src.value,
    alt: alt.value,
    title: title.value,
    previewSrc: previewSrc.value
  }
  props.extension?.options?.openPreview?.(payload)
}

function scheduleAutoEditFocus() {
  if (!props.editor.isEditable || !autoEdit.value) return
  void nextTick().then(() => {
    requestAnimationFrameLike(() => {
      showFields.value = true
      focusSrcInput()
      props.updateAttributes({ autoEdit: false })
    })
  })
}

watch(autoEdit, () => {
  scheduleAutoEditFocus()
}, { immediate: true })

watch(previewCandidate, () => {
  void refreshPreview()
}, { immediate: true })

onMounted(() => {
  scheduleAutoEditFocus()
})
</script>

<template>
  <NodeViewWrapper class="tomosona-asset-node" :class="{ 'is-editing': isEditing }" data-asset-node="true">
    <div class="tomosona-asset-surface" :class="{ 'is-editable': editor.isEditable }">
      <div class="tomosona-asset-header" contenteditable="false">
        <div class="tomosona-asset-actions">
          <button
            v-if="editor.isEditable"
            type="button"
            class="tomosona-asset-edit-btn"
            @mousedown.stop.prevent="toggleEditor($event)"
          >
            {{ showFields ? 'Done' : 'Edit' }}
          </button>
        </div>
      </div>
      <div
        class="tomosona-asset-preview"
        contenteditable="false"
        :class="{ 'is-clickable': Boolean(props.extension?.options?.openPreview) }"
        @mousedown.stop.prevent="openZoomPreview($event)"
      >
        <img
          v-if="previewSrc && !previewFailed"
          class="tomosona-asset-image"
          :src="previewSrc"
          :alt="alt || 'Asset preview'"
          :title="title || alt || undefined"
          @error="previewFailed = true"
        >
        <div v-else class="tomosona-asset-placeholder">
          <span>{{ previewLabel }}</span>
          <span class="tomosona-asset-placeholder-hint">
            {{ src ? (previewLoading ? 'Loading preview...' : 'Preview unavailable') : 'Image path required' }}
          </span>
        </div>
      </div>

      <div v-if="isEditing" class="tomosona-asset-fields">
        <label class="tomosona-asset-field">
          <span class="tomosona-asset-field-label">Src</span>
          <UiFilterableDropdown
            class="tomosona-asset-browser"
            :items="mediaItems"
            :model-value="showMediaBrowser"
            :query="mediaBrowserQuery"
            :active-index="mediaBrowserActiveIndex"
            :matcher="mediaMatcher"
            filter-placeholder="Filter media..."
            :show-filter="true"
            :auto-focus-on-open="true"
            :close-on-select="true"
            menu-mode="portal"
            menu-class="tomosona-asset-browser-menu"
            :disabled="!mediaItems.length"
            :max-height="280"
            @open-change="onMediaBrowserOpenChange"
            @query-change="mediaBrowserQuery = $event"
            @active-index-change="mediaBrowserActiveIndex = $event"
            @select="onMediaBrowserSelect"
          >
            <template #trigger="{ toggleMenu }">
              <div class="tomosona-asset-src-row">
                <input
                  ref="srcInputEl"
                  class="tomosona-asset-input tomosona-asset-src-input"
                  :value="src"
                  :readonly="!editor.isEditable"
                  spellcheck="false"
                  placeholder="Image path"
                  @input="onInput('src', $event)"
                >
                <UiIconButton
                  class-name="tomosona-asset-upload-btn"
                  variant="ghost"
                  size="sm"
                  :disabled="uploadPending || !props.extension?.options?.importAssetFiles"
                  aria-label="Upload files to assets"
                  :title="uploadPending ? 'Uploading...' : 'Upload files to assets'"
                  @mousedown.prevent
                  @click.stop="uploadAssets"
                >
                  <ArrowUpTrayIcon />
                </UiIconButton>
                <UiIconButton
                  class-name="tomosona-asset-src-browser-btn"
                  variant="ghost"
                  size="sm"
                  :disabled="!mediaItems.length"
                  aria-label="Browse media"
                  title="Browse media"
                  @mousedown.prevent
                  @click.stop="toggleMenu"
                >
                  <PhotoIcon />
                </UiIconButton>
              </div>
            </template>
            <template #item="{ item, active }">
              <span class="tomosona-asset-browser-item" :class="{ 'is-active': active }">
                <span class="tomosona-asset-browser-item-label">{{ item.label }}</span>
                <span class="tomosona-asset-browser-item-meta">{{ mediaItemMeta(item) }}</span>
              </span>
            </template>
            <template #empty>
              <span class="tomosona-asset-browser-empty">No media found</span>
            </template>
          </UiFilterableDropdown>
        </label>

        <label class="tomosona-asset-field">
          <span class="tomosona-asset-field-label">Alt</span>
          <input
            class="tomosona-asset-input tomosona-asset-alt-input"
            :value="alt"
            :readonly="!editor.isEditable"
            spellcheck="false"
            placeholder="Alt text"
            @input="onInput('alt', $event)"
          >
        </label>

        <label class="tomosona-asset-field">
          <span class="tomosona-asset-field-label">Title</span>
          <input
            class="tomosona-asset-input tomosona-asset-title-input"
            :value="title"
            :readonly="!editor.isEditable"
            spellcheck="false"
            placeholder="Optional title"
            @input="onInput('title', $event)"
          >
        </label>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-asset-node {
  margin: 0.75rem 0;
}

.tomosona-asset-surface {
  border: 1px solid var(--editor-source-border);
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--editor-overlay-panel) 50%, transparent);
  padding: 0.85rem 0.95rem;
}

.tomosona-asset-header {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}

.tomosona-asset-actions {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  visibility: hidden;
}

.tomosona-asset-preview {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 10rem;
  overflow: hidden;
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--editor-overlay-panel) 30%, transparent);
}

.tomosona-asset-preview.is-clickable {
  cursor: zoom-in;
}

.tomosona-asset-node:hover .tomosona-asset-actions,
.tomosona-asset-node.is-editing .tomosona-asset-actions,
.tomosona-asset-node:focus-within .tomosona-asset-actions {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

.tomosona-asset-image {
  display: block;
  max-width: 100%;
  max-height: 24rem;
  object-fit: contain;
}

.tomosona-asset-placeholder {
  align-items: center;
  color: var(--editor-source-text);
  display: inline-flex;
  flex-direction: column;
  gap: 0.25rem;
  justify-content: center;
  min-height: 10rem;
  padding: 1rem;
  text-align: center;
}

.tomosona-asset-placeholder-hint {
  font-size: 0.8rem;
  opacity: 0.72;
}

.tomosona-asset-fields {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.85rem;
}

.tomosona-asset-field {
  display: grid;
  gap: 0.35rem;
}

.tomosona-asset-field-label {
  color: var(--editor-source-text);
  font-size: 0.78rem;
  font-weight: 600;
}

.tomosona-asset-input {
  width: 100%;
  border: 1px solid var(--editor-source-border);
  border-radius: 0.6rem;
  background: var(--editor-menu-bg);
  color: var(--editor-source-text);
  padding: 0.55rem 0.7rem;
}

.tomosona-asset-src-row {
  align-items: stretch;
  display: flex;
  gap: 0.5rem;
}

.tomosona-asset-src-input {
  flex: 1 1 auto;
  min-width: 0;
}

.tomosona-asset-browser {
  flex: 0 0 auto;
  position: relative;
}

.tomosona-asset-browser :deep(.ui-filterable-dropdown-menu) {
  max-width: min(34rem, calc(100vw - 1.5rem));
}

.tomosona-asset-browser :deep(.ui-filterable-dropdown-option) {
  white-space: normal;
}

.tomosona-asset-browser-item {
  display: grid;
  gap: 0.15rem;
  width: 100%;
}

.tomosona-asset-browser-item.is-active {
  font-weight: 600;
}

.tomosona-asset-browser-item-label {
  color: var(--editor-menu-text);
}

.tomosona-asset-browser-item-meta {
  color: var(--editor-menu-muted);
  font-size: 0.75rem;
}

.tomosona-asset-browser-empty {
  color: var(--editor-menu-muted);
}

.tomosona-asset-input::placeholder {
  color: var(--editor-menu-muted);
}

.tomosona-asset-input:read-only {
  opacity: 0.9;
}

.tomosona-asset-edit-btn,
.tomosona-asset-edit-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
}

.tomosona-asset-edit-btn:hover {
  background: var(--color-bg-hover);
}

.tomosona-asset-node:not(.is-editing) .tomosona-asset-fields {
  max-height: 0;
  min-height: 0;
  margin-top: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
