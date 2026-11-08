<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useKnoxStore } from '../stores/knox'
import ChartTooltip from './charts/ChartTooltip.vue'

const store = useKnoxStore()
const { settings, result, loading, error } = storeToRefs(store)

const collapsed = ref(false)

const DISTANCES = [50, 100, 200]
const DAYS = [7, 14, 30]
const ITERATIONS = [99, 999]

// Near Repeat Calculator convention: highlight cells that are significant AND
// at least 20% above chance. The "More than" row/column is never highlighted.
const P_MAX = 0.05
const RATIO_MIN = 1.2

function isSignificant(r, c) {
  const res = result.value
  if (!res || r === res.table.length - 1 || c === res.columns.length - 1) return false
  const cell = res.table[r].cells[c]
  return cell.ratio != null && cell.p <= P_MAX && cell.ratio >= RATIO_MIN
}

// Tint strength grows with the ratio (1.2 -> faint, 3+ -> strong).
function cellStyle(r, c) {
  if (!isSignificant(r, c)) return null
  const ratio = result.value.table[r].cells[c].ratio
  const a = Math.min(0.55, 0.18 + (ratio - RATIO_MIN) * 0.2)
  return { background: `rgba(217, 89, 38, ${a.toFixed(2)})` }
}

// One-sentence reading of the table. A near repeat is about what follows soon
// after, so report the earliest significant time band, closest distance first.
const summary = computed(() => {
  const res = result.value
  if (!res) return ''
  let best = null
  for (let c = 0; c < res.columns.length && !best; c++) {
    for (let r = 0; r < res.table.length && !best; r++) {
      if (isSignificant(r, c)) best = { row: res.table[r], c, cell: res.table[r].cells[c] }
    }
  }
  if (!best) return 'No significant near-repeat pattern at these settings.'
  const where = best.row.label === 'Same location' ? 'at the same location' : `${best.row.label} apart`
  return `Near-repeat pattern: incident pairs ${where} and ${res.columns[best.c]} apart occur ${best.cell.ratio.toFixed(1)}× more often than chance (p ≤ ${best.cell.p.toFixed(2)}).`
})

const tip = ref(null)
function showTip(e, r, c) {
  const res = result.value
  const cell = res.table[r].cells[c]
  const rect = e.currentTarget.getBoundingClientRect()
  tip.value = {
    x: rect.left + rect.width / 2,
    y: rect.top,
    value: cell.ratio == null ? 'No pairs expected' : `Knox ratio ${cell.ratio.toFixed(2)}`,
    label: `${res.table[r].label} · ${res.columns[c]}`,
    sub: `${cell.observed.toLocaleString()} observed vs ${cell.expected.toFixed(1)} expected · p = ${cell.p.toFixed(3)}`,
  }
}
</script>

<template>
  <section class="knox-panel" :class="{ collapsed }">
    <header class="panel-head">
      <div>
        <h2>Knox near-repeat test</h2>
        <span v-if="result" class="meta">
          {{ result.n.toLocaleString() }} incidents · {{ result.clusters.length }} clusters ·
          {{ result.iterations }} permutations
        </span>
      </div>
      <button class="icon-btn" :aria-label="collapsed ? 'Expand' : 'Collapse'" @click="collapsed = !collapsed">
        {{ collapsed ? '▴' : '▾' }}
      </button>
    </header>

    <div v-show="!collapsed" class="panel-body" :class="{ stale: loading }">
      <div class="settings">
        <label>
          <span>Distance band</span>
          <select :value="settings.spatialBand" @change="store.updateSettings({ spatialBand: +$event.target.value })">
            <option v-for="d in DISTANCES" :key="d" :value="d">{{ d }} m</option>
          </select>
        </label>
        <label>
          <span>Time band</span>
          <select :value="settings.temporalBand" @change="store.updateSettings({ temporalBand: +$event.target.value })">
            <option v-for="d in DAYS" :key="d" :value="d">{{ d }} days</option>
          </select>
        </label>
        <label>
          <span>Permutations</span>
          <select :value="settings.iterations" @change="store.updateSettings({ iterations: +$event.target.value })">
            <option v-for="n in ITERATIONS" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            :checked="settings.includeTraffic"
            @change="store.updateSettings({ includeTraffic: $event.target.checked })"
          />
          <span>Include vehicular accidents</span>
        </label>
      </div>

      <div v-if="error" class="error">⚠ {{ error }}</div>
      <p v-else-if="loading && !result" class="muted">Running test…</p>

      <template v-if="result">
        <p class="summary">{{ summary }}</p>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th v-for="col in result.columns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, r) in result.table" :key="row.label">
                <th>{{ row.label }}</th>
                <td
                  v-for="(cell, c) in row.cells"
                  :key="c"
                  :style="cellStyle(r, c)"
                  :class="{ sig: isSignificant(r, c) }"
                  tabindex="0"
                  @pointerenter="showTip($event, r, c)"
                  @pointerleave="tip = null"
                  @focus="showTip($event, r, c)"
                  @blur="tip = null"
                >
                  {{ cell.ratio == null ? '–' : cell.ratio.toFixed(2) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="legend">
          <span class="swatch"></span>
          Significant near-repeat (p ≤ {{ P_MAX }}, ratio ≥ {{ RATIO_MIN }}). Ratio = observed pairs ÷
          pairs expected by chance. Map clusters link incidents within {{ result.options.linkDistance }} m
          and {{ result.options.linkDays }} days.
        </p>
      </template>
    </div>
    <ChartTooltip :tip="tip" />
  </section>
</template>

<style scoped>
/* Positioned by the map's .analysis-panels stack. */
.knox-panel {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  background: var(--sidebar);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
}

.panel-head h2 {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.meta {
  font-size: 11px;
  color: var(--text-muted);
}

.icon-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  width: 26px;
  height: 26px;
  cursor: pointer;
  flex-shrink: 0;
}

.icon-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.panel-body {
  padding: 0 16px 14px;
  transition: opacity 0.2s;
}

.panel-body.stale {
  opacity: 0.55;
}

.settings {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 12px;
}

.settings label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.settings select {
  padding: 5px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
}

.settings label.check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  text-transform: none;
  letter-spacing: 0;
  font-size: 12px;
  padding-bottom: 5px;
  cursor: pointer;
}

.summary {
  font-size: 12px;
  color: var(--text);
  margin-bottom: 10px;
  line-height: 1.5;
}

.muted {
  font-size: 12px;
  color: var(--text-muted);
}

.error {
  font-size: 12px;
  color: #f85149;
  margin-bottom: 8px;
  word-break: break-word;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 2px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

th {
  font-weight: 500;
  color: var(--text-muted);
  text-align: right;
  padding: 3px 6px;
  white-space: nowrap;
}

thead th {
  text-align: center;
  font-size: 10px;
}

td {
  text-align: center;
  padding: 5px 4px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 3px;
  outline: none;
  cursor: default;
}

td.sig {
  color: var(--text);
  font-weight: 700;
}

td:hover,
td:focus-visible {
  box-shadow: inset 0 0 0 1px var(--text-muted);
}

.legend {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.swatch {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  margin-top: 3px;
  border-radius: 2px;
  background: rgba(217, 89, 38, 0.5);
}
</style>
