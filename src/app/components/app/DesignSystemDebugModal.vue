<script setup lang="ts">
import { computed, ref } from 'vue'
import UiBadge from '../../../shared/components/ui/UiBadge.vue'
import UiButton from '../../../shared/components/ui/UiButton.vue'
import UiCheckbox from '../../../shared/components/ui/UiCheckbox.vue'
import UiField from '../../../shared/components/ui/UiField.vue'
import UiInput from '../../../shared/components/ui/UiInput.vue'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'
import UiModalShell from '../../../shared/components/ui/UiModalShell.vue'
import UiPanel from '../../../shared/components/ui/UiPanel.vue'
import UiSelect from '../../../shared/components/ui/UiSelect.vue'
import UiSeparator from '../../../shared/components/ui/UiSeparator.vue'
import UiTextarea from '../../../shared/components/ui/UiTextarea.vue'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const searchValue = ref('Notes')
const emailValue = ref('hello@tomosona.app')
const notesValue = ref('Organisez vos notes et retrouvez vos idees.')
const selectValue = ref('rewrite')
const checkboxValue = ref(true)
const contentRef = ref<HTMLElement | null>(null)
const sectionIds = [
  'tokens',
  'typography',
  'buttons',
  'forms',
  'badges',
  'cards',
  'alerts',
  'navigation',
  'code'
] as const
type SectionId = typeof sectionIds[number]

function scrollToSection(sectionId: SectionId) {
  const container = contentRef.value
  if (!container) return
  const target = container.querySelector<HTMLElement>(`#${sectionId}`)
  if (!target) return
  const offset = target.offsetTop - 12
  container.scrollTo({
    top: Math.max(0, offset),
    behavior: 'smooth'
  })
}

const tokenSections = [
  {
    title: 'Surfaces',
    tokens: [
      { label: '--app-bg', value: 'var(--app-bg)' },
      { label: '--surface-bg', value: 'var(--surface-bg)' },
      { label: '--surface-muted', value: 'var(--surface-muted)' },
      { label: '--surface-raised', value: 'var(--surface-raised)' },
      { label: '--surface-subtle', value: 'var(--surface-subtle)' }
    ]
  },
  {
    title: 'Text',
    tokens: [
      { label: '--text-main', value: 'var(--text-main)' },
      { label: '--text-soft', value: 'var(--text-soft)' },
      { label: '--text-dim', value: 'var(--text-dim)' },
      { label: '--text-faint', value: 'var(--text-faint)' },
      { label: '--accent', value: 'var(--accent)' }
    ]
  },
  {
    title: 'Status',
    tokens: [
      { label: '--success', value: 'var(--success)' },
      { label: '--warning', value: 'var(--warning)' },
      { label: '--danger', value: 'var(--danger)' },
      { label: '--badge-accent-bg', value: 'var(--badge-accent-bg)' },
      { label: '--button-danger-bg', value: 'var(--button-danger-bg)' }
    ]
  }
] as const

const codeSample = computed(() => [
  '// Note metadata',
  'interface Note {',
  '  title: string',
  '  tags: string[]',
  '}',
  '',
  'const label = (note: Note) => note.title.trim()',
].join('\n'))
</script>

