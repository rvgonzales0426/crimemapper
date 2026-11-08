<script setup>
import { computed, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'

// Day-of-week x hour-of-day counts. Sequential single-hue (blue) ramp; on this
// dark surface, low counts sit near the surface and high counts are brightest.
const props = defineProps({
  // [{ dow: 1..7 (Mon..Sun), hour: 0..23, count }]
  cells: { type: Array, required: true },
  unit: { type: String, default: 'incidents' },
})

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

// Blue ramp steps (dark -> light), from the reference sequential palette.
const RAMP = ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6', '#cde2fb']

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const RAMP_RGB = RAMP.map(hexToRgb)

function rampColor(t) {
  const pos = Math.min(1, Math.max(0, t)) * (RAMP_RGB.length - 1)
  const i = Math.min(RAMP_RGB.length - 2, Math.floor(pos))
  const f = pos - i
  const [a, b] = [RAMP_RGB[i], RAMP_RGB[i + 1]]
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(',')})`
}

const lookup = computed(() => {
  const m = new Map()
  for (const c of props.cells) m.set(`${c.dow}-${c.hour}`, c.count)
  return m
})
const max = computed(() => Math.max(1, ...props.cells.map((c) => c.count)))

const rows = computed(() =>
  DAYS.map((day, di) => ({
    day,
    dow: di + 1,
    cells: HOURS.map((hour) => {
      const count = lookup.value.get(`${di + 1}-${hour}`) || 0
      return { hour, count, color: count ? rampColor(count / max.value) : null }
    }),
  }))
)

const pad = (n) => String(n).padStart(2, '0')
const tip = ref(null)
function show(e, row, cell) {
  const r = e.currentTarget.getBoundingClientRect()
  tip.value = {
    x: r.left + r.width / 2,
    y: r.top,
    value: `${cell.count.toLocaleString()} ${props.unit}`,
    label: `${DAY_NAMES[row.dow - 1]}, ${pad(cell.hour)}:00–${pad(cell.hour)}:59`,
  }
}
</script>

<template>
  <div class="heatmap">
    <div class="grid" role="table" aria-label="Incidents by day of week and hour">
      <template v-for="row in rows" :key="row.day">
        <span class="day" role="rowheader">{{ row.day }}</span>
        <span
          v-for="cell in row.cells"
          :key="cell.hour"
          class="cell"
          :class="{ empty: !cell.count }"
          :style="cell.color ? { background: cell.color } : null"
          role="cell"
          tabindex="0"
          :aria-label="`${row.day} ${pad(cell.hour)}:00, ${cell.count}`"
          @pointerenter="show($event, row, cell)"
          @pointerleave="tip = null"
          @focus="show($event, row, cell)"
          @blur="tip = null"
        ></span>
      </template>
      <span></span>
      <span v-for="h in HOURS" :key="`h-${h}`" class="hour">{{ h % 3 === 0 ? pad(h) : '' }}</span>
    </div>

    <div class="legend">
      <span>0</span>
      <span class="legend-bar" :style="{ background: `linear-gradient(to right, ${RAMP.join(', ')})` }"></span>
      <span>{{ max }} {{ unit }} (busiest slot)</span>
    </div>
    <ChartTooltip :tip="tip" />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 34px repeat(24, minmax(0, 1fr));
  gap: 2px;
}

.day,
.hour {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.day {
  display: flex;
  align-items: center;
}

.hour {
  text-align: left;
  padding-top: 4px;
}

.cell {
  height: 22px;
  border-radius: 3px;
  outline: none;
}

.cell.empty {
  background: #232b3b;
}

.cell:hover,
.cell:focus-visible {
  box-shadow: 0 0 0 2px var(--text);
}

.legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-muted);
}

.legend-bar {
  width: 140px;
  height: 8px;
  border-radius: 4px;
}
</style>
