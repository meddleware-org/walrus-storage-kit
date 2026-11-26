<script setup lang="ts">
// File: UploadDuplicateDialog. Props: `existing`. Emits: `manage`, `upload-anyway`, `cancel`. Related: `../WalrusUpload.vue` (opens it when the app reports a duplicate), `@meddleware/ui` (`UiDialog`).
// You already own this blob: offer to manage the existing copy instead of paying for a duplicate. The wording and the main action
// follow whether the copy is certified (extend it) or still pending (certify it).
import { UiButton, UiDialog } from '@meddleware/ui'
import type { ExistingCopy } from '@meddleware/walrus-storage-client/flow'

/** The copy the wallet already owns: certified (it has an end epoch) or still pending. */
defineProps<{ existing: ExistingCopy }>()
/** The three choices: manage the existing copy, upload a duplicate anyway, or cancel. */
const emit = defineEmits<{ manage: []; 'upload-anyway': []; cancel: [] }>()
</script>

<template>
  <UiDialog open title="You already have this blob" class="wru-duplicate" @close="emit('cancel')">
    <p v-if="existing.kind === 'certified'">
      It's already stored and available until epoch {{ existing.endEpoch }}. Uploading again creates a duplicate and charges the relay fee again — extend its lifetime instead.
    </p>
    <p v-else>You already uploaded this but haven't certified it yet. Finish certifying it instead of paying to upload again.</p>
    <template #actions>
      <UiButton @click="emit('manage')">{{ existing.kind === 'certified' ? 'Extend it' : 'Certify it' }}</UiButton>
      <UiButton variant="ghost" @click="emit('upload-anyway')">Upload a new copy</UiButton>
      <UiButton variant="link" @click="emit('cancel')">Cancel</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
/* Centre the three action buttons (the dialog's own default is end-aligned). */
.wru-duplicate :deep(.mw-dialog__actions) {
  justify-content: center;
}
</style>