<template>
  <UiModalShell
    :model-value="visible"
    title="Tomosona Design System"
    description="Debug reference for tokens, primitives, patterns, and application surfaces."
    width="xl"
    panel-class="design-system-debug-modal"
    @close="emit('close')"
  >
    <div class="ds-debug-shell">
      <aside class="ds-debug-sidebar">
        <div class="ds-debug-brand">
          <div class="ds-debug-mark">t</div>
          <div>
            <div class="ds-debug-name">Tomosona</div>
            <div class="ds-debug-meta">design system / debug modal</div>
          </div>
        </div>
        <nav class="ds-debug-nav">
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('tokens')">Colors</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('typography')">Typography</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('buttons')">Buttons</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('forms')">Forms</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('badges')">Badges</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('cards')">Cards</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('alerts')">Alerts</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('navigation')">Navigation</button>
          <button type="button" class="ds-debug-nav-link" @click="scrollToSection('code')">Code</button>
        </nav>
      </aside>

      <div ref="contentRef" class="ds-debug-content">
        <section id="tokens" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Colors</h2>
            <span>semantic tokens</span>
          </div>
          <div class="ds-token-section-grid">
            <UiPanel
              v-for="section in tokenSections"
              :key="section.title"
              tone="subtle"
              class-name="ds-token-section"
            >
              <div class="ds-token-section-title">{{ section.title }}</div>
              <div class="ds-token-grid">
                <div
                  v-for="token in section.tokens"
                  :key="token.label"
                  class="ds-token-swatch"
                >
                  <div class="ds-token-color" :style="{ background: token.value }"></div>
                  <div class="ds-token-info">
                    <span class="ds-token-name">{{ token.label }}</span>
                    <span class="ds-token-value">{{ token.value }}</span>
                  </div>
                </div>
              </div>
            </UiPanel>
          </div>
        </section>

        <section id="typography" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Typography</h2>
            <span>serif / sans / mono</span>
          </div>
          <UiPanel class-name="ds-type-panel">
            <div class="ds-type-serif-xl">Tomosona keeps the shell quiet and the writing surface clear.</div>
            <div class="ds-type-serif-lg">Writing should feel focused and comfortable.</div>
            <div class="ds-type-sans-lg">Shared UI should be calm, crisp, and compact.</div>
            <div class="ds-type-sans-md">Organisez vos notes et retrouvez vos idees.</div>
            <div class="ds-type-sans-sm">Secondary copy stays soft and readable inside panels, menus, and settings surfaces.</div>
            <code class="ds-type-mono">const mode = 'rewrite'</code>
          </UiPanel>
        </section>

        <section id="buttons" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Buttons</h2>
            <span>variants and sizes</span>
          </div>
          <UiPanel class-name="ds-row-wrap">
            <div class="ds-row">
              <UiButton variant="primary">Primary</UiButton>
              <UiButton variant="secondary">Secondary</UiButton>
              <UiButton variant="ghost">Ghost</UiButton>
              <UiButton variant="danger">Danger</UiButton>
              <UiButton variant="primary" loading>Loading</UiButton>
            </div>
            <div class="ds-row">
              <UiButton size="sm">Small</UiButton>
              <UiButton size="md">Medium</UiButton>
              <UiButton size="lg">Large</UiButton>
              <UiButton variant="ghost" active>Active</UiButton>
            </div>
          </UiPanel>
        </section>

        <section id="forms" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Forms</h2>
            <span>fields and controls</span>
          </div>
          <div class="ds-form-grid">
            <UiPanel class-name="ds-form-panel">
              <UiField for-id="debug-search" label="Search notes..." help="Find notes by title or content.">
                <template #default="{ describedBy }">
                  <UiInput id="debug-search" :model-value="searchValue" :aria-describedby="describedBy" @update:model-value="searchValue = $event" />
                </template>
              </UiField>
              <UiField for-id="debug-email" label="Notification email" error="Looks valid here; error state shown for contract coverage.">
                <template #default="{ describedBy, invalid }">
                  <UiInput id="debug-email" :model-value="emailValue" :invalid="invalid" :aria-describedby="describedBy" @update:model-value="emailValue = $event" />
                </template>
              </UiField>
              <UiField for-id="debug-select" label="Action">
                <template #default="{ describedBy }">
                  <UiSelect id="debug-select" :model-value="selectValue" :aria-describedby="describedBy" @update:model-value="selectValue = $event">
                    <option value="rewrite">Rewrite</option>
                    <option value="summarize">Summarize</option>
                    <option value="expand">Expand</option>
                  </UiSelect>
                </template>
              </UiField>
              <UiField for-id="debug-notes" label="Prompt notes" help="Textarea uses the shared input surface and focus ring.">
                <template #default="{ describedBy }">
                  <UiTextarea id="debug-notes" :model-value="notesValue" :aria-describedby="describedBy" @update:model-value="notesValue = $event" />
                </template>
              </UiField>
              <UiCheckbox :model-value="checkboxValue" @update:model-value="checkboxValue = $event">Show note preview</UiCheckbox>
            </UiPanel>
            <UiPanel tone="subtle" class-name="ds-form-panel">
              <div class="ds-preview-head">
                <span class="ds-panel-kicker">Preview</span>
                <UiBadge tone="accent">Note</UiBadge>
              </div>
              <p class="ds-preview-copy">The shared field pattern keeps label, help, and error semantics aligned across settings, modals, and editor-side controls.</p>
              <div class="ds-inline-meta">
                <span>Mode: {{ selectValue }}</span>
                <span>Preview: {{ checkboxValue ? 'enabled' : 'disabled' }}</span>
              </div>
            </UiPanel>
          </div>
        </section>

        <section id="badges" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Badges & Status</h2>
            <span>feedback primitives</span>
          </div>
          <UiPanel class-name="ds-row-wrap">
            <div class="ds-row">
              <UiBadge tone="neutral">Default</UiBadge>
              <UiBadge tone="accent">Accent</UiBadge>
              <UiBadge tone="success">Ready</UiBadge>
              <UiBadge tone="warning">Pending</UiBadge>
              <UiBadge tone="danger">Blocked</UiBadge>
            </div>
          </UiPanel>
        </section>

        <section id="cards" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Cards</h2>
            <span>content surfaces</span>
          </div>
          <div class="ds-card-grid">
            <UiPanel class-name="ds-card">
              <div class="ds-card-header">
                <div>
                  <div class="ds-card-title">Editorial roadmap</div>
                  <div class="ds-card-subtitle">notes/product/editor.md</div>
                </div>
                <UiBadge tone="accent">Draft</UiBadge>
              </div>
              <p class="ds-card-copy">Revoir la hierarchie de la home et ameliorer la navigation entre les notes.</p>
              <div class="ds-card-footer">
                <span>Updated 2h ago</span>
                <UiButton size="sm" variant="ghost">Open note</UiButton>
              </div>
            </UiPanel>
            <UiPanel tone="subtle" class-name="ds-card ds-stat-card">
              <div class="ds-stat-value">24</div>
              <div class="ds-stat-label">Active notes</div>
              <div class="ds-stat-delta">+12% this week</div>
            </UiPanel>
          </div>
        </section>

        <section id="alerts" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Alerts & Feedback</h2>
            <span>status messages</span>
          </div>
          <div class="ds-alert-grid">
            <UiPanel tone="subtle" class-name="ds-alert ds-alert-info">
              <div class="ds-alert-title">Index rebuild in progress</div>
              <div class="ds-alert-copy">Indexing new notes. Results remain available while the queue drains.</div>
            </UiPanel>
            <UiPanel tone="subtle" class-name="ds-alert ds-alert-warning">
              <div class="ds-alert-title">Workspace needs review</div>
              <div class="ds-alert-copy">The selected folder is unavailable. Choose an accessible workspace.</div>
            </UiPanel>
          </div>
        </section>

        <section id="navigation" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Navigation</h2>
            <span>tabs and menus</span>
          </div>
          <div class="ds-panel-grid">
            <UiPanel class-name="ds-nav-panel">
              <div class="ds-tab-row">
                <button type="button" class="ds-tab ds-tab--active">Editor</button>
                <button type="button" class="ds-tab">Second Brain</button>
              </div>
              <div class="ds-card-copy">Tabs should read as shell chrome, not as giant primary actions.</div>
            </UiPanel>
            <UiMenu class-name="ds-menu-demo">
              <UiMenuList>
                <button type="button" class="ui-menu-item">Command palette</button>
                <button type="button" class="ui-menu-item" data-active="true">Theme / Dark</button>
                <button type="button" class="ui-menu-item">Settings</button>
              </UiMenuList>
              <UiSeparator />
              <UiMenuList>
                <button type="button" class="ui-menu-item">Close workspace</button>
              </UiMenuList>
            </UiMenu>
          </div>
        </section>

        <section id="code" class="ds-debug-section">
          <div class="ds-debug-section-label">
            <h2>Code</h2>
            <span>editor language</span>
          </div>
          <UiPanel tone="subtle" class-name="ds-code-panel">
            <pre>{{ codeSample }}</pre>
          </UiPanel>
        </section>
      </div>
    </div>
    <template #footer>
      <UiButton size="sm" variant="ghost" @click="emit('close')">Close</UiButton>
    </template>
  </UiModalShell>
