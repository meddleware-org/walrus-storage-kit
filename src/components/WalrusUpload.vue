<script setup lang="ts">
// Generic Walrus blob-upload widget. UI + orchestration only — the heavy
// `@mysten/walrus` client and the wallet live in the consuming app, injected via
// `performUpload`. This keeps `@meddleware/walrus-storage-kit` free of wasm/wallet
// deps (preserving the lazy-load boundary) and wallet-agnostic. Relay selection +
// tip estimation come from `useWalrusRelay`. The steps, the progress dialog and the
// recovery prompts are the components in `./upload/`; this file owns the state they share.
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { UiButton, UiNotice, UiStepper, type StepperStep } from '@meddleware/ui'
import { createOperationScope, errorMessage } from '@meddleware/web-utils'
import { useWalrusRelay } from '../composables/useWalrusRelay.js'
import type { WalrusRelayHosts, RelayAccessOptions } from '../composables/useWalrusRelay.js'
import { isUploadProgress } from '../lib/upload-steps.js'
import {
  getCertifyRetry,
  getUploadRetry,
  getDuplicateExisting,
  type BlobUploadResult as UploadResult,
  type ExistingCopy,
  type UploadProgress,
  type UploadStepKey,
} from '@meddleware/walrus-storage-client/flow'
import { MAX_SINGLE_RESERVATION_EPOCHS, formatCoinAmount } from '../lib/relay.js'
import UploadFileStep from './upload/UploadFileStep.vue'
import UploadStorageOptions from './upload/UploadStorageOptions.vue'
import UploadRelayStatus from './upload/UploadRelayStatus.vue'
import UploadRecovery from './upload/UploadRecovery.vue'
import UploadProgressDialog from './upload/UploadProgress.vue'
import UploadDuplicateDialog from './upload/UploadDuplicateDialog.vue'
import UploadHint from './upload/UploadHint.vue'

const props = withDefaults(
  defineProps<{
    /** Relay host pair for the active network (operator + public fallback). */
    hosts: WalrusRelayHosts
    /** Whether a wallet is connected (gates the upload button). */
    connected: boolean
    /** Optional NFT-gate wiring (from `useAccessGate`). Read live, so it may change with the network. */
    access?: RelayAccessOptions
    /**
     * Identifies the wallet session, for example `${network}:${address}`. When it changes (another
     * account or network), the chosen file and any held retry (certify or upload) are discarded, and
     * an upload still in flight no longer reports its result. Pass it whenever the account or network
     * can change without the widget being re-mounted.
     */
    sessionKey?: string | null
    /** File input accept filter. Default: any file. */
    accept?: string
    /** Optional UX-only size guard in bytes (the authoritative cap is the relay edge). */
    maxBytes?: number
    /**
     * App-provided upload. Receives the chosen bytes + upload options (selected relay host, chosen
     * storage duration in `epochs`, a `force` flag to bypass the duplicate precheck) and a status
     * callback; performs encode → register → upload → certify → getBlob using the app's Walrus
     * client + wallet, and resolves the blob result.
     *
     * `onStatus` accepts either a plain string (legacy — shown as a single status line) or an
     * `UploadProgress` (`{ step, detail }`), which drives the stepped progress indicator.
     */
    performUpload: (
      bytes: Uint8Array,
      opts: {
        relayHost: string
        epochs: number
        force?: boolean
        /** Register the blob as deletable (owner may delete it early) instead of permanent. */
        deletable?: boolean
        onStatus: (s: string | UploadProgress) => void
      },
    ) => Promise<UploadResult>
    /**
     * Estimate the on-chain storage cost (in WAL FROST, i.e. ×1e-9 WAL) of storing `sizeBytes` for
     * `epochs`. Injected by the app (it owns the Walrus client); when provided, the cost line shows a
     * storage figure alongside the relay fee. Returns `null` on a transient failure.
     */
    estimateStorageCost?: (sizeBytes: number, epochs: number) => Promise<bigint | null>
  }>(),
  { accept: '*/*', access: () => ({}) },
)

