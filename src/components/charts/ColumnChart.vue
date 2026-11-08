<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'

// Single-series column chart over an ordered axis (months).
const props = defineProps({
  // [{ key, label, tick, value }] — `tick` is the axis label, or '' to skip it
  points: { type: Array, required: true },
  unit: { type: String, default: 'incidents' },
  height: { type: Number, default: 220 },
})

const PAD = { top: 12, right: 8, bottom: 26, left: 36 }
const root = ref(null)
const width = ref(600)
let ro = null
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    width.value = Math.max(240, entry.contentRect.width)
  })
  ro.observe(root.value)
})
onBeforeUnmount(() => ro && ro.disconnect())

const innerW = computed(() => width.value - PAD.left - PAD.right)
const innerH = computed(() => props.height - PAD.top - PAD.bottom)

// Round the axis maximum up to a clean step so ticks are whole numbers.
const scale = computed(() => {
  const raw = Math.max(1, ...props.points.map((p) => p.value))
  const step0 = raw / 4
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)
  const niceStep = Math.max(1, Math.ceil(step))
  return { max: niceStep * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * niceStep) }
})

const y = (v) => PAD.top + innerH.value - (v / scale.value.max) * innerH.value

const bars = computed(() => {
  const n = props.points.length || 1
  const band = innerW.value / n
  const barW = Math.max(2, Math.min(24, band - 2))
  return props.points.map((p, i) => {
    const cx = PAD.left + band * i + band / 2
    const top = y(p.value)
    const h = PAD.top + innerH.value - top
    return { ...p, cx, band, x: cx - barW / 2, w: barW, top, h }
  })
})

// Square at the baseline, 4px rounded top (radius shrinks for short bars).
function barPath(b) {
  if (b.h <= 0) return ''
  const r = Math.min(4, b.w / 2, b.h)
  const base = b.top + b.h
  return `M${b.x},${base} V${b.top + r} Q${b.x},${b.top} ${b.x + r},${b.top} H${b.x + b.w - r} Q${b.x + b.w},${b.top} ${b.x + b.w},${b.top + r} V${base} Z`
}

const active = ref(null)
const tip = ref(null)
function show(e, b) {
  active.value = b.key
  const r = root.value.getBoundingClientRect()
  tip.value = {
    x: r.left + b.cx,
    y: r.top + Math.min(b.top, PAD.top + innerH.value - 4),
    value: `${b.value.toLocaleString()} ${props.unit}`,
    label: b.label,
  }
}
function hide() {
  active.value = null
  tip.value = null
}
</script>

<template>
  <div ref="root" class="column-chart">
    <svg :width="width" :height="height" role="img" :aria-label="`Column chart, ${points.length} periods`">
      <!-- gridlines + y ticks -->
      <g v-for="t in scale.ticks" :key="t">
        <line class="grid" :x1="PAD.left" :x2="width - PAD.right" :y1="y(t)" :y2="y(t)" />
        <text class="tick" :x="PAD.left - 6" :y="y(t)" dy="0.32em" text-anchor="end">{{ t }}</text>
      </g>

      <path
        v-for="b in bars"
        :key="b.key"
        class="bar"
        :class="{ active: active === b.key }"
        :d="barPath(b)"
      />

      <text
        v-for="b in bars.filter((b) => b.tick)"
        :key="`x-${b.key}`"
        class="tick"
        :x="b.cx"
        :y="height - 8"
        text-anchor="middle"
      >{{ b.tick }}</text>

      <!-- Full-height hit areas: the pointer only has to be in the column's band. -->
      <rect
        v-for="b in bars"
        :key="`hit-${b.key}`"
        class="hit"
        :x="b.cx - b.band / 2"
        :y="PAD.top"
        :width="b.band"
        :height="innerH"
        tabindex="0"
        @pointerenter="show($event, b)"
        @pointerleave="hide"
        @focus="show($event, b)"
        @blur="hide"
      />
    </svg>
    <ChartTooltip :tip="tip" />
  </div>
</template>

<style scoped>
.column-chart {
  width: 100%;
  overflow: hidden;
}

svg {
  display: block;
}

.grid {
  stroke: #2a3140;
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.tick {
  font-size: 10px;
  fill: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.bar {
  fill: #3987e5;
  transition: fill 0.12s;
}

.bar.active {
  fill: #6da7ec;
}

.hit {
  fill: transparent;
  outline: none;
  cursor: default;
}
</style>
