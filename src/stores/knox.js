import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useIncidentsStore } from './incidents'

// Map a snake_case analysis point to camelCase, adding the integer day number
// the Knox test bins on.
function mapPoint(p) {
  return {
    id: p.id,
    blotterno: p.blotterno,
    lat: Number(p.lat),
    lng: Number(p.lng),
    x: Number(p.x),
    y: Number(p.y),
    dateCommitted: p.date_committed,
    day: Math.round(Date.parse(p.date_committed) / 86400000),
    barangay: p.barangay,
    offenses: p.offenses,
  }
}

// Same search sanitising as the incidents store, so all views match.
const sanitizeSearch = (term) => term.replace(/[,()*]/g, ' ').trim()

export const useKnoxStore = defineStore('knox', () => {
  // Analysis settings (see DEFAULT_OPTIONS in lib/knox.js).
  const settings = ref({
    spatialBand: 100,
    temporalBand: 7,
    iterations: 99,
    includeTraffic: false,
  })

  const points = ref([])
  const result = ref(null)
  const loading = ref(false)
  const error = ref(null)

  let worker = null
  let requestId = 0

  function getWorker() {
    if (!worker) {
      worker = new Worker(new URL('../workers/knox.worker.js', import.meta.url), {
        type: 'module',
      })
    }
    return worker
  }

  function runInWorker(pts, options) {
    const w = getWorker()
    const id = requestId
    return new Promise((resolve, reject) => {
      const onMessage = (e) => {
        if (e.data.id !== id) return
        w.removeEventListener('message', onMessage)
        if (e.data.error) reject(new Error(e.data.error))
        else resolve(e.data.result)
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ id, points: pts, options })
    })
  }

  // Fetch points under the shared map filters, then run the test.
  async function run() {
    const id = ++requestId
    loading.value = true
    error.value = null
    try {
      const f = useIncidentsStore().filters
      const s = settings.value
      const { data, error: err } = await supabase.rpc('incidents_analysis_points', {
        p_date_from: f.dateFrom || null,
        p_date_to: f.dateTo || null,
        p_barangay: f.barangay || null,
        p_offense: f.offense || null,
        p_case_status: f.caseStatus || null,
        p_search: sanitizeSearch(f.search) || null,
        p_category: s.includeTraffic ? null : 'crime',
      })
      if (err) throw err
      if (id !== requestId) return
      const pts = (data || []).map(mapPoint)

      const res = await runInWorker(
        pts.map(({ x, y, day }) => ({ x, y, day })),
        { spatialBand: s.spatialBand, temporalBand: s.temporalBand, iterations: s.iterations }
      )
      if (id !== requestId) return
      points.value = pts
      result.value = res
    } catch (e) {
      if (id === requestId) error.value = e.message || String(e)
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function updateSettings(patch) {
    settings.value = { ...settings.value, ...patch }
    run()
  }

  return { settings, points, result, loading, error, run, updateSettings }
})
