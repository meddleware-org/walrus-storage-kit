<script setup lang="ts">
// File: the gallery page: the three components in every state the real-browser accessibility run visits, chosen by the `view` prop (badges, cta or upload) with the upload scripted by `fail`.
// Not published. Related: gallery/main.ts (supplies the props and the fetch fixtures), e2e/a11y.spec.ts (the sweep).
import { markRaw, ref } from 'vue'
import { attachCertifyRetry, attachDuplicateExisting, attachUploadRetry, type BlobUploadResult } from '@meddleware/walrus-storage-client/flow'
import { AccessGateCta, TipConfigBadge, WalrusUpload, type PurchaseTerms } from '../src/index'

/** Which view to show and how the scripted upload should behave (none, hang, retry, certify or duplicate). */
const props = defineProps<{ view: string; fail: string }>()

// Purchase terms for the prompt: a soulbound pass of ten uses at 0.01 SUI, of which the platform's share is 0.00002 SUI.
const terms: PurchaseTerms = {
  network: 'testnet',
  gateId: `0x${'a1'.repeat(32)}`,
  priceMist: 10_000_000n,
  operator: { address: `0x${'0b'.repeat(32)}`, mist: 9_980_000n },
  platform: { address: `0x${'7e'.repeat(32)}`, mist: 20_000n },
  paused: false,
  soulbound: true,
  defaultUses: 10n,
}

// A finished upload's result (the cast is only to satisfy the type: the gallery never reads the extra fields).
const result = { blobId: 'blob-1', url: 'https://aggregator.example/v1/blobs/blob-1' } as BlobUploadResult

/**
 * The upload the gallery's widget runs: it fails, hangs or succeeds as the `fail` parameter says, so every state the widget can show is reachable in a real browser.
 * `retry` fails the relay upload with a retry attached, `certify` fails the certification with a retry, `duplicate` reports an existing copy, `hang` reports a step and never ends.
 */
async function performUpload(
  _bytes: Uint8Array,
  opts: { onStatus: (s: { step: 'register'; detail: string }) => void },
): Promise<BlobUploadResult> {
  // Never resolves: the progress dialog stays open for the screenshot and the accessibility check.
  if (props.fail === 'hang') {
    opts.onStatus({ step: 'register', detail: 'Approve the registration in your wallet…' })
    return new Promise(() => {})
  }
  // A relay failure after registration: the widget offers "Retry upload".
  if (props.fail === 'retry') {
    const e = new Error('The upload to the relay failed (503).')
    attachUploadRetry(e, async () => result)
    throw e
  }
  // A declined certification: the widget offers "Certify blob".
  if (props.fail === 'certify') {
    const e = new Error('Certification was declined.')
    attachCertifyRetry(e, async () => result)
    throw e
  }
  // The wallet already owns this blob: the widget opens the duplicate dialog.
  if (props.fail === 'duplicate') {
    const e = new Error('You already own this blob.')
    attachDuplicateExisting(e, { kind: 'certified', blobId: 'blob-1', objectId: '0xblob', endEpoch: 120 })
    throw e
  }
  return result
}

// The gate wiring of the widget: a configured gate, access held, a single-use pass (so the approvals copy says four). `markRaw` keeps the refs un-proxied.
// (`session-key` below names the wallet session, so the widget would reset if it changed.)
const gated = markRaw({ gateConfigured: true, hasAccess: ref<boolean | null>(true), singleUse: ref(true) })
/** A storage estimate that scales with the duration (1 000 000 FROST per epoch), so the cost line shows a figure that follows the field. */
const estimateStorageCost = async (_size: number, epochs: number): Promise<bigint> => BigInt(epochs) * 1_000_000n
</script>

<template>
  <main>
    <!-- One view at a time, chosen by the `view` prop: the relay badges, the purchase prompt in five states, or the upload widget. -->
    <h1>walrus-storage-kit gallery</h1>

    <!-- Eight relays: known tip, linear tip, no tip, unreadable, over the ceiling, down, never answering, and an insecure address (a configuration error). -->
    <section v-if="view === 'badges'">
      <h2>Relay badge</h2>
      <ul class="list">
        <!-- Each host is answered by a fixture in gallery/main.ts. -->
        <li><TipConfigBadge host="https://up.example" /></li>
        <li><TipConfigBadge host="https://linear.example" /></li>
        <li><TipConfigBadge host="https://none.example" /></li>
        <li><TipConfigBadge host="https://unknown.example" /></li>
        <li><TipConfigBadge host="https://over.example" /></li>
        <li><TipConfigBadge host="https://down.example" /></li>
        <li><TipConfigBadge host="https://hang.example" /></li>
        <li><TipConfigBadge host="http://not-secure.example" /></li>
      </ul>
    </section>

    <!-- The prompt with its terms, while buying, with no terms yet, with an unreadable-terms error, and for a paused gate with a failed purchase. -->
    <section v-else-if="view === 'cta'">
      <h2>Purchase prompt</h2>
      <!-- Terms read, ready to buy; then the same while a purchase is in flight (the button is busy). -->
      <AccessGateCta gate-configured :has-access="false" :terms="terms" />
      <AccessGateCta gate-configured :has-access="false" :terms="terms" busy />
      <!-- Terms still being read (the live message), then terms that could not be read (the plain error). -->
      <AccessGateCta gate-configured :has-access="false" :terms="null" />
      <AccessGateCta gate-configured :has-access="false" :terms="null" terms-error="This pass is not available right now. Try again in a moment, or contact the site." />
      <!-- A paused gate with an unlimited, transferable pass, and the failure message of an earlier purchase. -->
      <AccessGateCta
        gate-configured
        :has-access="false"
        :terms="{ ...terms, paused: true, defaultUses: 0n, soulbound: false }"
        purchase-error="The payment is less than the gate price."
      />
    </section>

    <!-- The upload widget on a single relay with a gate whose pass is held, so it goes straight to the file step. -->
    <section v-else>
      <h2>Upload</h2>
      <WalrusUpload
        :hosts="{ operator: 'https://relay.example', public: 'https://relay.example' }"
        connected
        :access="gated"
        session-key="testnet:0xabc"
        :perform-upload="performUpload"
        :estimate-storage-cost="estimateStorageCost"
      />
    </section>
  </main>
</template>

<style>
/* The gallery's page: a narrow centred column, so the layout checks run at a realistic width. */
main {
  /* The design tokens' narrow content width, centred, with the small padding step. */
  max-width: var(--mw-content-narrow);
  margin: 0 auto;
  padding: var(--space-xs);
}
/* The badge list: one badge per row, left-aligned. */
.list {
  /* A column of badges, each as wide as its text, with the extra-small gap between them. */
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2xs);
  /* A plain list: no bullets, no indent. */
  padding: 0;
  list-style: none;
}
</style>
