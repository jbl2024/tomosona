<script setup lang="ts">
defineProps<{
  triggerVisible: boolean
  triggerLeft: number
  triggerTop: number
  addTopVisible: boolean
  addBottomVisible: boolean
  addLeftVisible: boolean
  addRightVisible: boolean
  tableBoxLeft: number
  tableBoxTop: number
  tableBoxWidth: number
  tableBoxHeight: number
}>()

const emit = defineEmits<{
  toggle: [event: MouseEvent]
  addRowBefore: [event: MouseEvent]
  addRowAfter: [event: MouseEvent]
  addColumnBefore: [event: MouseEvent]
  addColumnAfter: [event: MouseEvent]
}>()
</script>

<template>
  <div
    v-if="triggerVisible"
    class="tomosona-table-trigger absolute z-30 tomosona-table-control"
    :class="{ 'is-visible': true }"
    :style="{ left: `${triggerLeft}px`, top: `${triggerTop}px` }"
  >
    <button
      type="button"
      class="tomosona-table-trigger-btn"
      aria-label="Open table actions"
      @mousedown.prevent
      @click.stop="emit('toggle', $event)"
    >
      ⋮
    </button>
  </div>

  <div
    v-if="triggerVisible"
    class="tomosona-table-edge tomosona-table-edge-top absolute z-30 tomosona-table-control"
    :class="{ 'is-visible': addTopVisible }"
    :style="{ left: `${tableBoxLeft}px`, top: `${tableBoxTop - 20}px`, width: `${tableBoxWidth}px` }"
  >
    <button
      type="button"
      class="tomosona-table-trigger-btn tomosona-table-plus-btn"
      aria-label="Add row above"
      @mousedown.prevent
      @click.stop="emit('addRowBefore', $event)"
    >
      +
    </button>
  </div>

  <div
    v-if="triggerVisible"
    class="tomosona-table-edge tomosona-table-edge-bottom absolute z-30 tomosona-table-control"
    :class="{ 'is-visible': addBottomVisible }"
    :style="{ left: `${tableBoxLeft}px`, top: `${tableBoxTop + tableBoxHeight}px`, width: `${tableBoxWidth}px` }"
  >
    <button
      type="button"
      class="tomosona-table-trigger-btn tomosona-table-plus-btn"
      aria-label="Add row below"
      @mousedown.prevent
      @click.stop="emit('addRowAfter', $event)"
    >
      +
    </button>
  </div>

  <div
    v-if="triggerVisible"
    class="tomosona-table-edge tomosona-table-edge-left absolute z-30 tomosona-table-control"
    :class="{ 'is-visible': addLeftVisible }"
    :style="{ left: `${tableBoxLeft - 20}px`, top: `${tableBoxTop}px`, height: `${tableBoxHeight}px` }"
  >
    <button
      type="button"
      class="tomosona-table-trigger-btn tomosona-table-plus-btn"
      aria-label="Add column left"
      @mousedown.prevent
      @click.stop="emit('addColumnBefore', $event)"
    >
      +
    </button>
  </div>

  <div
    v-if="triggerVisible"
    class="tomosona-table-edge tomosona-table-edge-right absolute z-30 tomosona-table-control"
    :class="{ 'is-visible': addRightVisible }"
    :style="{ left: `${tableBoxLeft + tableBoxWidth}px`, top: `${tableBoxTop}px`, height: `${tableBoxHeight}px` }"
  >
    <button
      type="button"
      class="tomosona-table-trigger-btn tomosona-table-plus-btn"
      aria-label="Add column right"
      @mousedown.prevent
      @click.stop="emit('addColumnAfter', $event)"
    >
      +
    </button>
  </div>
</template>
