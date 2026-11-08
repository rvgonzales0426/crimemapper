<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { usePersonsStore, titleName, bornLabel } from '../stores/persons'
import { useAuthStore } from '../stores/auth'
import CaseMap from '../components/CaseMap.vue'
import CaseBadge from '../components/CaseBadge.vue'
import PersonMatchCard from '../components/PersonMatchCard.vue'

const props = defineProps({
  id: { type: Number, required: true },
})

const store = usePersonsStore()
const auth = useAuthStore()
const router = useRouter()
const { current: p, currentLoading, currentError } = storeToRefs(store)

const matches = ref([])
const actionError = ref('')

async function load(id, logView = true) {
  actionError.value = ''
  await store.fetchPerson(id, { logView })
  try {
    matches.value = p.value ? await store.fetchMatches({ personId: id, limit: 10 }) : []
  } catch {
    matches.value = []
  }
}
watch(() => props.id, (id) => load(id), { immediate: true })

// One row per blotter: offense rows of the same blotter are folded together.
const blotters = computed(() => {
  const map = new Map()
  for (const m of p.value?.mentions || []) {
    const k = `${m.blotterno || m.id}|${m.role}`
    if (!map.has(k)) map.set(k, { ...m, offenses: [] })
    const row = map.get(k)
    const off = (m.offense || '').split(' - ')[0].replace(/\s+/g, ' ').trim()
    if (off && !row.offenses.includes(off)) row.offenses.push(off)
  }
  return [...map.values()]
})
const autoOnly = computed(() => blotters.value.length > 1 && blotters.value.every((b) => b.linkSource === 'auto'))
const mapped = computed(() => (p.value?.mentions || []).filter((m) => m.lat != null && !m.coordFlag))

async function split(row) {
  if (!confirm(`Split blotter ${row.blotterno} off into a separate person? Use this when it's a different individual with the same name.`)) return
  actionError.value = ''
  try {
    const newId = await store.split(row.mentionId)
    if (blotters.value.length <= 1) router.replace({ name: 'person', params: { id: newId } })
    else await load(props.id, false)
  } catch (e) {
    actionError.value = e.message || String(e)
  }
}

function onDecided({ same, keepId }) {
  if (same && keepId !== props.id) router.replace({ name: 'person', params: { id: keepId } })
  else load(props.id, false)
}

const roleLabel = (r) => (r === 'suspect' ? 'Named as suspect' : 'Named as victim')
const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
</script>

<template>
  <div class="person-page">
    <RouterLink :to="{ name: 'persons' }" class="back">← Persons</RouterLink>

    <p v-if="currentError" class="error">⚠ {{ currentError }}</p>
    <p v-else-if="!p && currentLoading" class="muted">Loading…</p>

    <template v-if="p">
      <header class="card head">
        <div>
          <h2>{{ titleName(p.displayName) }}</h2>
          <p class="sub">
            <template v-if="p.sex">{{ p.sex === 'M' ? 'Male' : 'Female' }} · </template>
            <template v-if="bornLabel(p.birthYearMin, p.birthYearMax)">{{ bornLabel(p.birthYearMin, p.birthYearMax) }} (from ages in blotters) · </template>
            <template v-if="p.aliases.length">alias “{{ p.aliases.map(titleName).join('”, “') }}” · </template>
            Named in {{ p.blotters }} blotter{{ p.blotters === 1 ? '' : 's' }}
          </p>
        </div>
        <div class="tallies">
          <div><strong>{{ p.asSuspect }}</strong><span>as suspect</span></div>
          <div><strong>{{ p.asVictim }}</strong><span>as victim</span></div>
        </div>
      </header>

      <p v-if="autoOnly" class="caution">
        These blotters were grouped automatically because the name, sex and age match exactly. Check them; if one is a
        different person with the same name, use <strong>Split</strong>.
      </p>
      <p v-if="actionError" class="error" role="alert">⚠ {{ actionError }}</p>

      <div class="columns" :class="{ stale: currentLoading }">
        <section class="card">
          <h3>Blotters</h3>
          <CaseMap v-if="mapped.length" :incidents="mapped" />
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Blotter</th>
                <th>Role</th>
                <th>Offense</th>
                <th>Barangay</th>
                <th>Their status</th>
                <th>Age then</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in blotters" :key="`${b.blotterno}-${b.role}`">
                <td class="mono">{{ b.dateCommitted || '—' }}</td>
                <td class="mono">{{ b.blotterno || '—' }}</td>
                <td><span class="role" :class="b.role">{{ roleLabel(b.role) }}</span></td>
                <td>{{ b.offenses.join('; ') || '—' }}</td>
                <td>{{ b.barangay || '—' }}</td>
                <td class="muted">{{ b.status || '—' }}</td>
                <td class="mono">{{ b.age ?? '—' }}</td>
                <td class="actions">
                  <span v-if="b.linkSource === 'confirmed'" class="tag" title="Confirmed by an investigator">confirmed</span>
                  <button v-if="blotters.length > 1" class="link-btn" @click="split(b)">Split</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="side">
          <section class="card">
            <h3>Named alongside</h3>
            <ul v-if="p.associates.length" class="list">
              <li v-for="a in p.associates" :key="a.id">
                <RouterLink :to="{ name: 'person', params: { id: a.id } }">{{ titleName(a.displayName) }}</RouterLink>
                <span class="muted">{{ a.roles.join(' / ') }} · {{ a.shared }} blotter{{ a.shared === 1 ? '' : 's' }}</span>
              </li>
            </ul>
            <p v-else class="muted">No one else is named on these blotters.</p>
          </section>

          <section v-if="auth.canAccess('/investigations')" class="card">
            <h3>Investigations</h3>
            <ul v-if="p.investigations.length" class="list">
              <li v-for="v in p.investigations" :key="v.id">
                <RouterLink :to="{ name: 'investigation', params: { id: v.id } }">{{ v.caseNo }} · {{ v.title }}</RouterLink>
                <CaseBadge :value="v.status" />
              </li>
            </ul>
            <p v-else class="muted">None of these blotters is linked to a case.</p>
          </section>

          <section class="card">
            <h3>Possibly the same person</h3>
            <div v-if="matches.length" class="matches">
              <PersonMatchCard v-for="m in matches" :key="`${m.a.id}-${m.b.id}`" :match="m" @decided="onDecided" />
            </div>
            <p v-else class="muted">No similar records.</p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.person-page {
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
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 12px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.head h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

.sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-muted);
}

.tallies {
  display: flex;
  gap: 24px;
}

.tallies div {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.tallies strong {
  font-size: 22px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.tallies span {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.caution {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  background: rgba(217, 164, 38, 0.1);
  border: 1px solid rgba(217, 164, 38, 0.35);
  border-radius: 8px;
  padding: 10px 14px;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.columns.stale {
  opacity: 0.7;
}

@media (max-width: 1100px) {
  .columns {
    grid-template-columns: 1fr;
  }
}

.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
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
  white-space: nowrap;
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

.role {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.role.suspect {
  background: rgba(217, 89, 38, 0.15);
  color: #e8834f;
}

.role.victim {
  background: rgba(57, 135, 229, 0.15);
  color: #6da7ec;
}

.actions {
  text-align: right;
  white-space: nowrap;
}

.tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(25, 158, 112, 0.14);
  color: #4cc59a;
  margin-right: 6px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.link-btn:hover {
  color: var(--accent);
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.list a {
  color: var(--text);
}

.list a:hover {
  color: var(--accent);
}

.matches {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.error {
  color: #f85149;
  font-size: 13px;
}
</style>
