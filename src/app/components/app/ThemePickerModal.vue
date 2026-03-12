<script setup lang="ts">
import type { AppThemeDefinition, ThemeColorScheme, ThemeId } from '../../../shared/lib/themeRegistry'
import type { ThemePreference } from '../../composables/useAppTheme'

type ThemePickerItem =
  | {
      kind: 'system'
      id: 'system'
      label: string
      meta: string
      previewThemeIds: ThemeId[]
    }
  | {
      kind: 'theme'
      id: ThemeId
      label: string
      meta: string
      colorScheme: ThemeColorScheme
      group: AppThemeDefinition['group']
    }

defineProps<{
  visible: boolean
  query: string
  items: ThemePickerItem[]
  activeIndex: number
  selectedPreference: ThemePreference
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  select: [value: ThemePreference]
  preview: [value: ThemePreference]
  keydown: [event: KeyboardEvent]
  'set-active-index': [index: number]
}>()

function itemSwatches(item: ThemePickerItem): string[] {
  if (item.kind === 'system') {
    return item.previewThemeIds
  }
  return [item.id]
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal theme-picker"
      data-modal="theme-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-picker-title"
      aria-describedby="theme-picker-description"
      tabindex="-1"
    >
      <h3 id="theme-picker-title" class="sr-only">Theme picker</h3>
      <p id="theme-picker-description" class="sr-only">Filter themes, then press Enter to apply the active theme.</p>
      <input
        :value="query"
        data-theme-picker-input="true"
        class="tool-input"
        placeholder="Search themes"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        @keydown="emit('keydown', $event)"
      />
      <div class="modal-list">
        <button
          v-for="(item, index) in items"
          :key="item.id"
          type="button"
          class="modal-item theme-picker-item"
          :class="{ active: activeIndex === index }"
          :data-selected="selectedPreference === item.id"
          @click="emit('select', item.id)"
          @mouseenter="emit('preview', item.id)"
          @mousemove="emit('set-active-index', index)"
        >
          <span class="theme-picker-item-main">
            <span class="theme-picker-item-copy">
              <span class="theme-picker-item-label">{{ item.label }}</span>
              <span class="theme-picker-item-meta">{{ item.meta }}</span>
            </span>
            <span class="theme-picker-swatches" aria-hidden="true">
              <span
                v-for="themeId in itemSwatches(item)"
                :key="themeId"
                class="theme-picker-swatch"
                :data-theme-preview="themeId"
              ></span>
            </span>
          </span>
        </button>
        <div v-if="!items.length" class="placeholder">No matching themes</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-picker {
  border-color: var(--command-palette-border);
  background: var(--command-palette-bg);
}

.modal-list {
  margin-top: 8px;
  max-height: 420px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.theme-picker-item {
  width: 100%;
  border: 1px solid var(--command-palette-item-border);
  background: var(--command-palette-item-bg);
  color: var(--command-palette-item-text);
  border-radius: 10px;
  padding: 12px 16px;
  text-align: left;
}

.theme-picker-item.active {
  border-color: var(--command-palette-item-active-border);
  background: var(--command-palette-item-active-bg);
  color: var(--command-palette-item-active-text);
}

.theme-picker-item[data-selected='true'] {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--command-palette-item-border));
}

.theme-picker-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  width: 100%;
}

.theme-picker-item-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding-left: 2px;
}

.theme-picker-item-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  color: currentColor;
}

.theme-picker-item-meta {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-dim);
}

.theme-picker-swatches {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding-right: 2px;
}

.theme-picker-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 74%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
  background: linear-gradient(135deg, var(--swatch-surface) 0%, var(--swatch-accent) 100%);
}

.theme-picker-swatch[data-theme-preview='tomosona-light'] {
  --swatch-surface: #f6f5f2;
  --swatch-accent: #1e3a5f;
}

.theme-picker-swatch[data-theme-preview='tomosona-dark'] {
  --swatch-surface: #282c34;
  --swatch-accent: #61afef;
}

.theme-picker-swatch[data-theme-preview='acier-sable-rose'] {
  --swatch-surface: #bfae9d;
  --swatch-accent: #c88758;
}

.theme-picker-swatch[data-theme-preview='harbor-light'] {
  --swatch-surface: #d9e4f2;
  --swatch-accent: #16324f;
}

.theme-picker-swatch[data-theme-preview='midnight-rail'] {
  --swatch-surface: #f6f7f9;
  --swatch-accent: #17344f;
}

.theme-picker-swatch[data-theme-preview='github-light'] {
  --swatch-surface: #f6f8fa;
  --swatch-accent: #0969da;
}

.theme-picker-swatch[data-theme-preview='tokyo-night'] {
  --swatch-surface: #1a1b26;
  --swatch-accent: #7aa2f7;
}

.theme-picker-swatch[data-theme-preview='catppuccin-latte'] {
  --swatch-surface: #eff1f5;
  --swatch-accent: #7287fd;
}

.theme-picker-swatch[data-theme-preview='catppuccin-mocha'] {
  --swatch-surface: #11111b;
  --swatch-accent: #89b4fa;
}
</style>
