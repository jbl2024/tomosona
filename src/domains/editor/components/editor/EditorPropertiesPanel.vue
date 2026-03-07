<script setup lang="ts">
import { ChevronRightIcon } from '@heroicons/vue/24/outline'
import { CircleStackIcon } from '@heroicons/vue/24/solid'
import type { FrontmatterField } from '../../lib/frontmatter'
import type { PropertyType } from '../../lib/propertyTypes'
import PropertyAddDropdown from '../../../explorer/components/PropertyAddDropdown.vue'
import PropertyTokenInput from '../../../explorer/components/PropertyTokenInput.vue'

type CorePropertyOption = {
  key: string
  label?: string
  description?: string
}

const props = defineProps<{
  expanded: boolean
  hasProperties: boolean
  mode: 'structured' | 'raw'
  canUseStructuredProperties: boolean
  structuredPropertyFields: FrontmatterField[]
  structuredPropertyKeys: string[]
  activeRawYaml: string
  activeParseErrors: Array<{ line: number; message: string }>
  corePropertyOptions: CorePropertyOption[]
  effectiveTypeForField: (field: FrontmatterField) => PropertyType
  isPropertyTypeLocked: (key: string) => boolean
}>()

const emit = defineEmits<{
  'toggle-visibility': []
  'set-mode': [mode: 'structured' | 'raw']
  'property-key-input': [payload: { index: number; value: string }]
  'property-type-change': [payload: { index: number; value: string }]
  'property-value-input': [payload: { index: number; value: string }]
  'property-checkbox-input': [payload: { index: number; checked: boolean }]
  'property-tokens-change': [payload: { index: number; tokens: string[] }]
  'remove-property': [index: number]
  'add-property': [key: string]
  'raw-yaml-input': [value: string]
}>()

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? ''
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement | null)?.value ?? ''
}

function checkboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement | null)?.checked ?? false
}
</script>

