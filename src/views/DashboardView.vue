<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDashboardStore } from '../stores/dashboard'
import { useIncidentsStore } from '../stores/incidents'
import { useAuthStore } from '../stores/auth'
import StatTile from '../components/charts/StatTile.vue'
import BarList from '../components/charts/BarList.vue'
import ColumnChart from '../components/charts/ColumnChart.vue'
import HourHeatmap from '../components/charts/HourHeatmap.vue'
import StackedBar from '../components/charts/StackedBar.vue'

const store = useDashboardStore()
const { stats, loading, error, period, category, years, dateRange } = storeToRefs(store)
const incidentsStore = useIncidentsStore()
const router = useRouter()
// Bars drill into the Incidents page only for roles that can open it.
const canDrill = useAuthStore().canAccess('/incidents')

onMounted(() => store.fetchDashboard())

const CATEGORIES = [
  { value: '', label: 'All incidents' },
  { value: 'crime', label: 'Crimes' },
  { value: 'traffic', label: 'Vehicular accidents' },
]

// --- KPI tiles ----------------------------------------------------------
const pctChange = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null)
const rate = (part, total) => (total ? (part / total) * 100 : 0)
const fmtPct = (v) => `${v.toFixed(1)}%`

const deltaLabel = computed(() => (period.value === 'all' ? '' : `vs ${period.value - 1}`))

const tiles = computed(() => {
  const s = stats.value
  if (!s) return []
  const p = s.prev
  const out = [
    {
      label: 'Total incidents',
      value: s.total.toLocaleString(),
      delta: p ? pctChange(s.total, p.total) : null,
    },
  ]
  if (!category.value) {
    out.push(
      { label: 'Crimes', value: s.crime.toLocaleString(), delta: p ? pctChange(s.crime, p.crime) : null },
      {
        label: 'Vehicular accidents',
        value: s.traffic.toLocaleString(),
        delta: p ? pctChange(s.traffic, p.traffic) : null,
      }
    )
  }
  out.push(
    {
      label: 'Crime clearance efficiency',
      value: fmtPct(rate(s.cleared, s.total)),
      hint: 'Cleared + solved ÷ total',
      delta: p?.total ? rate(s.cleared, s.total) - rate(p.cleared, p.total) : null,
      deltaUnit: 'pts',
      upIsGood: true,
    },
    {
      label: 'Crime solution efficiency',
      value: fmtPct(rate(s.solved, s.total)),
      hint: 'Solved ÷ total',
      delta: p?.total ? rate(s.solved, s.total) - rate(p.solved, p.total) : null,
      deltaUnit: 'pts',
      upIsGood: true,
    }
  )
  return out
})

// --- Charts -------------------------------------------------------------
// Colours follow the status, not its rank, so filtering never repaints them.
const STATUS_COLORS = {
  Solved: '#3987e5',
  Cleared: '#199e70',
  'Under Investigation': '#d95926',
}
const STATUS_ORDER = ['Solved', 'Cleared', 'Under Investigation']

