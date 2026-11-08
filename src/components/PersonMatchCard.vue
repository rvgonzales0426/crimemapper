<script setup>
import { computed, ref } from 'vue'
import { usePersonsStore, titleName, bornLabel } from '../stores/persons'

// One suggested "possibly the same person" pair with its evidence. Nothing is
// merged until an investigator clicks "Same person".
const props = defineProps({
  match: { type: Object, required: true },
})
const emit = defineEmits(['decided'])

const store = usePersonsStore()
const busy = ref(false)
const error = ref('')

// Keep the record with more blotters; ties keep the older (lower id) record.
const keep = computed(() => {
  const { a, b } = props.match
  return b.blotters > a.blotters ? b : a
})
const other = computed(() => (keep.value === props.match.a ? props.match.b : props.match.a))

const evidence = computed(() => {
  const m = props.match
  const out = [{ text: `Names ${Math.round(m.similarity * 100)}% alike`, tone: m.similarity >= 0.75 ? 'good' : '' }]
  if (m.ageGap === 0) out.push({ text: 'Ages consistent', tone: 'good' })
  else if (m.ageGap != null) out.push({ text: `Ages ${m.ageGap} yr apart`, tone: m.ageGap > 5 ? 'warn' : '' })
  else out.push({ text: 'Age unknown on one record', tone: '' })
  if ((m.a.suffix || '') !== (m.b.suffix || '')) out.push({ text: 'Suffix differs (Jr/Sr?)', tone: 'warn' })
  if (m.sharedBarangays.length) out.push({ text: `Same barangay: ${m.sharedBarangays.slice(0, 2).join(', ')}`, tone: 'good' })
  if (m.sharedAssociates) out.push({ text: `${m.sharedAssociates} shared associate${m.sharedAssociates > 1 ? 's' : ''}`, tone: 'good' })
  return out
})

async function decide(same) {
  if (same && !confirm(`Confirm "${titleName(other.value.displayName)}" and "${titleName(keep.value.displayName)}" are the same person? Their blotters will be combined.`)) return
  busy.value = true
  error.value = ''
  try {
    if (same) await store.merge(keep.value.id, other.value.id)
    else await store.notSame(props.match.a.id, props.match.b.id)
    emit('decided', { same, keepId: keep.value.id, mergedId: other.value.id })
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="match-card">
    <div class="pair">
      <div v-for="p in [match.a, match.b]" :key="p.id" class="side">
        <RouterLink :to="{ name: 'person', params: { id: p.id } }" class="name">{{ titleName(p.displayName) }}</RouterLink>
        <span class="meta">
          {{ p.blotters }} blotter{{ p.blotters === 1 ? '' : 's' }}
          <template v-if="bornLabel(p.birthYearMin, p.birthYearMax)"> · {{ bornLabel(p.birthYearMin, p.birthYearMax) }}</template>
          <template v-if="p.sex"> · {{ p.sex === 'M' ? 'Male' : 'Female' }}</template>
        </span>
      </div>
    </div>
    <ul class="evidence">
      <li v-for="e in evidence" :key="e.text" :class="e.tone">{{ e.text }}</li>
    </ul>
    <div class="actions">
      <button class="btn primary" :disabled="busy" @click="decide(true)">Same person</button>
      <button class="btn" :disabled="busy" @click="decide(false)">Not the same</button>
    </div>
    <p v-if="error" class="error">⚠ {{ error }}</p>
  </article>
</template>

<style scoped>
.match-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name:hover {
  color: var(--accent);
}

.meta {
  font-size: 12px;
  color: var(--text-muted);
}

.evidence {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.evidence li {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
}

.evidence li.good {
  background: rgba(25, 158, 112, 0.14);
  color: #4cc59a;
}

.evidence li.warn {
  background: rgba(217, 164, 38, 0.14);
  color: #e0b54a;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
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

.error {
  font-size: 12px;
  color: #f85149;
}
</style>