<template>
  <section
    class="properties-panel mx-6 mb-2 mt-3 rounded-lg px-4 py-2.5"
  >
    <div class="flex min-h-6 items-center justify-between gap-3">
      <button
        type="button"
        class="properties-toggle inline-flex items-center gap-2 text-sm font-semibold"
        @click="emit('toggle-visibility')"
      >
        <ChevronRightIcon
          class="h-4 w-4 shrink-0 transition-transform duration-150"
          :class="props.expanded ? 'rotate-90' : 'rotate-0'"
          aria-hidden="true"
        />
        <span>Properties</span>
        <CircleStackIcon
          v-if="props.hasProperties"
          class="properties-accent-icon h-3.5 w-3.5"
          aria-label="Properties available"
        />
      </button>
      <div v-if="props.expanded" class="flex items-center gap-1.5">
        <button
          type="button"
          class="properties-mode-btn rounded border px-2 py-0.5 text-[11px]"
          :class="props.mode === 'structured' ? 'properties-mode-btn--active' : ''"
          :disabled="!props.canUseStructuredProperties"
          @click="emit('set-mode', 'structured')"
        >
          Structured
        </button>
        <button
          type="button"
          class="properties-mode-btn rounded border px-2 py-0.5 text-[11px]"
          :class="props.mode === 'raw' ? 'properties-mode-btn--active' : ''"
          @click="emit('set-mode', 'raw')"
        >
          Raw YAML
        </button>
      </div>
    </div>

    <Transition name="properties-content">
      <div v-if="props.expanded" class="mt-2 properties-content-wrap">
        <div v-if="props.mode === 'structured'" class="space-y-2">
          <div
            v-for="(field, index) in props.structuredPropertyFields"
            :key="index"
            class="property-row grid grid-cols-[1fr_auto_2fr_auto] items-center gap-2"
          >
            <input
              :value="field.key"
              class="properties-field rounded border px-2 py-1 text-xs"
              placeholder="key"
              @input="emit('property-key-input', { index, value: inputValue($event) })"
            />
            <select
              :value="props.effectiveTypeForField(field)"
              class="properties-field properties-field--muted rounded border px-2 py-1 text-xs"
              :disabled="props.isPropertyTypeLocked(field.key)"
              @change="emit('property-type-change', { index, value: selectValue($event) })"
            >
              <option value="text">Text</option>
              <option value="list">List</option>
              <option value="number">Number</option>
              <option value="checkbox">Checkbox</option>
              <option value="date">Date</option>
              <option value="tags">Tags</option>
            </select>
            <div class="min-w-0">
              <input
                v-if="props.effectiveTypeForField(field) === 'text' || props.effectiveTypeForField(field) === 'date'"
                :value="String(field.value ?? '')"
                class="properties-field w-full rounded border px-2 py-1 text-xs"
                :placeholder="props.effectiveTypeForField(field) === 'date' ? 'YYYY-MM-DD' : 'value'"
                @input="emit('property-value-input', { index, value: inputValue($event) })"
              />
              <input
                v-else-if="props.effectiveTypeForField(field) === 'number'"
                :value="String(field.value ?? 0)"
                class="properties-field w-full rounded border px-2 py-1 text-xs"
                type="number"
                @input="emit('property-value-input', { index, value: inputValue($event) })"
              />
              <PropertyTokenInput
                v-else-if="props.effectiveTypeForField(field) === 'list' || props.effectiveTypeForField(field) === 'tags'"
                :model-value="Array.isArray(field.value) ? field.value : []"
                :placeholder="props.effectiveTypeForField(field) === 'tags' ? 'add tag' : 'add value'"
                @update:modelValue="emit('property-tokens-change', { index, tokens: $event })"
              />
              <label v-else class="properties-checkbox inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  :checked="Boolean(field.value)"
                  @change="emit('property-checkbox-input', { index, checked: checkboxValue($event) })"
                />
                true / false
              </label>
            </div>
            <button
              type="button"
              class="properties-remove-btn rounded border px-2 py-1 text-xs"
              @click="emit('remove-property', index)"
            >
              Remove
            </button>
          </div>

          <div class="flex items-center gap-2">
            <PropertyAddDropdown
              :options="props.corePropertyOptions"
              :existing-keys="props.structuredPropertyKeys"
              @select="emit('add-property', $event)"
            />
          </div>
        </div>

        <div v-else>
          <textarea
            class="properties-field properties-textarea font-mono min-h-28 w-full rounded border p-2 text-xs"
            :value="props.activeRawYaml"
            placeholder="title: My note"
            @input="emit('raw-yaml-input', inputValue($event))"
          ></textarea>
        </div>

        <div v-if="props.activeParseErrors.length" class="properties-errors mt-2 text-xs">
          <div v-for="(error, index) in props.activeParseErrors" :key="`${error.line}-${index}`">
            Line {{ error.line }}: {{ error.message }}
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.properties-panel {
  background: var(--properties-panel-bg);
}

.properties-toggle {
  color: var(--properties-toggle-text);
}

.properties-accent-icon {
  color: var(--properties-accent);
}

.properties-mode-btn {
  border-color: var(--properties-mode-border);
  color: var(--properties-mode-text);
}

.properties-mode-btn--active {
  background: var(--properties-mode-active-bg);
  color: var(--properties-mode-active-text);
}

.properties-field {
  border-color: var(--properties-field-border);
  background: var(--properties-field-bg);
  color: var(--properties-field-text);
}

.properties-field--muted,
.properties-checkbox {
  color: var(--properties-field-muted);
}

.properties-field::placeholder,
.properties-textarea::placeholder {
  color: var(--properties-placeholder);
}

.properties-remove-btn {
  border-color: var(--properties-field-border);
  background: var(--properties-field-bg);
  color: var(--properties-field-muted);
}

.properties-remove-btn:hover {
  background: var(--properties-remove-hover-bg);
  color: var(--properties-remove-hover-text);
}

.properties-errors {
  color: var(--danger);
}

.property-row :is(input, select, textarea):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.properties-content-wrap {
  overflow: hidden;
}

.properties-content-enter-active,
.properties-content-leave-active {
  transition: opacity 180ms ease, transform 180ms ease, max-height 220ms ease;
}

.properties-content-enter-from,
.properties-content-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
}

.properties-content-enter-to,
.properties-content-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 820px;
}

@media (prefers-reduced-motion: reduce) {
  .properties-content-enter-active,
  .properties-content-leave-active {
    transition: none;
  }
}
</style>
