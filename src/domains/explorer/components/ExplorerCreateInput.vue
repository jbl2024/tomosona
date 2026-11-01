<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

defineProps<{ parentPath: string; error: string; busy: boolean }>()
const emit = defineEmits<{ confirm: [name: string]; cancel: [] }>()
const name = ref('')
const input = ref<HTMLInputElement | null>(null)
onMounted(async () => { await nextTick(); input.value?.focus() })
</script>

<template>
  <form class="explorer-create" @submit.prevent="emit('confirm', name)" @keydown.esc.stop.prevent="emit('cancel')" @click.stop>
    <input ref="input" v-model="name" class="explorer-create-input" aria-label="New note name" :disabled="busy" :aria-invalid="Boolean(error)" :title="`Create note in ${parentPath}`" placeholder="Note name" />
    <span v-if="error" class="explorer-create-error" role="alert">{{ error }}</span>
  </form>
</template>

<style scoped>
.explorer-create { min-width: 0; padding: 0.25rem 0.5rem; }
.explorer-create-input { width: 100%; min-width: 0; border: 1px solid var(--input-border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--input-text); padding: 0.3rem 0.5rem; font-size: 0.75rem; }
.explorer-create-input:focus { outline: none; border-color: var(--input-focus-border); box-shadow: 0 0 0 2px var(--input-focus-ring); }
.explorer-create-error { display: block; color: var(--danger); font-size: 0.75rem; }
</style>
