<script setup>
import { computed, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'

// Part-to-whole as one horizontal stacked bar + a legend that carries the
// values. Colours follow the entity (passed per segment), never its rank.
const props = defineProps({
  // [{ key, label, value, color }]
  segments: { type: Array, required: true },
  unit: { type: String, default: 'incidents' },
})

const total = computed(() => props.segments.reduce((s, x) => s + x.value, 0))
const pct = (v) => (total.value ? (v / total.value) * 100 : 0)

const tip = ref(null)
function show(e, seg) {
  const r = e.currentTarget.getBoundingClientRect()
  tip.value = {
    x: r.left + r.width / 2,
    y: r.top,
    value: `${seg.value.toLocaleString()} ${props.unit}`,
    label: `${seg.label} · ${pct(seg.value).toFixed(1)}%`,
  }
}
</script>

<template>
  <div class="stacked">
    <div class="bar" role="img" :aria-label="segments.map((s) => `${s.label} ${s.value}`).join(', ')">
      <span
        v-for="seg in segments.filter((s) => s.value > 0)"
        :key="seg.key"
        class="seg"
        :style="{ flexGrow: seg.value, background: seg.color }"
        tabindex="0"
        @pointerenter="show($event, seg)"
        @pointerleave="tip = null"
        @focus="show($event, seg)"
        @blur="tip = null"
      ></span>
    </div>

    <ul class="legend">
      <li v-for="seg in segments" :key="seg.key">
        <span class="swatch" :style="{ background: seg.color }"></span>
        <span class="legend-label">{{ seg.label }}</span>
        <span class="legend-value">{{ seg.value.toLocaleString() }}</span>
        <span class="legend-pct">{{ pct(seg.value).toFixed(1) }}%</span>
      </li>
    </ul>
    <ChartTooltip :tip="tip" />
  </div>
</template>

<style scoped>
/* 2px surface gap between segments; rounded only at the two outer ends. */
.bar {
  display: flex;
  gap: 2px;
  height: 16px;
  border-radius: 4px;
  overflow: hidden;
}

.seg {
  flex-basis: 0;
  min-width: 3px;
  outline: none;
  transition: filter 0.12s;
}

.seg:hover,
.seg:focus-visible {
  filter: brightness(1.2);
}

.legend {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.legend li {
  display: grid;
  grid-template-columns: 10px 1fr auto 52px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-label {
  color: var(--text);
}

.legend-value {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.legend-pct {
  color: var(--text-muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
