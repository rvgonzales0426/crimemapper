<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useInvestigationsStore, PRIORITIES, STATUSES } from '../stores/investigations'
import { useAuthStore } from '../stores/auth'
import CaseBadge from '../components/CaseBadge.vue'
import CaseMap from '../components/CaseMap.vue'
import AssistantPanel from '../components/AssistantPanel.vue'

const props = defineProps({
  id: { type: Number, required: true },
})

const store = useInvestigationsStore()
const auth = useAuthStore()
const router = useRouter()
const { current: c, currentLoading, currentError } = storeToRefs(store)

const officers = ref([])
const actionError = ref('')

async function run(fn) {
  actionError.value = ''
  try {
    await fn()
  } catch (e) {
    actionError.value = e.message || String(e)
  }
}

onMounted(async () => {
  try {
    officers.value = await store.fetchOfficers()
  } catch {
    officers.value = []
  }
})

const canDelete = computed(() => c.value && (auth.isAdmin || c.value.createdBy === auth.user?.id))

// --- Title / summary editing ---
const titleDraft = ref(null)
const summaryDraft = ref(null)
const summaryDirty = computed(() => summaryDraft.value != null && summaryDraft.value !== (c.value?.summary || ''))

function saveTitle() {
  const t = titleDraft.value?.trim()
  titleDraft.value = null
  if (t && t !== c.value.title) run(() => store.update(c.value.id, { title: t }))
}

function saveSummary() {
  run(async () => {
    await store.update(c.value.id, { summary: summaryDraft.value })
    summaryDraft.value = null
  })
}

const setField = (patch) => run(() => store.update(c.value.id, patch))

async function deleteCase() {
  if (!confirm(`Delete ${c.value.caseNo} "${c.value.title}"? Its notes and incident links are removed too.`)) return
  await run(async () => {
    await store.remove(c.value.id)
    router.replace({ name: 'investigations' })
  })
}

// --- Incidents ---
const linkedIds = computed(() => new Set((c.value?.incidents || []).map((i) => i.id)))
const unmapped = computed(
  () => (c.value?.incidents || []).filter((i) => i.lat == null || i.lng == null || i.coordFlag).length
)
const query = ref('')
const results = ref([])
const searching = ref(false)
let searchTimer = null
function onQuery() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    if (!query.value.trim()) {
      results.value = []
      return
    }
    searching.value = true
    await run(async () => {
      results.value = await store.searchIncidents(query.value)
    })
    searching.value = false
  }, 300)
}

// Declared after every ref it resets (immediate runs during setup).
watch(
  () => props.id,
  (id) => {
    titleDraft.value = null
    summaryDraft.value = null
    query.value = ''
    results.value = []
    store.fetchOne(id)
  },
  { immediate: true }
)

const link = (inc) => run(() => store.linkIncidents(c.value.id, [inc.id]))
function unlink(inc) {
  if (confirm(`Unlink ${inc.blotterno || 'this incident'} from the case?`)) {
    run(() => store.unlinkIncident(c.value.id, inc.id))
  }
}

// --- Notes ---
const noteDraft = ref('')
const posting = ref(false)
async function postNote() {
  posting.value = true
  await run(async () => {
    await store.addNote(c.value.id, noteDraft.value)
    noteDraft.value = ''
  })
  posting.value = false
}
function deleteNote(n) {
  if (confirm('Delete this note?')) run(() => store.deleteNote(n.id))
}
const canDeleteNote = (n) => n.kind === 'note' && (n.authorId === auth.user?.id || auth.isAdmin)

const offenseName = (raw) => (raw ? raw.split(' - ')[0].replace(/\s+/g, ' ').trim() : '—')
const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
const fmtDateTime = (s) =>
  new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
</script>

