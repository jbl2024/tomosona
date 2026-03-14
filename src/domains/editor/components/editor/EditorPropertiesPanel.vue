<script setup lang="ts">
import { ChevronRightIcon } from '@heroicons/vue/24/outline'
import { CircleStackIcon } from '@heroicons/vue/24/solid'
import UiButton from '../../../../shared/components/ui/UiButton.vue'
import UiCheckbox from '../../../../shared/components/ui/UiCheckbox.vue'
import UiInput from '../../../../shared/components/ui/UiInput.vue'
import UiSelect from '../../../../shared/components/ui/UiSelect.vue'
import UiTextarea from '../../../../shared/components/ui/UiTextarea.vue'
import type { FrontmatterField } from '../../lib/frontmatter'
import type { PropertyType } from '../../lib/propertyTypes'
import PropertyAddDropdown from '../properties/PropertyAddDropdown.vue'
import PropertyTokenInput from '../properties/PropertyTokenInput.vue'

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
</script>

<template>
  <section
    class="properties-panel"
    :class="{
      'properties-panel--expanded': props.expanded,
      'properties-panel--populated': props.hasProperties,
      'properties-panel--empty': !props.hasProperties
    }"
  >
    <div class="properties-row">
      <button
        type="button"
        class="properties-toggle inline-flex items-center gap-1.5"
        @click="emit('toggle-visibility')"
      >
        <ChevronRightIcon
          class="h-3.5 w-3.5 shrink-0 transition-transform duration-150"
          :class="props.expanded ? 'rotate-90' : 'rotate-0'"
          aria-hidden="true"
        />
        <span class="properties-toggle-label">Properties</span>
        <CircleStackIcon
          v-if="props.hasProperties"
          class="properties-accent-icon h-3 w-3"
          aria-label="Properties available"
        />
      </button>
      <div v-if="props.expanded" class="flex items-center gap-1.5">
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          class-name="properties-mode-btn text-[10px]"
          :active="props.mode === 'structured'"
          :disabled="!props.canUseStructuredProperties"
          @click="emit('set-mode', 'structured')"
        >
          Structured
        </UiButton>
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          class-name="properties-mode-btn text-[10px]"
          :active="props.mode === 'raw'"
          @click="emit('set-mode', 'raw')"
        >
          Raw YAML
        </UiButton>
      </div>
    </div>

    <Transition name="properties-content">
      <div v-if="props.expanded" class="properties-content-wrap">
        <div v-if="props.mode === 'structured'" class="space-y-2">
          <div
            v-for="(field, index) in props.structuredPropertyFields"
            :key="index"
            class="property-row grid grid-cols-[1fr_auto_2fr_auto] items-center gap-2"
          >
            <UiInput
              :model-value="field.key"
              size="sm"
              class-name="properties-field text-xs"
              placeholder="key"
              @update:model-value="emit('property-key-input', { index, value: $event })"
            />
            <UiSelect
              :model-value="props.effectiveTypeForField(field)"
              class-name="properties-field properties-field--muted text-xs"
              :disabled="props.isPropertyTypeLocked(field.key)"
              @update:model-value="emit('property-type-change', { index, value: $event })"
            >
              <option value="text">Text</option>
              <option value="list">List</option>
              <option value="number">Number</option>
              <option value="checkbox">Checkbox</option>
              <option value="date">Date</option>
              <option value="tags">Tags</option>
            </UiSelect>
            <div class="min-w-0">
              <UiInput
                v-if="props.effectiveTypeForField(field) === 'text' || props.effectiveTypeForField(field) === 'date'"
                :model-value="String(field.value ?? '')"
                size="sm"
                class-name="properties-field w-full text-xs"
                :placeholder="props.effectiveTypeForField(field) === 'date' ? 'YYYY-MM-DD' : 'value'"
                @update:model-value="emit('property-value-input', { index, value: $event })"
              />
              <UiInput
                v-else-if="props.effectiveTypeForField(field) === 'number'"
                :model-value="String(field.value ?? 0)"
                size="sm"
                class-name="properties-field w-full text-xs"
                type="number"
                @update:model-value="emit('property-value-input', { index, value: $event })"
              />
              <PropertyTokenInput
                v-else-if="props.effectiveTypeForField(field) === 'list' || props.effectiveTypeForField(field) === 'tags'"
                :model-value="Array.isArray(field.value) ? field.value : []"
                :placeholder="props.effectiveTypeForField(field) === 'tags' ? 'add tag' : 'add value'"
                @update:modelValue="emit('property-tokens-change', { index, tokens: $event })"
              />
              <UiCheckbox
                v-else
                :model-value="Boolean(field.value)"
                class-name="properties-checkbox text-xs"
                @update:model-value="emit('property-checkbox-input', { index, checked: $event })"
              >
                true / false
              </UiCheckbox>
            </div>
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              class-name="properties-remove-btn text-xs"
              @click="emit('remove-property', index)"
            >
              Remove
            </UiButton>
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
          <UiTextarea
            class-name="properties-field properties-textarea font-mono text-xs"
            :model-value="props.activeRawYaml"
            placeholder="title: My note"
            @update:model-value="emit('raw-yaml-input', $event)"
          />
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
  margin: 0 0 0.38rem;
  padding: 0;
  background: transparent;
  transition: opacity 140ms ease;
}

.properties-row {
  min-height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  opacity: 0.4;
  transition: opacity 140ms ease;
}

.properties-panel--empty .properties-row {
  opacity: 0.14;
}

.properties-panel--populated .properties-row {
  opacity: 0.56;
}

.properties-panel:is(:hover, :focus-within) .properties-row,
.properties-panel--expanded .properties-row {
  opacity: 1;
}

.properties-toggle {
  color: color-mix(in srgb, var(--properties-toggle-text) 34%, transparent);
  transition: color 140ms ease;
}

.properties-panel--populated .properties-toggle {
  color: color-mix(in srgb, var(--properties-toggle-text) 54%, transparent);
}

.properties-panel--empty .properties-toggle {
  color: color-mix(in srgb, var(--properties-toggle-text) 22%, transparent);
}

.properties-toggle:hover {
  color: color-mix(in srgb, var(--properties-toggle-text) 76%, transparent);
}

.properties-toggle-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.properties-accent-icon {
  color: var(--properties-accent);
  opacity: 0.65;
}

.properties-panel--populated .properties-accent-icon {
  opacity: 0.82;
}

.properties-field {
  --input-border: var(--properties-field-border);
  --input-bg: var(--properties-field-bg);
  --input-text: var(--properties-field-text);
  --input-placeholder: var(--properties-placeholder);
}

.properties-field--muted,
.properties-checkbox {
  color: var(--properties-field-muted);
}

.properties-mode-btn {
  min-height: 1.65rem;
  line-height: 1.1;
  --button-ghost-text: var(--properties-mode-text);
  --button-active-bg: var(--properties-mode-active-bg);
  --button-active-text: var(--properties-mode-active-text);
  --button-active-border: var(--properties-mode-border);
}

.properties-remove-btn {
  --button-ghost-text: var(--properties-field-muted);
  --button-ghost-hover-text: var(--properties-remove-hover-text);
  --button-active-bg: var(--properties-remove-hover-bg);
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
  margin-top: 0.35rem;
  padding: 0.5rem 0 0 1rem;
  border-left: 2px solid color-mix(in srgb, var(--properties-field-border) 82%, transparent);
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

@media (max-width: 840px) {
  .properties-panel {
    padding: 0;
  }
}
</style>
