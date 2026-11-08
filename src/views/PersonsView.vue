<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { usePersonsStore, titleName, bornLabel } from '../stores/persons'
import PersonMatchCard from '../components/PersonMatchCard.vue'

const store = usePersonsStore()
const router = useRouter()
const { filters, results, loading, error } = storeToRefs(store)

const tab = ref('index')
const query = ref(filters.value.query)
let timer = null
function onQuery() {
  clearTimeout(timer)
  timer = setTimeout(() => store.setFilters({ query: query.value }), 300)
}

onMounted(store.search)

// --- Possible matches queue ---
const matches = ref([])
const matchesLoading = ref(false)
const matchesError = ref('')
const matchesLoaded = ref(false)
async function loadMatches() {
  matchesLoading.value = true
  matchesError.value = ''
  try {
    matches.value = await store.fetchMatches({ limit: 60 })
    matchesLoaded.value = true
  } catch (e) {
    matchesError.value = e.message || String(e)
  } finally {
    matchesLoading.value = false
  }
}
function openTab(t) {
  tab.value = t
  if (t === 'matches' && !matchesLoaded.value) loadMatches()
}
function onDecided(m, { same, mergedId }) {
  // Drop the decided pair, and any other pair that pointed at a merged record.
  matches.value = matches.value.filter(
    (x) => x !== m && !(same && (x.a.id === mergedId || x.b.id === mergedId))
  )
  if (same) store.search()
}

const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
const open = (p) => router.push({ name: 'person', params: { id: p.id } })
</script>

<template>
  <div class="persons">
    <p class="notice">
      People named in blotters, linked across incidents to support investigations. Being named as a suspect is
      <strong>not</strong> a finding of guilt; records are linked automatically only on an exact name with consistent sex
      and age, and every other match is a suggestion until an investigator confirms it. Views and decisions are logged.
    </p>

    <div class="tabs" role="tablist">
      <button role="tab" :aria-selected="tab === 'index'" :class="{ active: tab === 'index' }" @click="openTab('index')">
        Index
      </button>
      <button
        role="tab"
        :aria-selected="tab === 'matches'"
        :class="{ active: tab === 'matches' }"
        @click="openTab('matches')"
      >
        Possible matches
        <span v-if="matchesLoaded && matches.length" class="count">{{ matches.length }}</span>
      </button>
    </div>

    <template v-if="tab === 'index'">
      <div class="toolbar">
        <input v-model="query" class="search" type="search" placeholder="Search a name or alias…" @input="onQuery" />
        <div class="segmented" role="group" aria-label="Role">
          <button
            v-for="r in [
              ['', 'Everyone'],
              ['suspect', 'Named as suspect'],
              ['victim', 'Named as victim'],
            ]"
            :key="r[0]"
            :class="{ active: filters.role === r[0] }"
            @click="store.setFilters({ role: r[0] })"
          >
            {{ r[1] }}
          </button>
        </div>
        <label class="check">
          <input
            type="checkbox"
            :checked="filters.repeatOnly"
            :disabled="!!filters.query.trim()"
            @change="store.setFilters({ repeatOnly: $event.target.checked })"
          />
          In 2+ blotters only
        </label>
      </div>

      <section class="card table-card">
        <p v-if="error" class="error">⚠ {{ error }}</p>
        <table v-else>
          <thead>
            <tr>
              <th>Name</th>
              <th>Sex</th>
              <th>Est. born</th>
              <th class="num">As suspect</th>
              <th class="num">As victim</th>
              <th>Last suspect status</th>
              <th>Barangays</th>
              <th>Last incident</th>
            </tr>
          </thead>
          <tbody :class="{ stale: loading }">
            <tr v-for="p in results" :key="p.id" tabindex="0" @click="open(p)" @keydown.enter="open(p)">
              <td>
                <span class="name">{{ titleName(p.displayName) }}</span>
                <span v-if="p.aliases.length" class="alias">“{{ p.aliases.map(titleName).join('”, “') }}”</span>
              </td>
              <td>{{ p.sex || '—' }}</td>
              <td class="muted">{{ bornLabel(p.birthYearMin, p.birthYearMax)?.slice(3) || '—' }}</td>
              <td class="num">{{ p.asSuspect || '—' }}</td>
              <td class="num">{{ p.asVictim || '—' }}</td>
              <td class="muted">{{ p.lastSuspectStatus || '—' }}</td>
              <td class="muted">{{ p.barangays.slice(0, 2).join(', ') }}<template v-if="p.barangays.length > 2"> +{{ p.barangays.length - 2 }}</template></td>
              <td class="muted">{{ fmtDate(p.lastDate) }}</td>
            </tr>
            <tr v-if="!results.length && !loading">
              <td colspan="8" class="empty">
                <template v-if="filters.query">No one matches “{{ filters.query }}”.</template>
                <template v-else>
                  No people indexed yet. Run <code>bun scripts/build-persons.js</code> once the persons migration is
                  applied.
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <section v-else class="matches">
      <p class="hint">
        Pairs of records whose names are alike and whose sex is the same, ranked by the evidence below. Confirm only
        when the blotters support it (ages, places, associates). “Not the same” hides the pair for everyone.
      </p>
      <p v-if="matchesError" class="error">⚠ {{ matchesError }}</p>
      <p v-else-if="matchesLoading && !matches.length" class="muted">Looking for possible matches…</p>
      <p v-else-if="matchesLoaded && !matches.length" class="muted">No open suggestions. 👍</p>
      <div class="match-grid">
        <PersonMatchCard v-for="m in matches" :key="`${m.a.id}-${m.b.id}`" :match="m" @decided="onDecided(m, $event)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.persons {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.notice {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid #3987e5;
  border-radius: 8px;
  padding: 10px 14px;
}

.notice strong {
  color: var(--text);
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}

.tabs button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.tabs button.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.search {
  min-width: 280px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

.segmented {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px;
}

.segmented button {
  padding: 6px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.segmented button.active {
  background: var(--bg);
  color: var(--text);
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}

.check input {
  accent-color: var(--accent);
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.table-card {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

tbody tr {
  cursor: pointer;
  outline: none;
}

tbody tr:hover,
tbody tr:focus-visible {
  background: rgba(255, 255, 255, 0.03);
}

tbody.stale {
  opacity: 0.55;
}

.name {
  font-weight: 600;
}

.alias {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--text-muted);
}

.empty {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  cursor: default;
}

code {
  font-size: 12px;
  color: var(--text);
}

.hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.match-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 12px;
}

.error {
  color: #f85149;
  font-size: 13px;
  padding: 12px 14px;
}
</style>
