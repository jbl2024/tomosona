<script setup lang="ts">
import { computed, ref } from 'vue'
import { EDITOR_EMOJI_GROUPS, editorEmojiMatchesQuery } from '../../lib/editorEmojis'

/** Portable Unicode emoji picker displayed after selecting the `@` Emojis macro. */
const props = defineProps<{
  open: boolean
  left: number
  top: number
}>()

const emit = defineEmits<{
  select: [emoji: string]
  close: []
}>()

const query = ref('')
const visibleGroups = computed(() => {
  const needle = query.value.trim()
  if (!needle) return EDITOR_EMOJI_GROUPS
  return EDITOR_EMOJI_GROUPS
    .map((group) => ({ ...group, emojis: group.emojis.filter((emoji) => editorEmojiMatchesQuery(emoji, needle)) }))
    .filter((group) => group.emojis.length)
})

function selectEmoji(emoji: string) {
  emit('select', emoji)
  query.value = ''
}
</script>

<template>
  <Teleport to="body">
    <section
      v-if="props.open"
      class="editor-emoji-picker"
      :style="{ left: `${props.left}px`, top: `${props.top}px` }"
      aria-label="Emoji picker"
      @keydown.esc.prevent.stop="emit('close')"
    >
      <header class="editor-emoji-picker__header">
        <strong>Emojis</strong>
        <button type="button" class="editor-emoji-picker__close" aria-label="Close emoji picker" @click="emit('close')">×</button>
      </header>
      <input v-model="query" class="editor-emoji-picker__search" type="search" placeholder="Filter emojis" aria-label="Filter emojis">
      <div class="editor-emoji-picker__groups">
        <section v-for="group in visibleGroups" :key="group.label" class="editor-emoji-picker__group">
          <h3>{{ group.label }}</h3>
          <div class="editor-emoji-picker__grid">
            <button
              v-for="emoji in group.emojis"
              :key="emoji"
              type="button"
              class="editor-emoji-picker__emoji"
              :aria-label="`Insert ${emoji}`"
              @click="selectEmoji(emoji)"
            >{{ emoji }}</button>
          </div>
        </section>
        <p v-if="!visibleGroups.length" class="editor-emoji-picker__empty">No matching emoji.</p>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.editor-emoji-picker { background: var(--editor-menu-bg); border: 1px solid var(--editor-menu-border); border-radius: 0.5rem; box-shadow: 0 12px 28px rgb(15 23 42 / 0.24); color: var(--editor-menu-text); max-height: min(31rem, calc(100vh - 2rem)); overflow: hidden; position: fixed; width: min(25rem, calc(100vw - 1.5rem)); z-index: 50; }
.editor-emoji-picker__header { align-items: center; border-bottom: 1px solid var(--editor-menu-border); display: flex; justify-content: space-between; padding: 0.625rem 0.75rem; }
.editor-emoji-picker__close { background: transparent; border: 0; color: var(--editor-menu-muted); cursor: pointer; font-size: 1.25rem; line-height: 1; }
.editor-emoji-picker__search { background: var(--editor-menu-bg); border: 0; border-bottom: 1px solid var(--editor-menu-border); box-sizing: border-box; color: var(--editor-menu-text); outline: none; padding: 0.625rem 0.75rem; width: 100%; }
.editor-emoji-picker__groups { max-height: min(24rem, calc(100vh - 8rem)); overflow-y: auto; padding: 0.625rem 0.75rem; }
.editor-emoji-picker__group + .editor-emoji-picker__group { margin-top: 0.75rem; }
.editor-emoji-picker__group h3 { color: var(--editor-menu-muted); font-size: 0.6875rem; font-weight: 600; margin: 0 0 0.3125rem; text-transform: uppercase; }
.editor-emoji-picker__grid { display: grid; gap: 0.125rem; grid-template-columns: repeat(12, minmax(0, 1fr)); }
.editor-emoji-picker__emoji { background: transparent; border: 0; border-radius: 0.3125rem; cursor: pointer; font-family: inherit; font-size: 1.25rem; line-height: 1; padding: 0.3125rem; }
.editor-emoji-picker__emoji:hover, .editor-emoji-picker__emoji:focus-visible { background: var(--editor-menu-hover-bg); outline: none; }
.editor-emoji-picker__empty { color: var(--editor-menu-muted); margin: 0.5rem 0; }
</style>
