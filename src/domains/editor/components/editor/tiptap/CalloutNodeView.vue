<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import {
  BeakerIcon,
  BugAntIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LightBulbIcon,
  QuestionMarkCircleIcon,
  QueueListIcon,
  ShieldExclamationIcon,
  XCircleIcon
} from '@heroicons/vue/24/outline'
import UiFilterableDropdown, { type FilterableDropdownItem } from '../../../../../shared/components/ui/UiFilterableDropdown.vue'
import { CANONICAL_CALLOUT_KINDS, calloutKindLabel, normalizeCalloutKind, type CanonicalCalloutKind } from '../../../lib/callouts'

const props = defineProps<{
  node: { attrs: { kind?: string; message?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: { isEditable: boolean }
}>()

const kind = computed(() => normalizeCalloutKind(props.node.attrs.kind))
const message = computed(() => String(props.node.attrs.message ?? ''))
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const showKindMenu = ref(false)
const kindQuery = ref('')
const activeKindIndex = ref(0)
const iconByKind: Record<CanonicalCalloutKind, Component> = {
  NOTE: DocumentTextIcon,
  ABSTRACT: QueueListIcon,
  INFO: InformationCircleIcon,
  TIP: LightBulbIcon,
  SUCCESS: CheckCircleIcon,
  QUESTION: QuestionMarkCircleIcon,
  WARNING: ExclamationTriangleIcon,
  FAILURE: XCircleIcon,
  DANGER: ShieldExclamationIcon,
  BUG: BugAntIcon,
  EXAMPLE: BeakerIcon,
  QUOTE: ChatBubbleLeftRightIcon
}
const kindItems = computed<Array<FilterableDropdownItem & { value: string; aliases: string[] }>>(() =>
  CANONICAL_CALLOUT_KINDS.map((item) => ({
    id: `callout-kind:${item}`,
    label: calloutKindLabel(item),
    value: item,
    aliases: [item.toLowerCase(), calloutKindLabel(item).toLowerCase()],
    icon: iconByKind[item]
  }))
)
const currentKindIcon = computed(() => iconByKind[kind.value])

function kindMatcher(item: FilterableDropdownItem, query: string): boolean {
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((entry) => String(entry)) : []
  return [String(item.label), ...aliases].some((token) => token.toLowerCase().includes(query))
}

function onKindSelect(item: FilterableDropdownItem) {
  const next = normalizeCalloutKind(String(item.value ?? 'NOTE'))
  props.updateAttributes({ kind: next })
}

function autosizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  if (textarea.scrollHeight <= 0) {
    textarea.style.removeProperty('height')
    return
  }
  textarea.style.height = `${textarea.scrollHeight}px`
}

function scheduleAutosize() {
  void nextTick().then(() => {
    const requestRaf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16)
    requestRaf(() => {
      const textarea = textareaEl.value
      if (!textarea) return
      autosizeTextarea(textarea)
    })
  })
}

function onMessageInput(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  if (textarea) autosizeTextarea(textarea)
  const value = textarea?.value ?? ''
  props.updateAttributes({ message: value })
}

onMounted(() => {
  scheduleAutosize()
})

watch(message, () => {
  scheduleAutosize()
}, { flush: 'post' })
</script>

<template>
  <NodeViewWrapper class="tomosona-callout" :data-callout-kind="kind.toLowerCase()">
    <div class="tomosona-callout-header">
      <UiFilterableDropdown
        v-if="editor.isEditable"
        class="tomosona-callout-kind-select"
        :items="kindItems"
        :model-value="showKindMenu"
        :query="kindQuery"
        :active-index="activeKindIndex"
        :matcher="kindMatcher"
        filter-placeholder="Filter callout kind..."
        :show-filter="true"
        :max-height="220"
        @open-change="showKindMenu = $event"
        @query-change="kindQuery = $event"
        @active-index-change="activeKindIndex = $event"
        @select="onKindSelect($event)"
      >
        <template #trigger="{ toggleMenu }">
          <button
            type="button"
            class="tomosona-callout-title tomosona-callout-title-trigger"
            @mousedown.prevent
            @click.stop="toggleMenu"
          >
            <span class="tomosona-callout-icon">
              <component :is="currentKindIcon" class="tomosona-callout-icon-svg" aria-hidden="true" />
            </span>
            <span class="tomosona-callout-label">{{ calloutKindLabel(kind) }}</span>
          </button>
        </template>
        <template #item="{ item, active }">
          <span class="tomosona-callout-kind-option" :class="{ 'tomosona-callout-kind-active': active, 'tomosona-callout-kind-selected': item.value === kind }">
            <component :is="item.icon" class="tomosona-callout-kind-option-icon" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </span>
        </template>
      </UiFilterableDropdown>
      <div v-else class="tomosona-callout-title">
        <span class="tomosona-callout-icon">
          <component :is="currentKindIcon" class="tomosona-callout-icon-svg" aria-hidden="true" />
        </span>
        <span class="tomosona-callout-label">{{ calloutKindLabel(kind) }}</span>
      </div>
    </div>
    <textarea
      ref="textareaEl"
      class="tomosona-quote-source tomosona-callout-message"
      :value="message"
      :readonly="!editor.isEditable"
      rows="1"
      spellcheck="false"
      placeholder="Callout text"
      @focus="scheduleAutosize"
      @input="onMessageInput"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.tomosona-callout-kind-select {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.tomosona-callout-title-trigger {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  margin: 0;
  padding: 0;
  text-align: left;
}

.tomosona-callout-icon-svg,
.tomosona-callout-kind-option-icon {
  height: 0.9rem;
  width: 0.9rem;
}

.tomosona-callout-kind-option {
  align-items: center;
  display: inline-flex;
  gap: 0.45rem;
}

.tomosona-callout-kind-select :deep(.ui-filterable-dropdown-menu) {
  min-width: 240px;
  max-width: 300px;
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  z-index: 40;
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-menu) {
  background: rgb(15 23 42);
  border-color: rgb(71 85 105);
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-filter) {
  border-bottom-color: rgb(71 85 105);
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-filter-input) {
  background: rgb(15 23 42);
  border-color: rgb(71 85 105);
  color: rgb(226 232 240);
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-filter-input::placeholder) {
  color: rgb(148 163 184);
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-option) {
  color: rgb(226 232 240);
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-option:hover),
.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-option[data-active='true']) {
  background: rgb(30 41 59);
}

.dark .tomosona-callout-kind-select :deep(.ui-filterable-dropdown-empty) {
  color: rgb(148 163 184);
}

.tomosona-callout-kind-active {
  font-weight: 600;
}

.tomosona-callout-kind-selected {
  text-decoration: underline;
}
</style>
