<script setup lang="ts">
// Step 1 of the upload: choose the file. It reports the chosen file (or none); the widget checks and reads it.
import { useId } from 'vue'
import { UiNotice } from '@meddleware/ui'
import UploadHint from './UploadHint.vue'

defineProps<{
  /** File input accept filter. */
  accept: string
  /** Why the last choice was refused, if it was. */
  error?: string | null
}>()
const emit = defineEmits<{ select: [file: File | null] }>()

const helpId = useId()
</script>

<template>
  <input
    type="file"
    :accept="accept"
    aria-label="Choose a file to upload to Walrus"
    :aria-describedby="helpId"
    @change="emit('select', ($event.target as HTMLInputElement).files?.[0] ?? null)"
  />
  <UiNotice v-if="error" type="error" :message="error" />
  <UploadHint :id="helpId">
    Select a file to continue. Requires <strong>WAL</strong> (storage) and <strong>SUI</strong> (gas + relay fee) in your wallet.
  </UploadHint>
</template>
