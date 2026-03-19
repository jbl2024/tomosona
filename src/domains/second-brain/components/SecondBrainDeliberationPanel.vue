<script setup lang="ts">
import type { SecondBrainMessage } from '../../../shared/api/apiTypes'
import type { SecondBrainModeSpec } from '../lib/secondBrainModes'
import { renderSecondBrainMarkdownPreview } from '../lib/secondBrainMarkdownPreview'
import SecondBrainModeSelector from './SecondBrainModeSelector.vue'

const props = defineProps<{
  messages: SecondBrainMessage[]
  mode: string
  messageInput: string
  modes: SecondBrainModeSpec[]
  sending: boolean
  sendError: string
  resolveMessageContent: (message: SecondBrainMessage) => string
  citationsByMessageId: Record<string, string[]>
}>()

const emit = defineEmits<{
  'update:mode': [value: string]
  'update:message-input': [value: string]
  send: []
  'append-to-draft': [messageId: string]
  'open-citation': [path: string]
}>()

function renderMarkdown(source: string): string {
  return renderSecondBrainMarkdownPreview(source)
}

function renderAssistantContent(message: SecondBrainMessage): string {
  return renderMarkdown(props.resolveMessageContent(message))
}
</script>

<template>
  <section class="sb-deliberation">
    <div class="sb-controls">
      <SecondBrainModeSelector :modes="modes" :model-value="mode" @update:model-value="emit('update:mode', $event)" />
    </div>

    <div class="sb-thread">
      <article v-for="message in messages" :key="message.id" class="sb-msg" :class="`sb-msg-${message.role}`">
        <header>
          <strong>{{ message.role === 'user' ? 'Vous' : 'IA' }}</strong>
          <button v-if="message.role === 'assistant'" type="button" class="sb-mini-btn" @click="emit('append-to-draft', message.id)">
            Ajouter au brouillon
          </button>
        </header>
        <pre v-if="message.role === 'user'">{{ resolveMessageContent(message) }}</pre>
        <div v-else class="sb-msg-content" v-html="renderAssistantContent(message)"></div>
        <div v-if="message.role === 'assistant'" class="sb-citations">
          <button
            v-for="path in (citationsByMessageId[message.id] || [])"
            :key="`${message.id}-${path}`"
            type="button"
            class="sb-citation"
            @click="emit('open-citation', path)"
          >
            {{ path }}
          </button>
        </div>
      </article>
      <p v-if="!messages.length" class="sb-empty">Demarrez une deliberation.</p>
    </div>

    <div class="sb-input-row">
      <textarea
        :value="messageInput"
        class="sb-textarea"
        placeholder="Posez une question contextualisee..."
        @input="emit('update:message-input', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <button type="button" class="sb-btn" :disabled="sending" @click="emit('send')">
        {{ sending ? 'Envoi...' : 'Envoyer' }}
      </button>
      <p v-if="sendError" class="sb-error">{{ sendError }}</p>
    </div>
  </section>
</template>

<style scoped>
.sb-deliberation {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  min-height: 0;
  height: 100%;
}
.sb-thread {
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-thread-bg);
  color: var(--sb-text);
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sb-msg {
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  padding: 8px;
}
.sb-msg header {
  display: flex;
  justify-content: space-between;
}
.sb-msg pre {
  margin: 6px 0;
  white-space: pre-wrap;
  font-size: 12px;
}
.sb-msg-content {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.5;
}
.sb-msg-content p {
  margin: 0 0 6px;
}
.sb-msg-content p:last-child {
  margin-bottom: 0;
}
.sb-msg-content h1,
.sb-msg-content h2,
.sb-msg-content h3,
.sb-msg-content h4,
.sb-msg-content h5,
.sb-msg-content h6 {
  margin: 8px 0 5px;
  line-height: 1.3;
  font-weight: 700;
}
.sb-msg-content ul,
.sb-msg-content ol {
  margin: 5px 0 6px;
  padding-left: 18px;
}
.sb-msg-content ul {
  list-style: disc outside;
}
.sb-msg-content ol {
  list-style: decimal outside;
}
.sb-msg-content li {
  margin: 1px 0;
}
.sb-msg-content ul ul {
  list-style-type: circle;
}
.sb-msg-content ol ol {
  list-style-type: lower-alpha;
}
.sb-msg-content blockquote {
  margin: 5px 0 6px;
  border-left: 3px solid var(--sb-blockquote-border);
  padding: 2px 0 2px 10px;
  color: var(--sb-text-soft);
}
.sb-msg-content code {
  font-family: var(--font-code);
  background: var(--sb-code-bg);
  border-radius: 4px;
  padding: 1px 4px;
}
.sb-msg-content pre {
  margin: 6px 0;
  background: var(--sb-code-bg);
  border: 1px solid var(--sb-input-border);
  border-radius: 8px;
  padding: 6px;
  overflow: auto;
}
.sb-msg-content pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.sb-msg-content a {
  color: var(--sb-active-text);
  text-decoration: underline;
}
.sb-msg-content table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}
.sb-msg-content th,
.sb-msg-content td {
  border: 1px solid var(--sb-input-border);
  padding: 4px 8px;
}
.sb-msg-content th {
  background: var(--sb-code-bg);
  font-weight: 600;
}
.sb-msg-user {
  background: var(--sb-user-bg);
}
.sb-msg-assistant {
  background: var(--sb-assistant-bg);
}
.sb-citations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sb-citation,
.sb-mini-btn,
.sb-btn {
  border: 1px solid var(--sb-button-border);
  border-radius: 8px;
  background: var(--sb-button-bg);
  color: var(--sb-button-text);
  font-size: 11px;
  padding: 4px 8px;
}
.sb-input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-textarea {
  width: 100%;
  min-height: 88px;
  border: 1px solid var(--sb-input-border);
  border-radius: 10px;
  background: var(--sb-input-bg);
  color: var(--sb-button-text);
  font-size: 12px;
  padding: 8px;
  resize: vertical;
}
.sb-empty {
  margin: 0;
  color: var(--sb-text-dim);
  font-size: 12px;
}
.sb-error {
  margin: 0;
  color: var(--sb-danger-text);
  font-size: 12px;
}
</style>
