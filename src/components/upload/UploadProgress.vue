<script setup lang="ts">
// File: UploadProgress (exported to the widget as `UploadProgressDialog`). Props: `open`, `step`, `gated`, `status`. Related: `../WalrusUpload.vue`, `../../lib/upload-steps.ts` (the catalogues),
// `@meddleware/ui` (`UiDialog`, `UiStepper`, `UiLiveStatus`).
// The blocking progress while an upload runs: a non-dismissible native modal (the page behind is inert and focus stays inside), a
// stepper the upload walks through when the app reports structured progress, and the current step in words (a legacy string-only
// caller gets just the words).
import { computed } from 'vue'
import { UiDialog, UiLiveStatus, UiStepper, type StepperStep } from '@meddleware/ui'
import type { UploadStepKey } from '@meddleware/walrus-storage-client/flow'
import { CORE_UPLOAD_STEPS, GATED_UPLOAD_STEPS } from '../../lib/upload-steps.js'
import UploadHint from './UploadHint.vue'

const props = defineProps<{
  open: boolean
  /** The step the app last reported; null until it reports one. */
  step: UploadStepKey | null
  /** A gated upload spends an access-pass use first, so it has an extra leading step. */
  gated: boolean
  /** The current step in words. */
  status: string
}>()

/** The steps to draw: a gated upload has the extra leading access step. */
const catalogue = computed(() => (props.gated ? GATED_UPLOAD_STEPS : CORE_UPLOAD_STEPS))
/** Position of the reported step in the catalogue, or -1 before the app reports one (then no stepper is drawn). */
const index = computed(() => (props.step ? catalogue.value.findIndex((s) => s.key === props.step) : -1))
/** The stepper's steps: those before the active one are done, the active one is busy, the rest pending. */
const steps = computed<StepperStep[]>(() =>
  catalogue.value.map((s, i) => ({ id: s.key, label: s.label, status: i < index.value ? 'done' : i === index.value ? 'busy' : 'pending' })),
)
</script>

<template>
  <UiDialog :open="open" title="Uploading to Walrus…" :dismissible="false" class="wru-progress">
    <UiStepper v-if="index >= 0" :steps="steps" :aria-label="`Step ${index + 1} of ${steps.length}`" />
    <UiLiveStatus label="Upload progress" :message="status || 'Preparing…'" />
    <UploadHint>Keep this tab open and approve the wallet prompts.</UploadHint>
  </UiDialog>
</template>
