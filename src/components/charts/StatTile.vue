<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  hint: { type: String, default: '' },
  // Signed change vs the previous period, in the tile's own unit; null hides it.
  delta: { type: Number, default: null },
  deltaUnit: { type: String, default: '%' }, // '%' or 'pts'
  deltaLabel: { type: String, default: '' }, // e.g. "vs 2024"
  upIsGood: { type: Boolean, default: false },
})

const deltaState = computed(() => {
  if (props.delta == null || !Number.isFinite(props.delta)) return null
  const rounded = Math.round(props.delta * 10) / 10
  if (rounded === 0) return { text: `No change ${props.deltaLabel}`, tone: 'flat', arrow: '' }
  const up = rounded > 0
  const sign = up ? '+' : '−'
  return {
    text: `${sign}${Math.abs(rounded)}${props.deltaUnit === '%' ? '%' : ' pts'} ${props.deltaLabel}`,
    tone: up === props.upIsGood ? 'good' : 'bad',
    arrow: up ? '▲' : '▼',
  }
})
</script>

<template>
  <div class="stat-tile">
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value">{{ value }}</span>
    <span v-if="deltaState" class="stat-delta" :class="deltaState.tone">
      <span v-if="deltaState.arrow" aria-hidden="true">{{ deltaState.arrow }}</span>
      {{ deltaState.text }}
    </span>
    <span v-if="hint" class="stat-hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text);
}

.stat-delta {
  font-size: 12px;
  font-weight: 600;
}

.stat-delta.good {
  color: #0ca30c;
}

.stat-delta.bad {
  color: #f85149;
}

.stat-delta.flat {
  color: var(--text-muted);
}

.stat-hint {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
