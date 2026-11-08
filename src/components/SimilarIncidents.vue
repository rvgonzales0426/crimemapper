<script setup>
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'

// "Similar incidents" section of the incident detail panel: other blotters
// whose narratives read most like this one (gte-small embeddings, pgvector).
const props = defineProps({
  incident: { type: Object, required: true },
})
const emit = defineEmits(['open'])

const items = ref([])
const loading = ref(false)
const error = ref('')

watch(
  () => props.incident.id,
  async (id) => {
    loading.value = true
    error.value = ''
    const { data, error: err } = await supabase.rpc('similar_incidents', { p_incident: id, p_limit: 5 })
    if (id !== props.incident.id) return
    loading.value = false
    if (err) {
      items.value = []
      error.value = err.message
      return
    }
    items.value = (data || []).map((r) => ({
      id: r.id,
      blotterno: r.blotterno,
      dateCommitted: r.date_committed,
      offense: (r.offense || '').split(' - ')[0].replace(/\s+/g, ' ').trim(),
      barangay: r.barangay,
      similarity: r.similarity,
    }))
  },
  { immediate: true }
)
</script>

<template>
  <div class="similar">
    <h3>Similar incidents</h3>
    <p v-if="loading" class="muted">Finding similar narratives…</p>
    <ul v-else-if="items.length">
      <li v-for="s in items" :key="s.id" tabindex="0" @click="emit('open', s)" @keydown.enter="emit('open', s)">
        <span class="main">
          <span class="mono">{{ s.blotterno }}</span> · {{ s.offense || 'Incident' }}
          <span class="muted">· {{ s.barangay }} · {{ s.dateCommitted }}</span>
        </span>
        <span class="score" :title="`Narrative similarity ${Math.round(s.similarity * 100)}%`">
          {{ Math.round(s.similarity * 100) }}%
        </span>
      </li>
    </ul>
    <p v-else-if="!error" class="muted">No similar narratives found (or this incident isn't embedded yet).</p>
    <p v-if="error" class="error">⚠ {{ error }}</p>
  </div>
</template>

<style scoped>
.similar {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-bottom: 16px;
}

h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  outline: none;
}

li:hover,
li:focus-visible {
  background: rgba(255, 255, 255, 0.04);
}

.main {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-variant-numeric: tabular-nums;
}

.score {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
  font-size: 12px;
}

.error {
  font-size: 12px;
  color: #f85149;
}
</style>
