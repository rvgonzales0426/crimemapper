<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePatrolStore } from '../stores/patrol'

defineProps({
  activeZid: { type: Number, default: null },
})
const emit = defineEmits(['focus'])

const store = usePatrolStore()
const { settings, zones, loading, error } = storeToRefs(store)

const collapsed = ref(false)

const SENSITIVITY = [
  { value: 1, label: 'Broad (mean + 1 SD)' },
  { value: 2, label: 'Standard (mean + 2 SD)' },
  { value: 3, label: 'Tight (mean + 3 SD)' },
]
const CATEGORIES = [
  { value: 'crime', label: 'Crimes' },
  { value: 'traffic', label: 'Vehicular accidents' },
  { value: '', label: 'All incidents' },
]

// "THEFT  - RPC Art. 308" -> "Theft"
function offenseName(raw) {
  const name = raw.split(' - ')[0].replace(/\s+/g, ' ').trim().toLowerCase()
  return name.charAt(0).toUpperCase() + name.slice(1)
}
const pct = (v) => `${(v * 100).toFixed(0)}%`
</script>

<template>
  <section class="analysis-panel" :class="{ collapsed }">
    <header class="panel-head">
      <div>
        <h2>Priority patrol zones</h2>
        <span class="meta">
          <template v-if="zones.length">
            {{ zones.length }} zones · cover
            {{ pct(zones.reduce((s, z) => s + z.incidents, 0) / (zones[0].total || 1)) }} of incidents in
            {{ zones.reduce((s, z) => s + z.areaKm2, 0).toFixed(2) }} km² · density ≥
            {{ zones[0].threshold.toFixed(1) }}/km²
          </template>
          <template v-else-if="!loading">Hotspots on the KDE surface</template>
        </span>
      </div>
      <button class="icon-btn" :aria-label="collapsed ? 'Expand' : 'Collapse'" @click="collapsed = !collapsed">
        {{ collapsed ? '▴' : '▾' }}
      </button>
    </header>

    <div v-show="!collapsed" class="panel-body" :class="{ stale: loading }">
      <div class="settings">
        <label>
          <span>Incidents</span>
          <select :value="settings.category" @change="store.updateSettings({ category: $event.target.value })">
            <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </label>
        <label>
          <span>Zone sensitivity</span>
          <select :value="settings.sd" @change="store.updateSettings({ sd: +$event.target.value })">
            <option v-for="s in SENSITIVITY" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>
      </div>

      <div v-if="error" class="error">⚠ {{ error }}</div>
      <p v-else-if="loading && !zones.length" class="muted">Computing zones…</p>
      <p v-else-if="!zones.length" class="muted">No zone has 5 or more incidents at these settings.</p>

      <ol v-else class="zones">
        <li
          v-for="z in zones"
          :key="z.zid"
          class="zone"
          :class="{ active: activeZid === z.zid }"
          tabindex="0"
          @click="emit('focus', z)"
          @keydown.enter="emit('focus', z)"
        >
          <span class="rank">{{ z.rank }}</span>
          <div class="zone-body">
            <div class="zone-title">
              <span class="place">{{ z.barangays.map((b) => b.label.toUpperCase()).join(', ') || 'Unnamed area' }}</span>
              <span class="count">{{ z.incidents }} <small>({{ pct(z.share) }})</small></span>
            </div>
            <div class="zone-window">
              Patrol {{ z.window.days.join(', ') }}
              <template v-if="z.window.time">
                · {{ z.window.time }}
                <span class="muted-inline">({{ pct(z.window.timeShare) }} of timed incidents)</span>
              </template>
              <span v-else class="muted-inline">· no recorded times</span>
            </div>
            <div class="zone-offenses">
              {{ z.topOffenses.map((o) => `${offenseName(o.label)} (${o.count})`).join(' · ') }}
            </div>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.analysis-panel {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  background: var(--sidebar);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
}

.panel-head h2 {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.meta {
  font-size: 11px;
  color: var(--text-muted);
}

.icon-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  width: 26px;
  height: 26px;
  cursor: pointer;
  flex-shrink: 0;
}

.icon-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.panel-body {
  padding: 0 16px 14px;
  transition: opacity 0.2s;
}

.panel-body.stale {
  opacity: 0.55;
}

.settings {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.settings label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.settings select {
  padding: 5px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
}

.muted {
  font-size: 12px;
  color: var(--text-muted);
}

.error {
  font-size: 12px;
  color: #f85149;
  word-break: break-word;
}

.zones {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zone {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  outline: none;
  transition: background 0.12s;
}

.zone:hover,
.zone:focus-visible {
  background: rgba(255, 255, 255, 0.04);
}

.zone.active {
  background: rgba(45, 212, 191, 0.1);
}

.rank {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #2dd4bf;
  color: #0d1117;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zone-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.zone-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.place {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.count {
  flex-shrink: 0;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.count small {
  font-weight: 400;
  color: var(--text-muted);
}

.zone-window {
  font-size: 12px;
  color: var(--text);
}

.muted-inline {
  color: var(--text-muted);
  font-size: 11px;
}

.zone-offenses {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