<template>
  <div class="case-page">
    <RouterLink :to="{ name: 'investigations' }" class="back">← Investigations</RouterLink>

    <p v-if="currentError" class="error">⚠ {{ currentError }}</p>
    <p v-else-if="!c && currentLoading" class="muted">Loading…</p>

    <template v-if="c">
      <header class="card case-head">
        <div class="head-main">
          <div class="case-line">
            <span class="case-no">{{ c.caseNo }}</span>
            <CaseBadge :value="c.status" />
            <CaseBadge kind="priority" :value="c.priority" />
          </div>
          <input
            v-if="titleDraft != null"
            v-model="titleDraft"
            class="title-input"
            aria-label="Title"
            @keydown.enter="saveTitle"
            @keydown.esc="titleDraft = null"
            @blur="saveTitle"
          />
          <h2 v-else class="title" title="Click to rename" @click="titleDraft = c.title">{{ c.title }}</h2>
          <p class="byline">
            Opened {{ fmtDate(c.createdAt) }}<template v-if="c.creator"> by {{ c.creator }}</template>
            <template v-if="c.closedAt"> · Closed {{ fmtDate(c.closedAt) }}</template>
          </p>
        </div>

        <div class="head-fields">
          <label>
            <span>Status</span>
            <select :value="c.status" @change="setField({ status: $event.target.value })">
              <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select :value="c.priority" @change="setField({ priority: $event.target.value })">
              <option v-for="p in PRIORITIES" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </label>
          <label>
            <span>Lead investigator</span>
            <select :value="c.leadId ?? ''" @change="setField({ leadId: $event.target.value })">
              <option value="">Unassigned</option>
              <option v-for="o in officers" :key="o.id" :value="o.id">{{ o.label }}</option>
              <option v-if="c.leadId && !officers.some((o) => o.id === c.leadId)" :value="c.leadId">
                {{ c.lead }}
              </option>
            </select>
          </label>
          <button v-if="canDelete" class="btn danger" @click="deleteCase">Delete</button>
        </div>
      </header>

      <p v-if="actionError" class="error" role="alert">⚠ {{ actionError }}</p>

      <section class="card">
        <h3>Summary</h3>
        <textarea
          :value="summaryDraft ?? c.summary ?? ''"
          rows="3"
          placeholder="What is being investigated, suspects, leads…"
          @input="summaryDraft = $event.target.value"
        ></textarea>
        <div v-if="summaryDirty" class="form-actions">
          <button class="btn" @click="summaryDraft = null">Discard</button>
          <button class="btn primary" @click="saveSummary">Save summary</button>
        </div>
      </section>

      <div class="columns" :class="{ stale: currentLoading }">
        <section class="card">
          <h3>
            Linked incidents <span class="count">{{ c.incidents.length }}</span>
          </h3>

          <template v-if="c.incidents.length">
            <CaseMap :incidents="c.incidents" />
            <p v-if="unmapped" class="muted small">
              {{ unmapped }} not on the map (no usable location).
            </p>
            <table>
              <thead>
                <tr>
                  <th>Blotter</th>
                  <th>Date</th>
                  <th>Offense</th>
                  <th>Barangay</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="inc in c.incidents" :key="inc.id">
                  <td class="mono">{{ inc.blotterno || '—' }}</td>
                  <td class="mono">{{ inc.dateCommitted || '—' }}</td>
                  <td>{{ offenseName(inc.offense) }}</td>
                  <td>{{ inc.barangay || '—' }}</td>
                  <td class="muted">{{ inc.caseStatus || '—' }}</td>
                  <td class="actions">
                    <button class="icon-btn" :aria-label="`Unlink ${inc.blotterno}`" title="Unlink" @click="unlink(inc)">
                      ×
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
          <p v-else class="muted">No incidents linked yet. Search below, or use the Incidents page.</p>

          <div class="add-incidents">
            <input
              v-model="query"
              type="search"
              placeholder="Find incidents to link: blotter no., offense, barangay, names, narrative…"
              @input="onQuery"
            />
            <p v-if="searching" class="muted small">Searching…</p>
            <ul v-else-if="results.length" class="results">
              <li v-for="inc in results" :key="inc.id">
                <div>
                  <span class="mono">{{ inc.blotterno || '—' }}</span>
                  · {{ inc.dateCommitted || 'no date' }} · {{ offenseName(inc.offense) }}
                  <span class="muted">· {{ inc.barangay }}</span>
                </div>
                <button v-if="linkedIds.has(inc.id)" class="btn small" disabled>Linked</button>
                <button v-else class="btn small primary" @click="link(inc)">Link</button>
              </li>
            </ul>
            <p v-else-if="query.trim()" class="muted small">No matching incidents.</p>
          </div>
        </section>

        <div class="side-col">
        <AssistantPanel :investigation-id="c.id" />
        <section class="card">
          <h3>Activity</h3>
          <form class="composer" @submit.prevent="postNote">
            <textarea v-model="noteDraft" rows="3" placeholder="Add a case note…"></textarea>
            <div class="form-actions">
              <button class="btn primary" type="submit" :disabled="posting || !noteDraft.trim()">
                {{ posting ? 'Posting…' : 'Add note' }}
              </button>
            </div>
          </form>

          <ol class="timeline">
            <li v-for="n in c.notes" :key="n.id" :class="n.kind">
              <template v-if="n.kind === 'note'">
                <div class="note-head">
                  <strong>{{ n.author || 'Former user' }}</strong>
                  <span class="muted">{{ fmtDateTime(n.createdAt) }}</span>
                  <button v-if="canDeleteNote(n)" class="link-btn" @click="deleteNote(n)">Delete</button>
                </div>
                <p class="note-body">{{ n.body }}</p>
              </template>
              <template v-else>
                <span class="event-dot" aria-hidden="true"></span>
                <span>{{ n.body }}</span>
                <span class="muted">· {{ n.author || 'system' }} · {{ fmtDateTime(n.createdAt) }}</span>
              </template>
            </li>
          </ol>
        </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.case-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.back {
  color: var(--text-muted);
  font-size: 13px;
  width: fit-content;
}

