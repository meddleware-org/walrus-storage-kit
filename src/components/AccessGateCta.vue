<script setup lang="ts">
// File: AccessGateCta, the purchase prompt of a gated upload relay. Props: `gateConfigured`, `hasAccess`, `busy`, `terms`, `termsError`, `purchaseError`. Emits: `purchase`.
// Related: `composables/useAccessGate.ts` (where the props come from and which `purchase` the parent calls), `WalrusUpload.vue` (renders it), `@meddleware/ui` (`UiCard`, `UiNotice`).
// "Purchase access" call-to-action, shown when the upload relay is NFT-gated and the
// connected wallet does not (yet) hold the access NFT. Presentational + a single emit;
// the parent owns the actual purchase (via `useAccessGate().purchase`). It shows the terms read
// from the chain (`useAccessGate().terms`) before the wallet opens: the exact payment, who
// receives which part, the network and what the pass is. Without terms the button stays disabled.
import { computed } from 'vue'
import { UiButton, UiCard, UiLiveStatus, UiNotice } from '@meddleware/ui'
import type { PurchaseTerms } from '../composables/useAccessGate.js'
import { formatCoinExact } from '../lib/relay.js'

const props = defineProps<{
  /** Whether a gate is configured for this network. */
  gateConfigured: boolean
  /** Ownership result: null = checking, true/false = decided. */
  hasAccess: boolean | null
  /** Whether a purchase is in flight. */
  busy?: boolean
  /** The purchase terms read from the chain (`useAccessGate().terms`); `null` until they are read. */
  terms: PurchaseTerms | null
  /** Why the terms could not be read, in plain words for the person (`useAccessGate().termsError`, shown as given). */
  termsError?: string | null
  /** Why the last purchase did not complete, in plain words (`useAccessGate().purchaseError`, shown as given). */
  purchaseError?: string | null
}>()

/** The one event: the person pressed the purchase button (the parent buys the pass). */
const emit = defineEmits<{ (e: 'purchase'): void }>()

// (No HTML comment sits before the template's root card: a comment next to the root element would make the component a fragment in a development build.)

/** The prompt shows only for a configured gate whose ownership check came back negative (not while it is still checking). */
const show = computed(() => props.gateConfigured && props.hasAccess === false)
/** The button works only with terms read from the chain, an unpaused gate and no purchase in flight. */
const canBuy = computed(() => props.terms !== null && !props.terms.paused && !props.busy)

/** An amount in MIST as exact SUI text (the digits are never passed through a float). */
function sui(mist: bigint): string {
  return formatCoinExact(mist, 'SUI')
}

/** What the pass is, in words: its uses (or unlimited) and whether it can be transferred. */
function passLabel(t: PurchaseTerms): string {
  const uses = t.defaultUses === 0n ? 'unlimited uses' : `${t.defaultUses} ${t.defaultUses === 1n ? 'use' : 'uses'}`
  return `${uses}, ${t.soulbound ? 'soulbound (cannot be transferred)' : 'transferable'}`
}
</script>

<template>
  <UiCard v-if="show" title="Access pass required" class="wru-cta">
    <p>This upload relay is restricted to access-pass holders. Purchase a pass to upload through it.</p>

    <!-- Why the terms could not be read (plain words), and a polite live message while they are being read. -->
    <UiNotice v-if="termsError" type="error" :message="termsError" />
    <UiLiveStatus label="Pass price" :message="!termsError && !terms ? 'Reading the pass price from the chain…' : ''" />
    <!-- A description list: each label is paired with its value, and the addresses wrap instead of overflowing. -->
    <dl v-if="terms" class="wru-terms">
      <dt>Network</dt>
      <dd>{{ terms.network }}</dd>
      <dt>You pay</dt>
      <dd>{{ sui(terms.priceMist) }} (plus network gas)</dd>
      <dt>Gate owner receives</dt>
      <dd>
        {{ sui(terms.operator.mist) }}
        <code class="wru-terms__addr">{{ terms.operator.address }}</code>
      </dd>
      <dt>Platform fee</dt>
      <dd>
        {{ sui(terms.platform.mist) }}
        <code class="wru-terms__addr">{{ terms.platform.address }}</code>
      </dd>
      <dt>Pass</dt>
      <dd>{{ passLabel(terms) }}</dd>
    </dl>

    <!-- A paused gate cannot be bought from; the purchase's own failure is shown as given. -->
    <UiNotice v-if="terms?.paused" type="warning" message="Purchases from this gate are paused right now." />
    <UiNotice v-if="purchaseError" type="error" :message="purchaseError" />

    <!-- Disabled until the terms are known, so the wallet never opens for a price the person has not seen. -->
    <UiButton :busy="busy" :disabled="!canBuy" @click="emit('purchase')">
      Purchase access<template v-if="terms"> ({{ sui(terms.priceMist) }})</template>
    </UiButton>
  </UiCard>
</template>

<style scoped>
/* The card is a column with the small spacing step between its parts (tokens only). */
.wru-cta {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}
.wru-cta > .mw-btn {
  align-self: start;
}
/* The paragraph and the live region carry no margin of their own: the gap above spaces them. */
.wru-cta p,
.wru-cta .mw-live {
  margin: 0;
}
/* The terms as a two-column grid: labels sized to their text, values taking the rest. */
.wru-terms {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-3xs) var(--space-xs);
  margin: 0;
}
/* Labels are set apart by weight. */
.wru-terms dt {
  font-weight: var(--font-weight-semibold);
}
/* `min-width: 0` lets a long address shrink inside the grid cell instead of widening the card. */
.wru-terms dd {
  margin: 0;
  min-width: 0;
}
/* An address on its own line, smaller, breaking anywhere so it never overflows on a narrow screen. */
.wru-terms__addr {
  display: block;
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}
</style>
