<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import UiModalShell from './UiModalShell.vue'
import UiButton from './UiButton.vue'

/** Password entry for a page operation; the caller owns verification and retries. */
const props = defineProps<{ visible: boolean; title: string; error: string; pending: boolean; confirm?: boolean }>()
const emit = defineEmits<{ submit: [password: string]; cancel: [] }>()
const password = ref('')
const confirmation = ref('')
const mismatch = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)
onMounted(() => { if (props.visible) passwordInput.value?.focus() })
watch(() => props.visible, (visible) => {
  password.value = ''
  confirmation.value = ''
  mismatch.value = false
  if (visible) passwordInput.value?.focus()
}, { flush: 'post' })
watch([password, confirmation], () => { mismatch.value = false })

function submit() {
  if (props.confirm && password.value !== confirmation.value) {
    mismatch.value = true
    return
  }
  emit('submit', password.value)
}
</script>

<template>
  <UiModalShell :model-value="visible" :title="title" width="sm" @close="emit('cancel')">
    <form id="page-password-form" @submit.prevent="submit">
      <label for="page-password">Password</label>
      <input id="page-password" ref="passwordInput" v-model="password" type="password" :autocomplete="confirm ? 'new-password' : 'current-password'" :disabled="pending" class="password-input" />
      <template v-if="confirm">
        <label for="page-password-confirm" class="password-label">Confirm password</label>
        <input id="page-password-confirm" v-model="confirmation" type="password" autocomplete="new-password" :disabled="pending" class="password-input" />
      </template>
      <p v-if="mismatch" role="alert">Passwords do not match.</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" :disabled="pending" @click="emit('cancel')">Cancel</UiButton>
      <UiButton type="submit" form="page-password-form" :disabled="pending">Continue</UiButton>
    </template>
  </UiModalShell>
</template>

<style scoped>
.password-input { display: block; width: 100%; margin-top: .5rem; padding: .5rem; color: var(--input-text); background: var(--input-bg); border: 1px solid var(--input-border); border-radius: var(--radius-md); }
.password-label { display: block; margin-top: .75rem; }
</style>
