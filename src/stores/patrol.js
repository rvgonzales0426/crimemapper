import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useIncidentsStore } from './incidents'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WINDOW_HOURS = 3

const pad = (n) => String(n).padStart(2, '0')

// Busiest WINDOW_HOURS-hour block (wrapping past midnight) and the two busiest
// days, from a zone's per-hour / per-day incident counts.
export function patrolWindow(byHour, byDow) {
  const hours = new Array(24).fill(0)
  for (const h of byHour) hours[h.hour] = h.count
  let best = { start: 0, count: -1 }
  for (let s = 0; s < 24; s++) {
    let c = 0
    for (let k = 0; k < WINDOW_HOURS; k++) c += hours[(s + k) % 24]
    if (c > best.count) best = { start: s, count: c }
  }
  const timed = hours.reduce((a, b) => a + b, 0)
  const days = [...byDow]
    .sort((a, b) => b.count - a.count || a.dow - b.dow)
    .slice(0, 2)
    .filter((d) => d.count > 0)
    .map((d) => DAY_NAMES[d.dow - 1])
  return {
    // null when no incident in the zone has a recorded time
    time: timed ? `${pad(best.start)}:00–${pad((best.start + WINDOW_HOURS) % 24)}:00` : null,
    timeShare: timed ? best.count / timed : 0,
    days,
  }
}

// snake_case zone from incidents_patrol_zones() -> camelCase + recommendation.
function mapZone(z, i) {
  return {
    rank: i + 1,
    zid: z.zid,
    geojson: z.geojson,
    areaKm2: Number(z.area_km2),
    threshold: Number(z.threshold),
    peakDensity: z.peak_density,
    incidents: z.incidents,
    total: z.total,
    share: z.total ? z.incidents / z.total : 0,
    topOffenses: z.top_offenses,
    barangays: z.barangays,
    window: patrolWindow(z.by_hour, z.by_dow),
  }
}

const sanitizeSearch = (term) => term.replace(/[,()*]/g, ' ').trim()

export const usePatrolStore = defineStore('patrol', () => {
  const settings = ref({
    sd: 2, // hotspot cut-off: cells at least mean + sd standard deviations
    category: 'crime', // '' (all) | 'crime' | 'traffic'
  })
  const zones = ref([])
  const loading = ref(false)
  const error = ref(null)

  let requestId = 0
  async function run() {
    const id = ++requestId
    loading.value = true
    error.value = null
    try {
      const f = useIncidentsStore().filters
      const { data, error: err } = await supabase.rpc('incidents_patrol_zones', {
        p_sd: settings.value.sd,
        p_date_from: f.dateFrom || null,
        p_date_to: f.dateTo || null,
        p_barangay: f.barangay || null,
        p_offense: f.offense || null,
        p_case_status: f.caseStatus || null,
        p_search: sanitizeSearch(f.search) || null,
        p_category: settings.value.category || null,
      })
      if (err) throw err
      if (id !== requestId) return
      zones.value = (data || []).map(mapZone)
    } catch (e) {
      if (id === requestId) {
        error.value = e.message || String(e)
        zones.value = []
      }
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function updateSettings(patch) {
    settings.value = { ...settings.value, ...patch }
    run()
  }

  return { settings, zones, loading, error, run, updateSettings }
})
