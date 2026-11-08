<script setup>
import { ref, watch } from 'vue'
import { usePersonsStore, titleName } from '../stores/persons'

// "People named" section of the incident detail panel: the parsed suspects /
// victims, each linked to their Persons record with how many blotters name them.
const props = defineProps({
  incident: { type: Object, required: true },
})

const store = usePersonsStore()
const people = ref([])
const error = ref('')

watch(
  () => props.incident.id,
  async (id) => {
    error.value = ''
    try {
      people.value = await store.forIncident(id)
    } catch (e) {
      people.value = []
      error.value = e.message || String(e)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="incident-persons">
    <h3>People named</h3>
    <ul v-if="people.length">
      <li v-for="p in people" :key="p.mentionId">
        <span class="role" :class="p.role">{{ p.role === 'suspect' ? 'Suspect' : 'Victim' }}</span>
        <span class="who">
          <RouterLink v-if="p.personId" :to="{ name: 'person', params: { id: p.personId } }">
            {{ titleName(p.name) }}
          </RouterLink>
          <span v-else class="muted">{{ p.placeholder ? 'Unidentified' : titleName(p.name) || 'Unnamed' }}</span>
          <span class="meta">
            <template v-if="p.age != null">{{ p.age }}</template><template v-if="p.sex">{{ p.age != null ? '/' : '' }}{{ p.sex }}</template>
            <template v-if="p.status"> · {{ p.status }}</template>
          </span>
        </span>
        <span v-if="p.blotters > 1" class="repeat" :title="`Named in ${p.blotters} blotters`">
          {{ p.blotters }} blotters
        </span>
      </li>
    </ul>
    <p v-else-if="!error" class="muted">No parsed names for this incident.</p>
    <p v-if="error" class="error">⚠ {{ error }}</p>
  </div>
</template>

<style scoped>
.incident-persons {
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
  gap: 8px;
}

li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.role {
  flex-shrink: 0;
  width: 62px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 0;
  border-radius: 10px;
}

.role.suspect {
  background: rgba(217, 89, 38, 0.15);
  color: #e8834f;
}

.role.victim {
  background: rgba(57, 135, 229, 0.15);
  color: #6da7ec;
}

.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.who a {
  color: var(--text);
  font-weight: 600;
}

.who a:hover {
  color: var(--accent);
}

.meta {
  font-size: 11px;
  color: var(--text-muted);
}

.repeat {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(217, 164, 38, 0.15);
  color: #e0b54a;
}

.muted {
  color: var(--text-muted);
  font-size: 13px;
}

.error {
  font-size: 12px;
  color: #f85149;
}
</style>
