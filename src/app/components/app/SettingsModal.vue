<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppThemeDefinition } from '../../../shared/lib/themeRegistry'
import type { ThemePreference } from '../../composables/useAppTheme'
import type { TerminalPreferences } from '../../composables/useAppTerminalPreferences'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import UiModalShell from '../../../shared/components/ui/UiModalShell.vue'
import UiSelect from '../../../shared/components/ui/UiSelect.vue'

/** Presents app-wide preferences; persistence remains owned by the shell. */
const props = defineProps<{
  visible: boolean
  themePreference: ThemePreference
  availableThemes: readonly AppThemeDefinition[]
  terminalPreferences: TerminalPreferences
}>()

const emit = defineEmits<{
  close: []
  'set-theme': [value: ThemePreference]
  'update-terminal-preferences': [value: Partial<TerminalPreferences>]
  'reset-terminal-preferences': []
}>()

const activeSection = ref<'appearance' | 'terminal'>('appearance')
const themeOptions = computed(() => [
  { value: 'system', label: 'System' },
  ...props.availableThemes.map((theme) => ({ value: theme.id, label: theme.label }))
])

function updateNumber(key: 'fontSize' | 'lineHeight' | 'letterSpacing' | 'scrollback', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) emit('update-terminal-preferences', { [key]: value })
}

function onVisibilityChange(value: boolean) {
  if (!value) emit('close')
}
</script>

<template>
  <UiModalShell
    :model-value="visible"
    title="Settings"
    description="Customize Tomosona for the way you work."
    hide-header
    labelledby="settings-title"
    describedby="settings-description"
    width="lg"
    panel-class="settings-modal"
    @update:model-value="onVisibilityChange"
    @close="emit('close')"
  >
    <div data-modal="settings" class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">
        <button type="button" :class="{ active: activeSection === 'appearance' }" @click="activeSection = 'appearance'">Appearance</button>
        <button type="button" :class="{ active: activeSection === 'terminal' }" @click="activeSection = 'terminal'">Terminal</button>
      </nav>

      <section v-if="activeSection === 'appearance'" class="settings-content" aria-labelledby="settings-appearance-title">
        <h4 id="settings-appearance-title">Appearance</h4>
        <p>Choose the color theme used throughout Tomosona.</p>
        <UiField for-id="settings-theme" label="Theme" help="The System option follows your operating system preference.">
          <UiSelect id="settings-theme" :model-value="themePreference" @update:model-value="emit('set-theme', $event as ThemePreference)">
            <option v-for="option in themeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </UiSelect>
        </UiField>
      </section>

      <section v-else class="settings-content" aria-labelledby="settings-terminal-title">
        <div class="settings-section-heading">
          <div>
            <h4 id="settings-terminal-title">Terminal</h4>
            <p>Changes apply immediately to every open terminal.</p>
          </div>
          <UiButton size="sm" variant="ghost" @click="emit('reset-terminal-preferences')">Reset</UiButton>
        </div>
        <div class="settings-fields">
          <UiField for-id="terminal-font-family" label="Font family">
            <UiInput id="terminal-font-family" :model-value="terminalPreferences.fontFamily" placeholder="SF Mono" @update:model-value="emit('update-terminal-preferences', { fontFamily: $event })" />
          </UiField>
          <UiField for-id="terminal-font-size" label="Font size" :help="`${terminalPreferences.fontSize}px`">
            <input id="terminal-font-size" class="settings-range" type="range" min="8" max="32" step="1" :value="terminalPreferences.fontSize" @input="updateNumber('fontSize', $event)" />
          </UiField>
          <UiField for-id="terminal-line-height" label="Line height" :help="terminalPreferences.lineHeight.toFixed(1)">
            <input id="terminal-line-height" class="settings-range" type="range" min="1" max="2" step="0.1" :value="terminalPreferences.lineHeight" @input="updateNumber('lineHeight', $event)" />
          </UiField>
          <UiField for-id="terminal-letter-spacing" label="Letter spacing" :help="`${terminalPreferences.letterSpacing}px`">
            <input id="terminal-letter-spacing" class="settings-range" type="range" min="-2" max="5" step="0.1" :value="terminalPreferences.letterSpacing" @input="updateNumber('letterSpacing', $event)" />
          </UiField>
          <UiField for-id="terminal-cursor-style" label="Cursor style">
            <UiSelect id="terminal-cursor-style" :model-value="terminalPreferences.cursorStyle" @update:model-value="emit('update-terminal-preferences', { cursorStyle: $event as TerminalPreferences['cursorStyle'] })">
              <option value="block">Block</option><option value="bar">Bar</option><option value="underline">Underline</option>
            </UiSelect>
          </UiField>
          <UiField for-id="terminal-scrollback" label="Scrollback" help="Lines kept when you scroll up.">
            <input id="terminal-scrollback" class="tool-input" type="number" min="100" max="100000" step="100" :value="terminalPreferences.scrollback" @change="updateNumber('scrollback', $event)" />
          </UiField>
          <label class="settings-toggle" for="terminal-cursor-blink">
            <input id="terminal-cursor-blink" type="checkbox" :checked="terminalPreferences.cursorBlink" @change="emit('update-terminal-preferences', { cursorBlink: ($event.target as HTMLInputElement).checked })" />
            <span><strong>Blinking cursor</strong><small>Animate the terminal cursor.</small></span>
          </label>
        </div>
      </section>
    </div>
    <template #footer><UiButton size="sm" variant="ghost" @click="emit('close')">Close</UiButton></template>
  </UiModalShell>
