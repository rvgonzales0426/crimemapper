<script setup>
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useIncidentsStore } from '../stores/incidents'
import { useAuthStore } from '../stores/auth'
import IncidentCases from '../components/IncidentCases.vue'
import IncidentPersons from '../components/IncidentPersons.vue'
import SimilarIncidents from '../components/SimilarIncidents.vue'
import { supabase } from '../lib/supabase'
import { mapRow } from '../stores/incidents'

const store = useIncidentsStore()
const auth = useAuthStore()
const {
  incidents,
  loading,
  error,
  page,
  pageSize,
  totalCount,
  totalPages,
  filterOptions,
} = storeToRefs(store)

// Local filter models (bound to the inputs), seeded from the store so the inputs
// still match the active filters after navigating away and back.
const search = ref(store.filters.search)
const dateFrom = ref(store.filters.dateFrom)
const dateTo = ref(store.filters.dateTo)
const barangayFilter = ref(store.filters.barangay)
const offenseFilter = ref(store.filters.offense)
const statusFilter = ref(store.filters.caseStatus)

onMounted(() => {
  store.fetchFilterOptions()
  store.fetchIncidents()
})

let searchTimer
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(
    () => store.applyFilters({ search: search.value }),
    300
  )
}

function onFilterChange() {
  store.applyFilters({
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    barangay: barangayFilter.value,
    offense: offenseFilter.value,
    caseStatus: statusFilter.value,
  })
}

const hasActiveFilters = computed(
  () =>
    search.value ||
    dateFrom.value ||
    dateTo.value ||
    barangayFilter.value ||
    offenseFilter.value ||
    statusFilter.value
)

function clearFilters() {
  search.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  barangayFilter.value = ''
  offenseFilter.value = ''
  statusFilter.value = ''
  store.resetFilters()
}

const rangeStart = computed(() =>
  totalCount.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1
)
const rangeEnd = computed(() =>
  Math.min(page.value * pageSize.value, totalCount.value)
)

// --- Detail panel ---
const selected = ref(null)
function openDetail(incident) {
  selected.value = incident
}
function closeDetail() {
  selected.value = null
}
// Open an incident that may not be on the current page (e.g. a similar one).
async function openById(id) {
  const { data, error } = await supabase.from('incidents').select('*').eq('id', id).maybeSingle()
  if (!error && data) selected.value = mapRow(data)
}

function statusClass(status) {
  return (
    {
      // The data uses Solved / Cleared / Under Investigation; colours match the Dashboard.
      Solved: 'status-solved',
      'Under Investigation': 'status-investigating',
      'Filed in Court': 'status-filed',
      Resolved: 'status-resolved',
      Cleared: 'status-cleared',
      Closed: 'status-closed',
    }[status] || 'status-default'
  )
}

const detailFields = [
  { key: 'blotterno', label: 'Blotter No' },
  { key: 'dateCommitted', label: 'Date Committed' },
  { key: 'timeCommitted', label: 'Time Committed' },
  { key: 'dateReported', label: 'Date Reported' },
  { key: 'barangay', label: 'Barangay' },
  { key: 'street', label: 'Street' },
  { key: 'typeOfPlace', label: 'Type of Place' },
  { key: 'offense', label: 'Offense' },
  { key: 'offenseType', label: 'Offense Type' },
  { key: 'incidentType', label: 'Incident Type' },
  { key: 'modus', label: 'Modus' },
  { key: 'victimRaw', label: 'Victim' },
  { key: 'suspectRaw', label: 'Suspect' },
  { key: 'caseSolveType', label: 'Case Solve Type' },
]

const visibleDetailFields = computed(() =>
  selected.value
    ? detailFields.filter((f) => {
        const v = selected.value[f.key]
        return v !== null && v !== undefined && v !== ''
      })
    : []
)
</script>

