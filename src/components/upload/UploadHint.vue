<script setup lang="ts">
// File: UploadHint, a line of muted help text under a control or beside a figure. A single `<p>` root with one default slot: the parent passes `class` and `id` straight through.
// A line of muted help text under a control or beside a figure.
</script>

<template>
  <p class="wru-hint"><slot /></p>
</template>

<style scoped>
/* Small muted text with no margin of its own (the parent's gap spaces it). */
.wru-hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--muted);
}
</style>