const emit = defineEmits<{
  (e: 'uploaded', result: UploadResult): void
  /** Fires once per upload attempt after it resolves — success OR failure. Lets the host
   *  refresh on-chain-derived views (owned blobs) since a failed UI run may still have landed. */
  (e: 'settled'): void
  /** The user chose to manage an existing copy (Extend a certified one / Certify a pending one)
   *  instead of uploading a duplicate. The host routes to its blob-management view. */
  (e: 'manage-existing', existing: ExistingCopy): void
}>()

/** Upper bound on a single reservation (Walrus `max_epochs_ahead`). */
const maxUploadEpochs = MAX_SINGLE_RESERVATION_EPOCHS

const {
  selectedRelayHost,
  availableRelays,
  relayPending,
  estimatedCost,
  relayFeeStatus,
  fileSizeBytes,
  configError,
  checkOperatorRelayHealth,
} = useWalrusRelay(() => props.hosts, () => props.access)

const uploading = ref(false)
// Invalidated whenever the wallet session changes (account, network or relay hosts) or the wallet
// disconnects. An upload or retry that finishes after that belongs to the previous session: its
// result and its held closures are dropped, never shown to the new one.
const session = createOperationScope()
const status = ref('')
const error = ref<string | null>(null)
const fileName = ref('')
let bytes: Uint8Array | null = null

// Chosen storage reservation length (epochs). Defaults to the single-reservation max; clamped to
// [1, maxUploadEpochs]. Longer lifetimes are reached later via Extend (max_epochs_ahead caps a tx).
const uploadEpochs = ref(maxUploadEpochs)
// Permanence is an explicit, visible choice. Permanent is the default: nobody (not even the
// uploader) can remove the blob before it expires, and existing permanent copies are reused.
const permanent = ref(true)
watch(uploadEpochs, (v) => {
  const clamped = Math.min(maxUploadEpochs, Math.max(1, Math.floor(Number(v) || 1)))
  if (clamped !== v) uploadEpochs.value = clamped
})

// Estimated on-chain storage cost (WAL FROST) for the current file + duration; null while unknown.
const storageCostFrost = ref<bigint | null>(null)
let storageReqId = 0
async function refreshStorageCost(): Promise<void> {
  const size = fileSizeBytes.value
  const epochs = uploadEpochs.value
  if (!size || !epochs || !props.estimateStorageCost) {
    storageCostFrost.value = null
    return
  }
  const id = ++storageReqId
  try {
    const frost = await props.estimateStorageCost(size, epochs)
    if (id === storageReqId) storageCostFrost.value = frost
  } catch {
    if (id === storageReqId) storageCostFrost.value = null
  }
}
watch([fileSizeBytes, uploadEpochs], () => void refreshStorageCost(), { immediate: true })

/** Combined cost line: storage in WAL (scales with epochs) + relay fee in SUI (separate tokens). */
const costLine = computed<string | null>(() => {
  const relay = estimatedCost.value
  const storage = storageCostFrost.value
  const parts: string[] = []
  if (storage !== null) {
    parts.push(`~${formatCoinAmount(storage, 'WAL')} storage (${uploadEpochs.value} epochs)`)
  }
  if (relay) parts.push(relay.mist === 0n ? 'no relay fee' : `~${formatCoinAmount(relay.mist, 'SUI')} relay fee`)
  else if (fileSizeBytes.value > 0 && (relayFeeStatus.value === 'unknown' || relayFeeStatus.value === 'over-ceiling')) {
    // An unreadable or out-of-range tip is not a free relay: say so instead of leaving it out.
    parts.push(relayFeeStatus.value === 'unknown' ? 'relay fee unknown' : 'relay fee above the safety limit')
  }
  return parts.length ? `Estimated cost: ${parts.join(' + ')} (+ gas)` : null
})

