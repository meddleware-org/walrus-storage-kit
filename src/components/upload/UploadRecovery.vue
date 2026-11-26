<script setup lang="ts">
// File: UploadRecovery. Props: `kind` (`upload` or `certify`), `busy`. Emits: `retry`. Related: `../WalrusUpload.vue` (holds the retry closures and renders one of these).
// What to do when an upload stopped part-way, with money already spent: retry the relay upload on the same registration, or
// certify a blob that is stored but not yet certified. Neither pays again.
import { computed } from 'vue'
import { UiButton, UiNotice } from '@meddleware/ui'

const props = defineProps<{
  /** What stopped: the relay upload (after registration) or the certification (after the upload). */
  kind: 'upload' | 'certify'
  /** The retry is running. */
  busy: boolean
}>()
/** The person pressed the retry button. */
const emit = defineEmits<{ retry: [] }>()

/** The button's text for the kind and the busy state. */
const label = computed(() => {
  if (props.kind === 'upload') return props.busy ? 'Retrying…' : 'Retry upload'
  return props.busy ? 'Certifying…' : 'Certify blob'
})
</script>

<template>
  <UiNotice type="warning">
    <template v-if="kind === 'upload'">
      Your blob is registered and paid for, but the upload to the relay did not complete. Retry the upload on the same registration — no second payment.
    </template>
    <template v-else>
      Your blob was uploaded and paid for but not yet <strong>certified</strong> — certify it to finish (one wallet approval, network fee only; no re-upload).
    </template>
    <UiButton :busy="busy" size="sm" @click="emit('retry')">{{ label }}</UiButton>
  </UiNotice>
</template>
