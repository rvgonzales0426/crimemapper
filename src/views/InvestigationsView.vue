<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useInvestigationsStore, PRIORITIES, STATUSES } from '../stores/investigations'
import CaseBadge from '../components/CaseBadge.vue'

const store = useInvestigationsStore()
const router = useRouter()
const { list, listLoading, listError, listFilters } = storeToRefs(store)

const search = ref(listFilters.value.search)
let searchTimer = null
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setListFilters({ search: search.value }), 300)
}

onMounted(store.fetchList)

// --- New case ---
const showNew = ref(false)
const officers = ref([])
const draft = reactive({ title: '', summary: '', priority: 'medium', leadId: '' })
const creating = ref(false)
const createError = ref('')

async function openNew() {
  showNew.value = true
  createError.value = ''
  if (!officers.value.length) {
    try {
      officers.value = await store.fetchOfficers()
    } catch (e) {
      createError.value = e.message || String(e)
    }
  }
}

async function createCase() {
  creating.value = true
  createError.value = ''
  try {
    const id = await store.create(draft)
    router.push({ name: 'investigation', params: { id } })
  } catch (e) {
    createError.value = e.message || String(e)
  } finally {
    creating.value = false
  }
}

const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
</script>

<template>
  <div class="investigations">
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Status">
        <button :class="{ active: !listFilters.status }" @click="store.setListFilters({ status: '' })">All</button>
        <button
          v-for="s in STATUSES"
          :key="s.value"
          :class="{ active: listFilters.status === s.value }"
          @click="store.setListFilters({ status: s.value })"
        >
          {{ s.label }}
        </button>
      </div>
      <div class="toolbar-right">
        <input
          v-model="search"
          class="search"
          type="search"
          placeholder="Search case no., title, summary"
          @input="onSearch"
        />
        <button class="btn primary" @click="openNew">+ New investigation</button>
      </div>
    </div>

    <form v-if="showNew" class="card new-case" @submit.prevent="createCase">
      <h3>New investigation</h3>
      <label>
        <span>Title</span>
        <input v-model="draft.title" required placeholder="e.g. Ampayon motorcycle theft series" />
      </label>
      <div class="row">
        <label>
          <span>Priority</span>
          <select v-model="draft.priority">
            <option v-for="p in PRIORITIES" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </label>
        <label class="grow">
          <span>Lead investigator</span>
          <select v-model="draft.leadId">
            <option value="">Unassigned</option>
            <option v-for="o in officers" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
      </div>
      <label>
        <span>Summary</span>
        <textarea v-model="draft.summary" rows="3" placeholder="What is being investigated and why"></textarea>
      </label>
      <p v-if="createError" class="error">⚠ {{ createError }}</p>
      <div class="form-actions">
        <button type="button" class="btn" @click="showNew = false">Cancel</button>
        <button type="submit" class="btn primary" :disabled="creating || !draft.title.trim()">
          {{ creating ? 'Creating…' : 'Create and open' }}
        </button>
      </div>
    </form>

    <section class="card table-card">
      <p v-if="listError" class="error">⚠ {{ listError }}</p>
      <table v-else>
        <thead>
          <tr>
            <th>Case no.</th>
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Lead</th>
            <th class="num">Incidents</th>
            <th class="num">Notes</th>
            <th>Last activity</th>
          </tr>
        </thead>
        <tbody :class="{ stale: listLoading }">
          <tr
            v-for="c in list"
            :key="c.id"
            tabindex="0"
            @click="router.push({ name: 'investigation', params: { id: c.id } })"
            @keydown.enter="router.push({ name: 'investigation', params: { id: c.id } })"
          >
            <td class="mono">{{ c.caseNo }}</td>
            <td class="title">{{ c.title }}</td>
            <td><CaseBadge :value="c.status" /></td>
            <td><CaseBadge kind="priority" :value="c.priority" /></td>
            <td>{{ c.lead || '—' }}</td>
            <td class="num">{{ c.incidentCount ?? '—' }}</td>
            <td class="num">{{ c.noteCount ?? '—' }}</td>
            <td class="muted">{{ fmtDate(c.updatedAt) }}</td>
          </tr>
          <tr v-if="!list.length && !listLoading">
            <td colspan="8" class="empty">
              <template v-if="listFilters.status || listFilters.search">No investigations match.</template>
              <template v-else>
                No investigations yet. Start one with <strong>+ New investigation</strong>, or from an incident's detail
                panel on the Incidents page.
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.investigations {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}

.toolbar-right {
  display: flex;
  gap: 10px;
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

.btn {
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.new-case {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
}

.new-case h3 {
  font-size: 15px;
  color: var(--text);
}

.new-case label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

.new-case .row {
  display: flex;
  gap: 12px;
}

.new-case .grow {
  flex: 1;
}

.new-case input,
.new-case select,
.new-case textarea {
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.table-card {
  padding: 0;
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
  padding: 12px 14px;
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

.title {
  font-weight: 600;
}

.mono,
.num {
  font-variant-numeric: tabular-nums;
}

.mono {
  white-space: nowrap;
  color: var(--text-muted);
}

.num {
  text-align: right;
}

.muted {
  color: var(--text-muted);
  white-space: nowrap;
}

.empty {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  cursor: default;
}

.empty strong {
  color: var(--text);
}

.error {
  color: #f85149;
  font-size: 13px;
  padding: 4px 0;
}

.table-card > .error {
  padding: 16px;
}
</style>