/** How many wallet approvals an upload through the selected relay needs, in words. */
const approvalsHint = computed(() => {
  const selected = availableRelays.value.find((r) => r.host === selectedRelayHost.value)
  const gated = (props.access.gateConfigured ?? false) && !selected?.isPublic
  if (!gated) return 'two wallet approvals (blob registration, blob certification)'
  const single = props.access.singleUse?.value
  if (single === true) return 'four wallet approvals (spend a pass use, prove access, blob registration, blob certification)'
  if (single === false) return 'three wallet approvals (prove access, blob registration, blob certification)'
  return 'three or four wallet approvals (spend a pass use if your pass is single-use, prove access, blob registration, blob certification)'
})

// An existing owned copy of the file the user is trying to upload (from the app's precheck). When
// set, a choice dialog offers Extend/Certify instead of creating a wasteful duplicate.
const duplicate = ref<ExistingCopy | null>(null)

// When an upload lands but certify fails, the app attaches a retry closure to the error. We hold it
// so the user can certify the already-stored (already-paid) blob with one more approval — no
// re-upload. `certifying` tracks the retry in flight.
const pendingCertify = ref<(() => Promise<UploadResult>) | null>(null)
const certifying = ref(false)

// When the relay upload fails after the blob was registered (and paid for), the app attaches an
// upload-retry closure to the error. The registration is still good for a while, so one click retries
// the upload on it with a fresh access proof, without paying to register again.
const pendingUpload = ref<(() => Promise<UploadResult>) | null>(null)
const retryingUpload = ref(false)

// Stepped-progress state. `activeStep` is set only when the app reports structured progress; if it
// stays null (a legacy string-only caller), the dialog falls back to the status line alone. A gated
// upload spends an NFT use first, so it has an extra leading "Access" step: we switch to the gated
// catalogue as soon as an `access` step is reported (the app only emits it when gating).
const activeStep = ref<UploadStepKey | null>(null)
const sawAccessStep = ref(false)

function onProgress(s: string | UploadProgress): void {
  if (isUploadProgress(s)) {
    if (s.step === 'access') sawAccessStep.value = true
    activeStep.value = s.step
    status.value = s.detail ?? ''
  } else {
    status.value = s
  }
}

// The progress dialog is a native modal: the page is inert and focus stays inside while uploading. The
// Upload button is disabled during the upload, so the browser can't restore focus to it on close —
// return focus there explicitly once it is enabled again.
const uploadBtn = ref<InstanceType<typeof UiButton> | null>(null)

watch(uploading, async (isUploading) => {
  if (isUploading) return
  await nextTick()
  ;(uploadBtn.value?.$el as HTMLElement | undefined)?.focus()
})

onMounted(() => {
  checkOperatorRelayHealth()
})

// Gated + unpaid ⇒ no relay is available and upload is blocked until the user buys a pass.
const noRelayAvailable = computed(() => availableRelays.value.length === 0)

// ── Pre-upload wizard ────────────────────────────────────────────────────────
const UPLOAD_STEPS: StepperStep[] = [
  { id: 'file', label: 'File' },
  { id: 'options', label: 'Options' },
  { id: 'upload', label: 'Upload' },
]
const uploadStep = ref(0)

/** Drop the chosen file's outcome and every held retry: they belong to a file, account, network or relay that has changed. */
function clearHeld(): void {
  error.value = null
  pendingCertify.value = null
  pendingUpload.value = null
  duplicate.value = null
}

/** Forget the chosen file and every held retry: they were made for another account, network or relay. */
function resetSession(): void {
  session.invalidate()
  clearHeld()
  bytes = null
  fileName.value = ''
  fileSizeBytes.value = 0
  sawAccessStep.value = false
  activeStep.value = null
  uploadStep.value = 0
}
watch(
  () => [props.sessionKey ?? null, props.hosts.operator, props.hosts.public] as const,
  (now, before) => {
    if (now.some((v, i) => v !== before[i])) resetSession()
  },
)
watch(
  () => props.connected,
  (isConnected) => {
    if (!isConnected) resetSession()
  },
)