</template>

<style scoped>
.design-system-debug-modal {
  max-width: min(1180px, calc(100vw - 2rem));
  max-height: min(88vh, 980px);
}

.ds-debug-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 1.25rem;
  min-height: 0;
  height: min(72vh, 820px);
}

.ds-debug-sidebar {
  position: sticky;
  top: 0;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.25rem 0;
}

.ds-debug-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ds-debug-mark {
  width: 2rem;
  height: 2rem;
  border-radius: 0.6rem;
  background: var(--accent);
  color: var(--accent-contrast);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-code);
  font-weight: 700;
}

.ds-debug-name {
  font-family: var(--font-serif);
  font-size: 1.25rem;
  color: var(--text-main);
}

.ds-debug-meta,
.ds-token-value,
.ds-card-subtitle,
.ds-stat-label {
  font-family: var(--font-code);
  font-size: 0.72rem;
  color: var(--text-dim);
}

.ds-debug-nav {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.ds-debug-nav-link {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0.45rem 0.65rem;
  border-radius: 0.65rem;
  color: var(--text-soft);
  font-size: 0.82rem;
  cursor: pointer;
}

.ds-debug-nav-link:hover {
  background: var(--surface-muted);
  color: var(--text-main);
}

.ds-debug-content {
  display: flex;
  flex-direction: column;
  gap: 3.4rem;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 0.25rem;
  scroll-behavior: smooth;
}

.ds-debug-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.ds-debug-section-label {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding-bottom: 0.9rem;
  border-bottom: 1px solid var(--border-subtle);
}

.ds-debug-section-label h2 {
  font-family: var(--font-serif);
  font-size: 1.55rem;
  font-weight: 400;
  color: var(--text-main);
}

.ds-debug-section-label span,
.ds-token-name,
.ds-panel-kicker {
  font-family: var(--font-code);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.ds-token-section-grid,
.ds-form-grid,
.ds-card-grid,
.ds-panel-grid,
.ds-alert-grid {
  display: grid;
  gap: 1rem;
}

.ds-token-section-grid,
.ds-card-grid,
.ds-panel-grid,
.ds-alert-grid {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.ds-token-section {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.ds-token-section-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main);
}

.ds-token-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 0.65rem;
}

.ds-token-swatch {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 0.85rem;
  background: var(--surface-bg);
}

.ds-token-color {
  height: 3rem;
}

.ds-token-info {
  padding: 0.65rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.ds-token-name {
  color: var(--text-soft);
}

.ds-type-panel,
.ds-row-wrap,
.ds-form-panel,
.ds-nav-panel,
.ds-code-panel {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.ds-type-serif-xl {
  font-family: var(--font-serif);
  font-size: 2.35rem;
  line-height: 1.14;
  letter-spacing: -0.03em;
  color: var(--text-main);
}

.ds-type-serif-lg {
  font-family: var(--font-serif);
  font-size: 1.55rem;
  line-height: 1.24;
  color: var(--text-main);
}

.ds-type-sans-lg {
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text-main);
}

.ds-type-sans-md {
  font-size: 0.95rem;
  color: var(--text-main);
}

.ds-type-sans-sm {
  font-size: 0.82rem;
  color: var(--text-soft);
}

.ds-type-mono {
  width: fit-content;
  padding: 0.2rem 0.5rem;
  border-radius: 0.45rem;
  background: var(--badge-accent-bg);
  color: var(--badge-accent-text);
  font-family: var(--font-code);
  font-size: 0.82rem;
}

.ds-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.ds-form-grid {
  grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.7fr);
}

.ds-preview-head,
.ds-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.ds-preview-copy,
.ds-card-copy,
.ds-alert-copy {
  color: var(--text-soft);
  line-height: 1.65;
  font-size: 0.9rem;
}

.ds-inline-meta,
.ds-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--text-dim);
  font-size: 0.78rem;
}

