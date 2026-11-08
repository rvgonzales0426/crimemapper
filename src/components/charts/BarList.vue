<script setup>
import { computed, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'

// Ranked horizontal bars: label, bar, value at the tip. One series, one colour.
const props = defineProps({
  // [{ key, label, value, sub? }]
  items: { type: Array, required: true },
  total: { type: Number, default: 0 }, // for the share shown in the tooltip
  unit: { type: String, default: 'incidents' },
  clickable: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)))

const tip = ref(null)
function showTip(e, item) {
  const r = e.currentTarget.getBoundingClientRect()
  const share = props.total ? `${((item.value / props.total) * 100).toFixed(1)}% of total` : ''
  tip.value = {
    x: r.left + Math.min(r.width / 2, 160),
    y: r.top,
    value: `${item.value.toLocaleString()} ${props.unit}`,
    label: item.label,
    sub: [item.sub, share].filter(Boolean).join(' · '),
  }
}
</script>

<template>
  <ul class="bar-list">
    <li
      v-for="item in items"
      :key="item.key"
      class="bar-row"
      :class="{ clickable }"
      :tabindex="clickable ? 0 : -1"
      @pointerenter="showTip($event, item)"
      @pointerleave="tip = null"
      @focus="showTip($event, item)"
      @blur="tip = null"
      @click="clickable && emit('select', item)"
      @keydown.enter="clickable && emit('select', item)"
    >
      <span class="bar-label">{{ item.label }}</span>
      <span class="bar-track">
        <span class="bar-fill" :style="{ width: `${(item.value / max) * 100}%` }"></span>
        <span class="bar-value">{{ item.value.toLocaleString() }}</span>
      </span>
    </li>
  </ul>
  <ChartTooltip :tip="tip" />
</template>

<style scoped>
.bar-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(0, 42%) 1fr;
  align-items: center;
  gap: 12px;
  padding: 5px 6px;
  border-radius: 6px;
  outline: none;
}

.bar-row:hover,
.bar-row:focus-visible {
  background: rgba(255, 255, 255, 0.04);
}

.bar-row.clickable {
  cursor: pointer;
}

.bar-label {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-track {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* Square at the baseline, 4px rounded data-end. */
.bar-fill {
  height: 12px;
  min-width: 2px;
  background: #3987e5;
  border-radius: 0 4px 4px 0;
  transition: width 0.25s ease;
}

.bar-row:hover .bar-fill,
.bar-row:focus-visible .bar-fill {
  background: #5598e7;
}

.bar-value {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
