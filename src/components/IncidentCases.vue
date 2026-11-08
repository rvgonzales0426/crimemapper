<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useInvestigationsStore } from '../stores/investigations'
import CaseBadge from './CaseBadge.vue'

// "Investigations" section of the incident detail panel: the cases this
// incident is linked to, plus link-to-existing / start-new-case actions.
const props = defineProps({
  incident: { type: Object, required: true },
})

const store = useInvestigationsStore()
const router = useRouter()

const linked = ref([])
const open = ref([])
const choice = ref('')
const busy = ref(false)
const error = ref('')

const available = computed(() => open.value.filter((c) => !linked.value.some((l) => l.id === c.id)))

async function load() {
  error.value = ''
  choice.value = ''
  try {
    ;[linked.value, open.value] = await Promise.all([
      store.casesForIncident(props.incident.id),
      store.openCases(),
    ])
  } catch (e) {
    error.value = e.message || String(e)
  }
}
watch(() => props.incident.id, load, { immediate: true })

async function act(fn) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

const addToCase = () =>
  act(async () => {
    await store.linkIncidents(Number(choice.value), [props.incident.id])
    await load()
  })

// New case titled after the incident, with it linked, then open it.
const startCase = () =>
  act(async () => {
    const inc = props.incident
    const offense = (inc.offense || 'Incident').split(' - ')[0].replace(/\s+/g, ' ').trim()
    const id = await store.create({
      title: `${offense}${inc.barangay ? ` – ${inc.barangay}` : ''}`,
      summary: `Opened from blotter ${inc.blotterno || 'entry'} (${inc.dateCommitted || 'undated'}).`,
      priority: 'medium',
    })
    await store.linkIncidents(id, [inc.id])
    router.push({ name: 'investigation', params: { id } })
  })
</script>

<template>
  <div class="incident-cases">
    <h3>Investigations</h3>

    <ul v-if="linked.length" class="linked">
      <li v-for="c in linked" :key="c.id">
        <RouterLink :to="{ name: 'investigation', params: { id: c.id } }">
          <span class="case-no">{{ c.caseNo }}</span> {{ c.title }}
        </RouterLink>
        <CaseBadge :value="c.status" />
      </li>
    </ul>
    <p v-else class="muted">Not part of any investigation.</p>

    <div class="link-row">
      <select v-model="choice" :disabled="busy || !available.length" aria-label="Open investigation">
        <option value="">{{ available.length ? 'Add to an open case…' : 'No other open cases' }}</option>
        <option v-for="c in available" :key="c.id" :value="c.id">{{ c.caseNo }} · {{ c.title }}</option>
      </select>
      <button class="btn" :disabled="busy || !choice" @click="addToCase">Add</button>
    </div>
    <button class="btn wide" :disabled="busy" @click="startCase">+ Start a new investigation from this incident</button>

    <p v-if="error" class="error">⚠ {{ error }}</p>
  </div>
</template>

<style scoped>
.incident-cases {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.linked {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.linked li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.linked a {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linked a:hover {
  color: var(--accent);
}

.case-no {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.muted {
  font-size: 13px;
  color: var(--text-muted);
}

.link-row {
  display: flex;
  gap: 8px;
}

select {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
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
}

.btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.wide {
  width: 100%;
}

.error {
  font-size: 12px;
  color: #f85149;
}
</style>