<template>
  <div class="incidents">
    <!-- Filter bar -->
    <div class="filters">
      <div class="search-box">
        <span class="search-icon">⌕</span>
        <input
          v-model="search"
          type="text"
          placeholder="Search all fields…"
          class="search-input"
          @input="onSearch"
        />
      </div>

      <div class="filter-group">
        <label>From</label>
        <input v-model="dateFrom" type="date" class="control" @change="onFilterChange" />
      </div>
      <div class="filter-group">
        <label>To</label>
        <input v-model="dateTo" type="date" class="control" @change="onFilterChange" />
      </div>

      <div class="filter-group">
        <label>Barangay</label>
        <select v-model="barangayFilter" class="control" @change="onFilterChange">
          <option value="">All</option>
          <option v-for="b in filterOptions.barangays" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Offense</label>
        <select v-model="offenseFilter" class="control" @change="onFilterChange">
          <option value="">All</option>
          <option v-for="o in filterOptions.offenses" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Status</label>
        <select v-model="statusFilter" class="control" @change="onFilterChange">
          <option value="">All</option>
          <option v-for="s in filterOptions.caseStatuses" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>

      <button v-if="hasActiveFilters" class="clear-btn" @click="clearFilters">
        Clear
      </button>
    </div>

    <div class="result-count">
      <span v-if="loading">Loading…</span>
      <span v-else>Showing {{ rangeStart }}–{{ rangeEnd }} of {{ totalCount }} incidents</span>
    </div>

    <div v-if="error" class="error-box">⚠ {{ error }}</div>

    <!-- Table -->
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Blotter No</th>
            <th>Date</th>
            <th>Barangay</th>
            <th>Offense</th>
            <th>Incident Type</th>
            <th>Case Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="inc in incidents"
            :key="inc.id ?? inc.blotterno"
            class="row"
            :class="{ active: selected && selected.id === inc.id }"
            @click="openDetail(inc)"
          >
            <td class="mono">{{ inc.blotterno }}</td>
            <td>{{ inc.dateCommitted }}</td>
            <td>{{ inc.barangay }}</td>
            <td>{{ inc.offense }}</td>
            <td>{{ inc.incidentType }}</td>
            <td>
              <span class="badge" :class="statusClass(inc.caseStatus)">
                {{ inc.caseStatus }}
              </span>
            </td>
          </tr>
          <tr v-if="!loading && incidents.length === 0">
            <td colspan="6" class="empty">No incidents match your filters.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination">
      <button class="page-btn" :disabled="page <= 1 || loading" @click="store.prevPage()">
        ‹ Prev
      </button>
      <span class="page-info">Page {{ page }} of {{ totalPages }}</span>
      <button
        class="page-btn"
        :disabled="page >= totalPages || loading"
        @click="store.nextPage()"
      >
        Next ›
      </button>
    </div>

    <!-- Slide-in detail panel -->
    <Transition name="fade">
      <div v-if="selected" class="backdrop" @click="closeDetail"></div>
    </Transition>

    <Transition name="slide">
      <aside v-if="selected" class="detail-panel">
        <div class="detail-header">
          <div>
            <span class="detail-eyebrow">Incident Detail</span>
            <h2 class="detail-title">{{ selected.offense }}</h2>
          </div>
          <button class="close-btn" @click="closeDetail" aria-label="Close">✕</button>
        </div>

        <div class="detail-status">
          <span class="badge" :class="statusClass(selected.caseStatus)">
            {{ selected.caseStatus }}
          </span>
        </div>

        <dl class="detail-grid">
          <template v-for="f in visibleDetailFields" :key="f.key">
            <dt>{{ f.label }}</dt>
            <dd :class="{ mono: f.key === 'blotterno' }">{{ selected[f.key] }}</dd>
          </template>
        </dl>

        <IncidentPersons v-if="auth.canAccess('/persons')" :incident="selected" />
        <SimilarIncidents :incident="selected" @open="(s) => openById(s.id)" />
        <IncidentCases v-if="auth.canAccess('/investigations')" :incident="selected" />

        <div class="narrative">
          <h3>Narrative</h3>
          <p>{{ selected.narrative || 'No narrative recorded.' }}</p>
        </div>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.incidents {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* --- Filters --- */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.search-box {
  position: relative;
  flex: 1 1 240px;
  min-width: 200px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 16px;
}

.search-input {
  width: 100%;
  padding: 9px 12px 9px 34px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-group label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.control {
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  min-width: 130px;
}

.search-input:focus,
.control:focus {
  outline: none;
  border-color: var(--accent);
}

.clear-btn {
  padding: 9px 14px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.clear-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.result-count {
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

/* --- Table --- */
.table-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table thead th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  font-weight: 600;
  padding: 12px 16px;
  background: var(--sidebar);
  border-bottom: 1px solid var(--border);
}

.table td {
  padding: 12px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}

.row {
  cursor: pointer;
  transition: background 0.12s;
}

.row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.row.active {
  background: rgba(232, 93, 4, 0.1);
}

.table tbody tr:last-child td {
  border-bottom: none;
}

.mono {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 32px 16px;
}

/* --- Status badges --- */
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.status-solved {
  background: rgba(57, 135, 229, 0.15);
  color: #6da7ec;
}
.status-investigating {
  background: rgba(232, 93, 4, 0.15);
  color: #f97316;
}
.status-filed {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}
.status-resolved {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}
.status-cleared {
  background: rgba(45, 212, 191, 0.15);
  color: #2dd4bf;
}
.status-closed {
  background: rgba(139, 148, 158, 0.15);
  color: var(--text-muted);
}
.status-default {
  background: rgba(139, 148, 158, 0.15);
  color: var(--text-muted);
}

/* --- Pagination --- */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.page-btn {
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 13px;
  color: var(--text-muted);
}

/* --- Detail panel --- */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1100;
}

.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: 440px;
  max-width: 90vw;
  background: var(--sidebar);
  border-left: 1px solid var(--border);
  z-index: 1101;
  padding: 24px;
  overflow-y: auto;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.4);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.detail-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.detail-title {
  font-size: 20px;
  font-weight: 700;
  margin-top: 2px;
}

.close-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}

.close-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.detail-status {
  margin-bottom: 20px;
}

.detail-grid {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 10px 16px;
  margin: 0 0 24px;
}

.detail-grid dt {
  font-size: 12px;
  color: var(--text-muted);
}

.detail-grid dd {
  font-size: 13px;
  margin: 0;
  color: var(--text);
}

.narrative {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.narrative h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.narrative p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
}

/* --- Transitions --- */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
