<script setup lang="ts">
// A line of muted help text under a control or beside a figure.
</script>

<template>
  <p class="wru-hint"><slot /></p>
</template>

<style scoped>
.wru-hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--muted);
}
</style>