.back:hover {
  color: var(--accent);
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  min-width: 0;
}

.card h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 12px;
}

.count {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.case-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
}

.head-main {
  min-width: 280px;
  flex: 1;
}

.case-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.case-no {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin: 2px 0 4px;
  cursor: text;
}

.title:hover {
  text-decoration: underline dotted var(--text-muted);
}

.title-input {
  width: 100%;
  margin: 2px 0 4px;
  padding: 4px 8px;
  font-size: 18px;
  font-weight: 700;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
}

.byline {
  font-size: 12px;
  color: var(--text-muted);
}

.head-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.head-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

select,
textarea,
.add-incidents input {
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

textarea {
  width: 100%;
  resize: vertical;
  line-height: 1.5;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.btn {
  padding: 7px 14px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.btn.small {
  padding: 3px 10px;
  font-size: 12px;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.danger:hover {
  color: #f85149;
  border-color: #f85149;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  transition: opacity 0.2s;
}

.columns.stale {
  opacity: 0.7;
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1100px) {
  .columns {
    grid-template-columns: 1fr;
  }
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 12px;
}

th {
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.mono {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
  margin-top: 6px;
}

.actions {
  text-align: right;
}

.icon-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.icon-btn:hover {
  color: #f85149;
  border-color: var(--border);
}

.add-incidents {
  margin-top: 16px;
}

.add-incidents input {
  width: 100%;
}

.results {
  list-style: none;
  margin-top: 8px;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.results li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}

.results li:last-child {
  border-bottom: none;
}

.composer {
  margin-bottom: 16px;
}

.timeline {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.timeline li.note {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.note-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.note-head strong {
  color: var(--text);
}

.note-body {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.link-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.link-btn:hover {
  color: #f85149;
}

.timeline li.event {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  padding-left: 4px;
}

.event-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transform: translateY(-1px);
}

.error {
  color: #f85149;
  font-size: 13px;
}
</style>
