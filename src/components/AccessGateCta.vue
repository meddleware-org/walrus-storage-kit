<script setup lang="ts">
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

const emit = defineEmits<{ (e: 'purchase'): void }>()

const show = computed(() => props.gateConfigured && props.hasAccess === false)
const canBuy = computed(() => props.terms !== null && !props.terms.paused && !props.busy)

function sui(mist: bigint): string {
  return formatCoinExact(mist, 'SUI')
}

function passLabel(t: PurchaseTerms): string {
  const uses = t.defaultUses === 0n ? 'unlimited uses' : `${t.defaultUses} ${t.defaultUses === 1n ? 'use' : 'uses'}`
  return `${uses}, ${t.soulbound ? 'soulbound (cannot be transferred)' : 'transferable'}`
}
</script>

<template>
  <UiCard v-if="show" title="Access pass required" class="wru-cta">
    <p>This upload relay is restricted to access-pass holders. Purchase a pass to upload through it.</p>

    <UiNotice v-if="termsError" type="error" :message="termsError" />
    <UiLiveStatus label="Pass price" :message="!termsError && !terms ? 'Reading the pass price from the chain…' : ''" />
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

    <UiNotice v-if="terms?.paused" type="warning" message="Purchases from this gate are paused right now." />
    <UiNotice v-if="purchaseError" type="error" :message="purchaseError" />

    <UiButton :busy="busy" :disabled="!canBuy" @click="emit('purchase')">
      Purchase access<template v-if="terms"> ({{ sui(terms.priceMist) }})</template>
    </UiButton>
  </UiCard>
</template>

<style scoped>
.wru-cta {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}
.wru-cta > .mw-btn {
  align-self: start;
}
.wru-cta p,
.wru-cta .mw-live {
  margin: 0;
}
.wru-terms {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-3xs) var(--space-xs);
  margin: 0;
}
.wru-terms dt {
  font-weight: var(--font-weight-semibold);
}
.wru-terms dd {
  margin: 0;
  min-width: 0;
}
.wru-terms__addr {
  display: block;
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}
</style>
