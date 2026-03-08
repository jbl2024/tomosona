<script setup lang="ts">
import { Squares2X2Icon } from '@heroicons/vue/24/outline'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import UiIconButton from '../../../shared/components/ui/UiIconButton.vue'
import UiMenu from '../../../shared/components/ui/UiMenu.vue'
import UiMenuList from '../../../shared/components/ui/UiMenuList.vue'
import UiSeparator from '../../../shared/components/ui/UiSeparator.vue'

const props = defineProps<{
  canSplit: boolean
  paneCount: number
}>()

const emit = defineEmits<{
  'split-right': []
  'split-down': []
  'focus-pane': [payload: { index: number }]
  'focus-next': []
  'move-tab-next': []
  'close-pane': []
  'join-panes': []
  'reset-layout': []
}>()

const open = ref(false)
const wrapRef = ref<HTMLElement | null>(null)

const paneIndices = computed(() => [1, 2, 3, 4])

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function run(action: () => void) {
  action()
  close()
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return
  if (!wrapRef.value?.contains(event.target as Node | null)) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <div ref="wrapRef" class="multi-pane-menu" @keydown.esc.stop="close">
    <UiIconButton
      class-name="toolbar-icon-btn"
      aria-label="Multi-pane layout"
      title="Multi-pane layout"
      :aria-expanded="open"
      :active="open"
      @click="toggle"
    >
      <Squares2X2Icon />
    </UiIconButton>

    <UiMenu v-if="open" class-name="multi-pane-dropdown">
      <UiMenuList>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="!canSplit" @click="run(() => emit('split-right'))">Split Right</button>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="!canSplit" @click="run(() => emit('split-down'))">Split Down</button>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="paneCount < 2" @click="run(() => emit('focus-next'))">Focus Next Pane</button>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="paneCount < 2" @click="run(() => emit('move-tab-next'))">Move Tab to Next Pane</button>
      </UiMenuList>
      <UiSeparator class="multi-pane-divider" />
      <UiMenuList>
      <button
        v-for="index in paneIndices"
        :key="`pane-${index}`"
        type="button"
        class="ui-menu-item multi-pane-item"
        :disabled="index > paneCount"
        @click="run(() => emit('focus-pane', { index }))"
      >
        Focus Pane {{ index }}
      </button>
      </UiMenuList>
      <UiSeparator class="multi-pane-divider" />
      <UiMenuList>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="paneCount <= 1" @click="run(() => emit('close-pane'))">Close Active Pane</button>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="paneCount <= 1" @click="run(() => emit('join-panes'))">Join Panes</button>
      <button type="button" class="ui-menu-item multi-pane-item" :disabled="paneCount <= 1" @click="run(() => emit('reset-layout'))">Reset Pane Layout</button>
      </UiMenuList>
    </UiMenu>
  </div>
</template>

<style scoped>
.multi-pane-menu {
  position: relative;
}

.multi-pane-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 220px;
  z-index: 40;
}

.multi-pane-item {
  justify-content: flex-start;
}

.multi-pane-divider {
  margin: 4px 0;
}
</style>
