import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase } from '../lib/supabase'

// Map the snake_case json from incidents_dashboard() to the app's camelCase.
function mapCounts(c) {
  return {
    total: c.total,
    crime: c.crime,
    traffic: c.traffic,
    solved: c.solved,
    cleared: c.cleared,
  }
}

function mapStats(d) {
  return {
    ...mapCounts(d),
    underInvestigation: d.under_investigation,
    prev: d.prev ? mapCounts(d.prev) : null,
    byStatus: d.by_status,
    byMonth: d.by_month,
    byBarangay: d.by_barangay,
    byOffense: d.by_offense.map((o) => ({
      label: o.label,
      offenseType: o.offense_type,
      count: o.count,
    })),
    byDowHour: d.by_dow_hour,
    dateMin: d.date_min,
    dateMax: d.date_max,
  }
}

export const useDashboardStore = defineStore('dashboard', () => {
  const stats = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // period: 'all' or a year number. category: '' (all) | 'crime' | 'traffic'.
  const period = ref('all')
  const category = ref('')

  const dateRange = computed(() =>
    period.value === 'all'
      ? { dateFrom: '', dateTo: '' }
      : { dateFrom: `${period.value}-01-01`, dateTo: `${period.value}-12-31` }
  )

  // Years covered by the data, newest first, for the period picker.
  const years = computed(() => {
    if (!stats.value?.dateMin) return []
    const first = Number(stats.value.dateMin.slice(0, 4))
    const last = Number(stats.value.dateMax.slice(0, 4))
    const out = []
    for (let y = last; y >= first; y--) out.push(y)
    return out
  })

  let requestId = 0
  async function fetchDashboard() {
    const id = ++requestId
    loading.value = true
    error.value = null
    try {
      const { dateFrom, dateTo } = dateRange.value
      const { data, error: err } = await supabase.rpc('incidents_dashboard', {
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_category: category.value || null,
      })
      if (err) throw err
      // A newer request was started while this one was in flight; drop it.
      if (id !== requestId) return
      stats.value = mapStats(data)
    } catch (e) {
      if (id === requestId) error.value = e.message || String(e)
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function setPeriod(p) {
    period.value = p
    fetchDashboard()
  }

  function setCategory(c) {
    category.value = c
    fetchDashboard()
  }

  return {
    stats,
    loading,
    error,
    period,
    category,
    dateRange,
    years,
    fetchDashboard,
    setPeriod,
    setCategory,
  }
})
