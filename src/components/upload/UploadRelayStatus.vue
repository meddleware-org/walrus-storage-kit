<script setup lang="ts">
// The state of the upload relay, in words: a configuration error, the check in flight (an always-mounted live region), or a pass
// being required. With `choose`, it also lets the user pick between relays when more than one is available.
import { computed } from 'vue'
import { UiLiveStatus, UiNotice, UiSegmentedControl } from '@meddleware/ui'
import type { RelayOption } from '../../composables/useWalrusRelay.js'

const props = defineProps<{
  configError: string | null
  connected: boolean
  pending: boolean
  relays: RelayOption[]
  /** Offer the choice between relays (the options step); the review step only reports the state. */
  choose?: boolean
}>()

const host = defineModel<string>('host', { required: true })

const none = computed(() => props.connected && !props.pending && props.relays.length === 0)
const options = computed(() => props.relays.map((r) => ({ id: r.host, label: r.label })))
</script>

<template>
  <UiNotice v-if="configError" type="error" :message="`The relay settings are not valid, so uploads are unavailable: ${configError}`" />
  <UiLiveStatus label="Upload relay" :message="!configError && connected && pending ? 'Checking the upload relay…' : ''" />
  <UiNotice
    v-if="!configError && none"
    type="warning"
    message="An access pass is required to upload through this relay — purchase one above to continue."
  />
  <UiSegmentedControl v-if="choose && relays.length > 1" v-model="host" :options="options" label="Upload relay" :label-hidden="false" layout="wrap" />
</template>