const statusSegments = computed(() => {
  const by = new Map((stats.value?.byStatus || []).map((s) => [s.label, s.count]))
  const known = STATUS_ORDER.map((label) => ({
    key: label,
    label,
    value: by.get(label) || 0,
    color: STATUS_COLORS[label],
  }))
  const other = [...by].filter(([l]) => !STATUS_ORDER.includes(l)).reduce((s, [, n]) => s + n, 0)
  return other ? [...known, { key: 'other', label: 'Other', value: other, color: '#6e7681' }] : known
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const monthPoints = computed(() => {
  const list = stats.value?.byMonth || []
  const long = list.length > 12
  return list.map((m) => {
    const [y, mo] = m.month.split('-').map(Number)
    let tick = ''
    if (!long) tick = MONTHS[mo - 1]
    else if (mo === 1) tick = String(y)
    else if (mo === 7) tick = 'Jul'
    return { key: m.month, label: `${MONTHS_LONG[mo - 1]} ${y}`, tick, value: m.count }
  })
})

// "THEFT  - RPC Art. 308" -> "Theft" (statute shown in the tooltip instead).
function offenseName(raw) {
  const name = raw.split(' - ')[0].replace(/\s+/g, ' ').trim().toLowerCase()
  return name.charAt(0).toUpperCase() + name.slice(1)
}
function statute(raw) {
  const i = raw.indexOf(' - ')
  return i === -1 ? '' : raw.slice(i + 3).replace(/\s+/g, ' ').trim()
}

const barangayItems = computed(() =>
  // Source data mixes case ("STO. NIñO"); display uppercase, filter by the raw value.
  (stats.value?.byBarangay || []).map((b) => ({
    key: b.label,
    label: b.label.toUpperCase(),
    value: b.count,
  }))
)
const offenseItems = computed(() =>
  (stats.value?.byOffense || []).map((o) => ({
    key: o.label,
    label: offenseName(o.label),
    value: o.count,
    sub: [statute(o.label), o.offenseType].filter(Boolean).join(' · '),
    raw: o.label,
  }))
)

// Jump to the Incidents table, pre-filtered to the clicked bar + period.
function openIncidents(patch) {
  incidentsStore.applyFilters({
    search: '',
    barangay: '',
    offense: '',
    caseStatus: '',
    ...dateRange.value,
    ...patch,
  })
  router.push('/incidents')
}

const periodLabel = computed(() => (period.value === 'all' ? 'All time' : String(period.value)))
</script>

<template>
  <div class="dashboard">
    <!-- Filters scope everything below them. -->
    <div class="filter-row">
      <div class="segmented" role="group" aria-label="Period">
        <button :class="{ on: period === 'all' }" @click="store.setPeriod('all')">All time</button>
        <button v-for="y in years" :key="y" :class="{ on: period === y }" @click="store.setPeriod(y)">
          {{ y }}
        </button>
      </div>
      <div class="segmented" role="group" aria-label="Category">
        <button
          v-for="c in CATEGORIES"
          :key="c.value"
          :class="{ on: category === c.value }"
          @click="store.setCategory(c.value)"
        >
          {{ c.label }}
        </button>
      </div>
      <span v-if="loading" class="loading-note">Updating…</span>
    </div>

    <div v-if="error" class="error-box">⚠ {{ error }}</div>

    <!-- Hold the previous render at reduced opacity while refetching. -->
    <div v-if="stats" class="content" :class="{ stale: loading }">
      <div v-if="stats.total === 0" class="empty-card">No incidents in this period.</div>

      <template v-else>
        <section class="kpis">
          <StatTile
            v-for="t in tiles"
            :key="t.label"
            :label="t.label"
            :value="t.value"
            :hint="t.hint"
            :delta="t.delta"
            :delta-unit="t.deltaUnit || '%'"
            :delta-label="deltaLabel"
            :up-is-good="!!t.upIsGood"
          />
        </section>

        <section class="row two-one">
          <article class="card">
            <header>
              <h2>Incidents per month</h2>
              <span class="card-sub">{{ periodLabel }} · by date committed</span>
            </header>
            <ColumnChart :points="monthPoints" />
          </article>
          <article class="card">
            <header>
              <h2>Case status</h2>
              <span class="card-sub">{{ stats.total.toLocaleString() }} incidents</span>
            </header>
            <StackedBar :segments="statusSegments" />
          </article>
        </section>

        <section class="row halves">
          <article class="card">
            <header>
              <h2>Top barangays</h2>
              <span class="card-sub">Click a bar to open those incidents</span>
            </header>
            <BarList
              :items="barangayItems"
              :total="stats.total"
              :clickable="canDrill"
              @select="(i) => openIncidents({ barangay: i.key })"
            />
          </article>
          <article class="card">
            <header>
              <h2>Top offenses</h2>
              <span class="card-sub">Click a bar to open those incidents</span>
            </header>
            <BarList
              :items="offenseItems"
              :total="stats.total"
              :clickable="canDrill"
              @select="(i) => openIncidents({ offense: i.raw })"
            />
          </article>
        </section>

        <section class="card">
          <header>
            <h2>When incidents happen</h2>
            <span class="card-sub">Day of week × hour committed · use for patrol scheduling</span>
          </header>
          <HourHeatmap :cells="stats.byDowHour" />
        </section>
      </template>
    </div>

    <div v-else-if="loading" class="empty-card">Loading dashboard…</div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* --- Filters --- */
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.segmented button {
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.segmented button:hover {
  color: var(--text);
}

.segmented button.on {
  background: rgba(232, 93, 4, 0.15);
  color: var(--accent);
}

.loading-note {
  font-size: 12px;
  color: var(--text-muted);
}

.error-box {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid rgba(248, 81, 73, 0.4);
  color: #f85149;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
}

/* --- Layout --- */
.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: opacity 0.2s;
}

.content.stale {
  opacity: 0.55;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.row {
  display: grid;
  gap: 16px;
}

.row.two-one {
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
}

.row.halves {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .row.two-one,
  .row.halves {
    grid-template-columns: minmax(0, 1fr);
  }
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px;
  min-width: 0;
}

.card header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 14px;
}

.card h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.card-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.empty-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
}
</style>
