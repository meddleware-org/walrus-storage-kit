<script setup lang="ts">
// File: TipConfigBadge, a small status badge for one upload relay. Role: presentational; it asks `probeRelay` (a pure helper) for the relay's reachability and tip and draws a `UiBadge`.
// No wallet, no `@mysten/walrus`. Props: `host`. Related: `lib/relay.ts` (`probeRelay`, `formatCoinExact`), `WalrusUpload.vue` (shows one per relay).
// Reads a relay's `/v1/tip-config` and shows the current per-upload tip + reachability.
// Purely presentational; uses the pure `probeRelay` helper (no wallet, no @mysten/walrus).
import { computed, ref, onMounted, watch } from 'vue'
import { UiBadge, type BadgeTone } from '@meddleware/ui'
import { formatCoinExact, probeRelay, type RelayHealth } from '../lib/relay.js'

const props = defineProps<{
  /** The relay host URL to probe (e.g. `https://sui-walrus-storage-relay.example.com`). */
  host: string
}>()

/** True while a probe is in flight. */
const loading = ref(true)
/** Whether the relay answered. */
const accessible = ref(false)
/** Set when `host` is not a usable relay URL: a configuration error, not an outage. */
const invalid = ref(false)
/** The tip the relay reported (a figure, its kind, and whether it could be read). */
const health = ref<Pick<RelayHealth, 'tip' | 'tipStatus' | 'tipKind'>>({ tip: null, tipStatus: 'unknown', tipKind: null })
// Each refresh takes a number; a slow answer for an earlier host (or an earlier call) is discarded when a newer one has started.
let generation = 0

/** Probes the current host and updates the badge's state; safe to call while an earlier probe is still running. */
async function refresh(): Promise<void> {
  const mine = ++generation
  loading.value = true
  invalid.value = false
  try {
    const result = await probeRelay(props.host)
    if (mine !== generation) return // the host changed while this probe was in flight
    accessible.value = result.accessible
    health.value = result
  } catch (e) {
    if (mine !== generation) return
    // A configuration fault a person cannot fix: plain words on the page, the detail for developers.
    console.error('TipConfigBadge: the relay address is not valid', e)
    accessible.value = false
    invalid.value = true
    health.value = { tip: null, tipStatus: 'unknown', tipKind: null }
  } finally {
    if (mine === generation) loading.value = false
  }
}

// Probe when the badge appears, and again whenever the host changes.
onMounted(refresh)
watch(() => props.host, refresh)

/** The tip as the relay reports it: a figure, no tip, or why there is no figure. Never "no tip" for an unknown one. */
function tipLabel(): string {
  const { tip, tipStatus, tipKind } = health.value
  if (tipStatus === 'none') return 'no tip'
  if (tipStatus === 'over-ceiling') return 'above the limit'
  if (tipStatus === 'known' && tip !== null) {
    return `${tipKind === 'linear' ? 'from ' : ''}${formatCoinExact(tip, 'SUI')}`
  }
  return 'unknown'
}

/** Down or invalid is a problem, an unreadable tip needs a look, a working relay is fine, and a check in flight is neutral. */
const tone = computed<BadgeTone>(() => {
  if (loading.value) return 'neutral'
  if (invalid.value || !accessible.value) return 'danger'
  return health.value.tipStatus === 'unknown' || health.value.tipStatus === 'over-ceiling' ? 'warn' : 'ok'
})
/**
 * The badge's state as a data attribute, for tests and styling hooks: loading, invalid, up or down. (The template is one `UiBadge`: its tone follows this state and its text says
 * what is wrong in plain words. There is deliberately no HTML comment before it: a comment next to the root element would make the component a fragment in a development build.)
 */
const state = computed(() => (loading.value ? 'loading' : invalid.value ? 'invalid' : accessible.value ? 'up' : 'down'))
</script>

<template>
  <UiBadge :tone="tone" :symbol="loading ? false : undefined" :data-state="state" :data-tip="state === 'up' ? health.tipStatus : undefined">
    <template v-if="loading">Checking relay…</template>
    <template v-else-if="invalid">Uploads are unavailable right now.</template>
    <template v-else-if="accessible">Relay online · tip {{ tipLabel() }}</template>
    <template v-else>Relay unreachable</template>
  </UiBadge>
</template>
