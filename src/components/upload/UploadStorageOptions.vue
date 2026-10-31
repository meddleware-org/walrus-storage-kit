<script setup lang="ts">
// How long the blob is stored, and whether it can be deleted early. Both are explicit, visible choices.
import { computed, nextTick, useId } from 'vue'
import { UiButton, UiCheckField, UiTextField } from '@meddleware/ui'

const props = defineProps<{
  /** Upper bound on one reservation (Walrus `max_epochs_ahead`). */
  maxEpochs: number
  /** Epochs offered by the "Short" preset (never more than `maxEpochs`). */
  shortEpochs?: number
}>()

/** Storage duration in epochs. The widget clamps it to [1, maxEpochs]. */
const epochs = defineModel<number>('epochs', { required: true })
/** Permanent (nobody can remove it before it expires) or deletable. */
const permanent = defineModel<boolean>('permanent', { required: true })

const epochsId = useId()
const short = computed(() => Math.min(props.shortEpochs ?? 10, props.maxEpochs))

// The widget clamps the duration, and a clamped value can equal the one the field already shows, so nothing re-renders it: put the
// clamped value back in the field. An emptied field is left alone, so a new number can be typed.
function show(e: Event): void {
  const field = e.target as HTMLInputElement
  void nextTick(() => {
    if (field.value !== '' && field.value !== String(epochs.value)) field.value = String(epochs.value)
  })
}
</script>

<template>
  <div class="wru-duration">
    <UiTextField
      :id="epochsId"
      :model-value="String(epochs)"
      type="number"
      label="Storage duration (epochs)"
      :hint="`Max ${maxEpochs} epochs per upload; extend later from &quot;My Blobs&quot;.`"
      min="1"
      :max="maxEpochs"
      @update:model-value="(v: string) => v !== '' && (epochs = Number(v))"
      @input="show"
    />
    <menu class="wru-duration__presets">
      <li><UiButton variant="ghost" size="sm" :disabled="epochs >= maxEpochs" @click="epochs = maxEpochs">Max</UiButton></li>
      <li><UiButton variant="ghost" size="sm" @click="epochs = short">Short</UiButton></li>
    </menu>
  </div>
  <UiCheckField
    v-model="permanent"
    label="Permanent"
    hint="a permanent blob cannot be deleted by anyone, including you, before it expires; untick it to store the blob as deletable, so you can remove it early and reclaim the unused storage"
  />
</template>

<style scoped>
.wru-duration {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--space-xs);
}
.wru-duration__presets {
  display: flex;
  gap: var(--space-2xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
