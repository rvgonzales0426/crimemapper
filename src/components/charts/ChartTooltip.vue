<script setup>
// Floating readout shared by the dashboard charts. Positioned in viewport
// coordinates (fixed) so it never gets clipped by a card's overflow.
defineProps({
  // { x, y, value, label, sub } or null when hidden
  tip: { type: Object, default: null },
})
</script>

<template>
  <div
    v-if="tip"
    class="chart-tooltip"
    :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
    role="status"
  >
    <span class="tip-value">{{ tip.value }}</span>
    <span class="tip-label">{{ tip.label }}</span>
    <span v-if="tip.sub" class="tip-sub">{{ tip.sub }}</span>
  </div>
</template>

<style scoped>
.chart-tooltip {
  position: fixed;
  z-index: 2000;
  transform: translate(-50%, calc(-100% - 10px));
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 280px;
  padding: 8px 10px;
  background: #0d1117;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.tip-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.tip-label {
  font-size: 12px;
  color: var(--text-muted);
}

.tip-sub {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
