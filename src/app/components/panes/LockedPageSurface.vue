<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { LockClosedIcon } from '@heroicons/vue/24/outline'
import UiButton from '../../../shared/components/ui/UiButton.vue'

const props = defineProps<{ path: string; error: string; pending: boolean; active: boolean }>()
const emit = defineEmits<{ submit: [password: string] }>()
const inputId = useId()
const password = ref('')
const visible = ref(false)
const capsLock = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)
const noteName = computed(() => (props.path.replace(/\\/g, '/').split('/').pop() || '').replace(/\.(md|markdown)$/i, ''))

async function focusInput(select = false) {
  await nextTick()
  if (!props.active || props.pending) return
  passwordInput.value?.focus()
  if (select) passwordInput.value?.select()
}

onMounted(() => { if (props.active) void focusInput() })
watch(() => props.active, (active) => { if (active) void focusInput() })
watch(() => props.path, () => { password.value = ''; visible.value = false; capsLock.value = false })
watch(() => props.error, (error) => { if (error) void focusInput(true) })
function updateCapsLock(event: KeyboardEvent) { capsLock.value = event.getModifierState('CapsLock') }
function submit() { if (!props.pending && password.value) emit('submit', password.value) }
</script>

<template>
  <section class="locked-page">
    <form class="locked-page-card" @submit.prevent="submit">
      <div class="locked-page-icon-wrap"><LockClosedIcon class="locked-page-icon" aria-hidden="true" /></div>
      <h2>Protected note</h2>
      <p class="locked-page-description"><template v-if="noteName">“{{ noteName }}” is protected. Enter the password to open and edit it.</template><template v-else>Enter the password to open and edit this note.</template></p>
      <div class="locked-page-field">
        <label :for="`password-${inputId}`">Password</label>
        <div class="locked-page-input-wrap">
          <input :id="`password-${inputId}`" ref="passwordInput" v-model="password" :type="visible ? 'text' : 'password'" autocomplete="current-password" :disabled="pending" :aria-invalid="Boolean(error)" :aria-describedby="error ? `password-error-${inputId}` : capsLock ? `password-caps-${inputId}` : `password-hint-${inputId}`" @keydown="updateCapsLock" @keyup="updateCapsLock" />
          <button type="button" class="locked-page-visibility" :disabled="pending" :aria-label="visible ? 'Hide password' : 'Show password'" @click="visible = !visible">{{ visible ? 'Hide' : 'Show' }}</button>
        </div>
        <p v-if="error" :id="`password-error-${inputId}`" role="alert" class="locked-page-error">{{ error }}</p>
        <p v-else-if="capsLock" :id="`password-caps-${inputId}`" role="status" class="locked-page-hint">Caps Lock is on.</p>
        <p v-else :id="`password-hint-${inputId}`" class="locked-page-hint">Press Enter to unlock.</p>
      </div>
      <UiButton type="submit" variant="primary" :loading="pending" :disabled="!password" class-name="locked-page-submit w-full">
        <span role="status" aria-live="polite">{{ pending ? 'Unlocking note…' : 'Unlock note' }}</span>
        <span v-if="pending" class="locked-page-progress" aria-hidden="true"><span /></span>
      </UiButton>
      <p class="locked-page-trust">This note remains encrypted on disk.</p>
    </form>
  </section>
</template>

<style scoped>
.locked-page { display: flex; justify-content: center; align-items: flex-start; width: 100%; height: 100%; overflow: auto; padding: 1.5rem; background: var(--surface-bg); color: var(--text-main); }
.locked-page-card { display: flex; flex-direction: column; gap: 1rem; width: min(100%, 25rem); margin: auto; flex-shrink: 0; padding: 2rem; border: 1px solid color-mix(in srgb, var(--border-strong) 42%, transparent); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--surface-bg) 96%, black); box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.10), inset 0 8px 20px rgb(0 0 0 / 0.035), inset 0 -1px 0 rgb(255 255 255 / 0.10); }
.locked-page-icon-wrap { display: flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; align-self: center; border-radius: var(--radius-lg); background: var(--surface-muted); color: var(--text-soft); }
.locked-page-icon { width: 1.35rem; height: 1.35rem; }
.locked-page-card h2 { font-size: 1.2rem; font-weight: 600; }
.locked-page-description { color: var(--text-soft); line-height: 1.5; }
.locked-page-field { display: flex; flex-direction: column; gap: .4rem; }
.locked-page-field label { font-size: .8rem; font-weight: 600; }
.locked-page-input-wrap { display: flex; align-items: center; border: 1px solid var(--input-border); border-radius: var(--radius-md); background: var(--input-bg); }
.locked-page-input-wrap:focus-within { border-color: var(--input-focus-border); box-shadow: 0 0 0 2px var(--input-focus-ring); }
.locked-page-input-wrap:has(input[aria-invalid='true']) { border-color: var(--danger); }
.locked-page-input-wrap input { min-width: 0; flex: 1; padding: .65rem .75rem; color: var(--input-text); background: transparent; outline: none; }
.locked-page-visibility { padding: .5rem .75rem; color: var(--text-soft); font-size: .75rem; font-weight: 600; }
.locked-page-visibility:focus-visible { outline: 2px solid var(--input-focus-border); outline-offset: 2px; border-radius: var(--radius-md); }
:deep(.locked-page-submit) { position: relative; overflow: hidden; }
.locked-page-progress { position: absolute; inset: auto 0 0; height: 3px; overflow: hidden; background: rgb(255 255 255 / 0.2); }
.locked-page-progress span { display: block; width: 38%; height: 100%; background: currentColor; animation: locked-page-progress 1.15s ease-in-out infinite; }
@keyframes locked-page-progress { from { transform: translateX(-110%); } to { transform: translateX(270%); } }
@media (prefers-reduced-motion: reduce) { .locked-page-progress span { width: 100%; animation: none; } }
.locked-page-hint, .locked-page-trust, .locked-page-error { font-size: .75rem; line-height: 1.4; }
.locked-page-hint, .locked-page-trust { color: var(--text-dim); }
.locked-page-error { color: var(--danger); }
.locked-page-visibility:hover:not(:disabled) { color: var(--text-main); }
@media (max-width: 480px) { .locked-page-card { padding: 1.4rem; } }
</style>