</template>

<style scoped>
:global(.ui-modal-shell__panel--lg.settings-modal) { height: min(700px, calc(100vh - 96px)); min-height: min(700px, calc(100vh - 96px)); }
.settings-modal :deep(.ui-modal-shell__body) { padding: 0; overflow: hidden; }
.settings-layout { display: grid; grid-template-columns: 11rem minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
.settings-nav { display: flex; flex-direction: column; gap: .45rem; padding: .75rem; border-right: 1px solid var(--modal-panel-border); background: color-mix(in srgb, var(--modal-bg) 88%, var(--panel-bg)); }
.settings-nav button { display: block; width: 100%; border: 0; border-radius: .45rem; padding: .55rem .65rem; background: transparent; color: var(--modal-copy); text-align: left; font: inherit; font-size: .88rem; cursor: pointer; }
.settings-nav button:hover, .settings-nav button.active { background: var(--command-palette-item-active-bg); color: var(--command-palette-item-active-text); }
.settings-content { min-width: 0; overflow: auto; padding: 1.25rem 1.5rem 1.5rem; }
.settings-content h4 { margin: 0; font-size: 1rem; }.settings-content > p, .settings-section-heading p { margin: .35rem 0 1.25rem; color: var(--modal-copy); font-size: .86rem; }
.settings-section-heading { display: flex; justify-content: space-between; gap: 1rem; }.settings-section-heading p { margin-bottom: 1.25rem; }
.settings-fields { display: grid; gap: 1rem; }.settings-range { width: 100%; accent-color: var(--accent); }.settings-toggle { display: flex; align-items: flex-start; gap: .65rem; padding: .8rem; border: 1px solid var(--modal-panel-border); border-radius: .55rem; cursor: pointer; }.settings-toggle input { margin-top: .2rem; accent-color: var(--accent); }.settings-toggle span { display: grid; gap: .15rem; }.settings-toggle small { color: var(--modal-copy); }
@media (max-width: 640px) { .settings-layout { grid-template-columns: 1fr; }.settings-nav { flex-direction: row; gap: .35rem; border-right: 0; border-bottom: 1px solid var(--modal-panel-border); }.settings-nav button { width: auto; }.settings-content { padding: 1rem; } }
</style>