// A newer choice supersedes a file still being read.
let reading = 0
async function onFile(f: File | null): Promise<void> {
  const mine = ++reading
  clearHeld()
  bytes = null
  fileName.value = ''
  if (!f) return
  if (props.maxBytes && f.size > props.maxBytes) {
    error.value = `File too large (max ${Math.round(props.maxBytes / 1024)} KB).`
    return
  }
  fileName.value = f.name
  fileSizeBytes.value = f.size
  const read = new Uint8Array(await f.arrayBuffer())
  if (mine !== reading) return
  bytes = read
  uploadStep.value = 1
}

async function upload(force = false): Promise<void> {
  if (!bytes) {
    error.value = 'Choose a file first.'
    return
  }
  uploading.value = true
  activeStep.value = null
  sawAccessStep.value = false
  clearHeld()
  const current = session.begin()
  try {
    const result = await props.performUpload(bytes, {
      relayHost: selectedRelayHost.value,
      epochs: uploadEpochs.value,
      force,
      deletable: !permanent.value,
      onStatus: onProgress,
    })
    if (current.isCurrent()) emit('uploaded', result)
  } catch (e) {
    if (!current.isCurrent()) return // the wallet session changed: this outcome is not for the new one
    // The app aborted before registering because the wallet already owns this blob: offer to manage
    // the existing copy (Extend / Certify) instead of paying to upload a duplicate.
    const existing = getDuplicateExisting(e)
    if (existing) {
      duplicate.value = existing
      return
    }
    // If the upload landed but only certify failed, offer a retry instead of a hard error — the
    // blob is already stored and paid for; certifying it later costs only the certify gas.
    const retry = getCertifyRetry<UploadResult>(e)
    if (retry) {
      pendingCertify.value = retry
    } else {
      pendingUpload.value = getUploadRetry<UploadResult>(e)
      error.value = errorMessage(e)
    }
  } finally {
    // The transient step text only lives in the dialog; the persistent "Uploaded ✓" is the
    // host's result section. Clear it as the dialog closes so it never lingers.
    status.value = ''
    activeStep.value = null
    uploading.value = false
    emit('settled')
  }
}

/**
 * Retry the relay upload on the registration that is already paid for (a fresh access proof is
 * minted inside the app's closure). Keeps the retry available if it fails again.
 */
async function runPendingUpload(): Promise<void> {
  const retry = pendingUpload.value
  if (!retry || retryingUpload.value) return
  retryingUpload.value = true
  error.value = null
  const current = session.begin()
  try {
    const result = await retry()
    if (!current.isCurrent()) return
    pendingUpload.value = null
    emit('uploaded', result)
  } catch (e) {
    if (!current.isCurrent()) return
    const certify = getCertifyRetry<UploadResult>(e)
    if (certify) {
      pendingUpload.value = null
      pendingCertify.value = certify
    } else {
      pendingUpload.value = getUploadRetry<UploadResult>(e)
      error.value = errorMessage(e)
    }
  } finally {
    retryingUpload.value = false
    emit('settled')
  }
}

/** User chose "Upload a new copy" in the duplicate dialog: re-run the upload, bypassing the check. */
function uploadAnyway(): void {
  duplicate.value = null
  void upload(true)
}

/** User chose "Extend it" / "Certify it": hand the existing copy to the host's blob-management view. */
function manageExisting(): void {
  const existing = duplicate.value
  duplicate.value = null
  if (existing) emit('manage-existing', existing)
}

/**
 * Retry certification of an already-uploaded blob (after a failed certify). Runs the app's retry
 * closure, which re-submits the certify transaction from the certificate the upload already
 * obtained — no re-upload, no relay, no extra fee beyond gas.
 */