.ds-card,
.ds-stat-card,
.ds-alert {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.ds-card-title,
.ds-alert-title {
  font-family: var(--font-serif);
  font-size: 1.1rem;
  color: var(--text-main);
}

.ds-stat-value {
  font-family: var(--font-serif);
  font-size: 2.4rem;
  line-height: 1;
  color: var(--text-main);
}

.ds-stat-delta {
  color: var(--success);
  font-size: 0.84rem;
  font-weight: 600;
}

.ds-alert-info {
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border-subtle));
}

.ds-alert-warning {
  border-color: color-mix(in srgb, var(--warning) 30%, var(--border-subtle));
}

.ds-tab-row {
  display: flex;
  gap: 0.45rem;
}

.ds-tab {
  border: 1px solid var(--tab-border);
  border-radius: 0.75rem;
  background: var(--tab-bg);
  color: var(--tab-text);
  padding: 0.5rem 0.8rem;
  font-size: 0.82rem;
}

.ds-tab--active {
  background: var(--tab-active-bg);
  color: var(--tab-active-text);
  border-color: var(--tab-active-border);
}

.ds-menu-demo {
  width: min(320px, 100%);
}

.ds-code-panel pre {
  margin: 0;
  overflow: auto;
  padding: 0.25rem;
  color: var(--text-main);
  font-family: var(--font-code);
  font-size: 0.8rem;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .ds-debug-shell {
    grid-template-columns: 1fr;
  }

  .ds-debug-sidebar {
    position: static;
  }

  .ds-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