async function runPendingCertify(): Promise<void> {
  const retry = pendingCertify.value
  if (!retry || certifying.value) return
  certifying.value = true
  error.value = null
  const current = session.begin()
  try {
    const result = await retry()
    if (!current.isCurrent()) return
    pendingCertify.value = null
    emit('uploaded', result)
  } catch (e) {
    if (!current.isCurrent()) return
    // Keep the pending state so the user can try again (e.g. they rejected the prompt once more).
    error.value = errorMessage(e)
  } finally {
    certifying.value = false
    emit('settled')
  }
}
</script>

<template>
  <div class="wru-upload">
    <UiStepper v-model="uploadStep" :steps="UPLOAD_STEPS" />

    <UploadFileStep v-if="uploadStep === 0" :accept="accept" :error="error" @select="onFile" />

    <!-- Options: relay and storage -->
    <template v-else-if="uploadStep === 1">
      <p class="wru-file">
        <strong>{{ fileName }}</strong>
        <UiButton variant="link" size="sm" @click="uploadStep = 0">Change file</UiButton>
      </p>

      <UploadRelayStatus
        v-model:host="selectedRelayHost"
        :config-error="configError"
        :connected="connected"
        :pending="relayPending"
        :relays="availableRelays"
        choose
      />
      <UploadStorageOptions v-model:epochs="uploadEpochs" v-model:permanent="permanent" :max-epochs="maxUploadEpochs" />

      <!-- The relay upload failed after the blob was registered and paid for. Retrying uses that
           registration (no second storage fee, tip or registration gas). -->
      <UploadRecovery v-if="pendingUpload" kind="upload" :busy="retryingUpload" @retry="runPendingUpload" />
      <UiNotice v-if="error" type="error" :message="error" />

      <p class="wru-nav">
        <UiButton variant="ghost" @click="uploadStep = 0">Back</UiButton>
        <UiButton :disabled="noRelayAvailable" @click="uploadStep = 2">Next</UiButton>
      </p>
    </template>

    <!-- Review and upload -->
    <template v-else-if="uploadStep === 2">
      <p class="wru-file">
        <strong>{{ fileName }}</strong>
        <UiButton variant="link" size="sm" @click="uploadStep = 1">Change options</UiButton>
      </p>

      <UploadHint v-if="costLine" class="wru-cost">{{ costLine }}</UploadHint>
      <UploadHint>
        Requires <strong>WAL</strong> (storage) and <strong>SUI</strong> (gas + relay fee) in your wallet; {{ approvalsHint }}.
      </UploadHint>

      <UploadRelayStatus
        v-model:host="selectedRelayHost"
        :config-error="configError"
        :connected="connected"
        :pending="relayPending"
        :relays="availableRelays"
      />

      <!-- Upload landed but certification didn't (e.g. the wallet prompt was declined). The blob is
           already stored and paid for; offer a one-click certify rather than forcing a full re-upload. -->
      <UploadRecovery v-if="pendingCertify" kind="certify" :busy="certifying" @retry="runPendingCertify" />
      <UiNotice v-if="error" type="error" :message="error" />

      <p class="wru-nav">
        <UiButton variant="ghost" @click="uploadStep = 1">Back</UiButton>
        <UiButton ref="uploadBtn" :busy="uploading" :disabled="!connected || !fileName || noRelayAvailable" @click="upload()">
          Upload to Walrus
        </UiButton>
      </p>
    </template>

    <UploadProgressDialog :open="uploading" :step="activeStep" :gated="sawAccessStep" :status="status" />
    <UploadDuplicateDialog v-if="duplicate" :existing="duplicate" @manage="manageExisting" @upload-anyway="uploadAnyway" @cancel="duplicate = null" />
  </div>
</template>

<style scoped>
.wru-upload {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.wru-file {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  margin: 0;
}
.wru-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2xs);
  margin: var(--space-2xs) 0 0;
}
</style>
