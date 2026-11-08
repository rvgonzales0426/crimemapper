import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 50
const TABLE = 'incidents'
// Supabase's PostgREST caps every response at 1000 rows by default, whatever
// .limit() asks for. Anything that needs more must page through with .range().
const MAX_ROWS = 1000
const MAP_LIMIT = 5000

// Page through a query in MAX_ROWS chunks until it runs dry or hits `limit`.
// `build` must return a fresh, deterministically-ordered query builder each call.
async function fetchAllRows(build, limit = Infinity) {
  const rows = []
  for (let from = 0; from < limit; from += MAX_ROWS) {
    const to = Math.min(from + MAX_ROWS, limit) - 1
    const { data, error } = await build().range(from, to)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < to - from + 1) break
  }
  return rows
}

// Map a snake_case DB row to the camelCase shape used across the app.
export function mapRow(r) {
  return {
    id: r.id,
    blotterno: r.blotterno,
    dateEncoded: r.date_encoded,
    ppo: r.ppo,
    stn: r.stn,
    region: r.region,
    municipal: r.municipal,
    barangay: r.barangay,
    street: r.street,
    typeOfPlace: r.type_of_place,
    dateReported: r.date_reported,
    timeReported: r.time_reported,
    dateCommitted: r.date_committed,
    timeCommitted: r.time_committed,
    incidentType: r.incident_type,
    offense: r.offense,
    offenseType: r.offense_type,
    modus: r.modus,
    victimRaw: r.victim_raw,
    suspectRaw: r.suspect_raw,
    narrative: r.narrative,
    caseStatus: r.case_status,
    caseSolveType: r.case_solve_type,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    committedAt: r.committed_at,
    coordFlag: r.coord_flag,
  }
}

// Strip characters that would break PostgREST `.or()` filter syntax.
export function sanitizeSearch(term) {
  return term.replace(/[,()*]/g, ' ').trim()
}

export const SEARCH_COLUMNS = [
  'blotterno',
  'barangay',
  'offense',
  'incident_type',
  'victim_raw',
  'suspect_raw',
  'narrative',
  'case_status',
]

export const useIncidentsStore = defineStore('incidents', () => {
  // --- Table (paginated) ---
  const incidents = ref([])
  const loading = ref(false)
  const error = ref(null)

  const page = ref(1)
  const pageSize = ref(PAGE_SIZE)
  const totalCount = ref(0)
  const totalPages = computed(() =>
    Math.max(1, Math.ceil(totalCount.value / pageSize.value))
  )

  // --- Filters (shared by table + map) ---
  const filters = ref({
    search: '',
    dateFrom: '',
    dateTo: '',
    barangay: '',
    offense: '',
    caseStatus: '',
  })
  const filterOptions = ref({ barangays: [], offenses: [], caseStatuses: [] })

  // --- Map (all matching points, not paginated) ---
  const mapIncidents = ref([])
  const mapLoading = ref(false)
  const mapError = ref(null)

  // --- KDE density surface (grid cells from the incidents_kde_grid RPC) ---
  const kdeCells = ref([])
  const kdeLoading = ref(false)

  // Apply the active filters to a Supabase query builder.
  function applyFiltersTo(query) {
    const f = filters.value
    if (f.barangay) query = query.eq('barangay', f.barangay)
    if (f.offense) query = query.eq('offense', f.offense)
    if (f.caseStatus) query = query.eq('case_status', f.caseStatus)
    if (f.dateFrom) query = query.gte('date_committed', f.dateFrom)
    if (f.dateTo) query = query.lte('date_committed', f.dateTo)

    const term = sanitizeSearch(f.search)
    if (term) {
      const like = `*${term}*`
      query = query.or(
        SEARCH_COLUMNS.map((c) => `${c}.ilike.${like}`).join(',')
      )
    }
    return query
  }

  async function fetchIncidents() {
    loading.value = true
    error.value = null
    try {
      const from = (page.value - 1) * pageSize.value
      const to = from + pageSize.value - 1

      let query = supabase.from(TABLE).select('*', { count: 'exact' })
      query = applyFiltersTo(query)
        .order('date_committed', { ascending: false, nullsFirst: false })
        .range(from, to)

      const { data, count, error: err } = await query
      if (err) throw err

      incidents.value = (data || []).map(mapRow)
      totalCount.value = count || 0
    } catch (e) {
      error.value = e.message || String(e)
      incidents.value = []
      totalCount.value = 0
    } finally {
      loading.value = false
    }
  }

  // Excludes coord_flag'd rows (missing coords or a stacked default pin) — those
  // aren't real locations. The KDE RPC excludes them the same way.
  async function fetchMapIncidents() {
    mapLoading.value = true
    mapError.value = null
    try {
      const data = await fetchAllRows(
        () =>
          applyFiltersTo(
            supabase
              .from(TABLE)
              .select('id, blotterno, date_committed, barangay, offense, lat, lng')
              .not('lat', 'is', null)
              .not('lng', 'is', null)
              .is('coord_flag', null)
          ).order('id'),
        MAP_LIMIT
      )
      mapIncidents.value = data.map(mapRow)
    } catch (e) {
      mapError.value = e.message || String(e)
      mapIncidents.value = []
    } finally {
      mapLoading.value = false
    }
  }

  // The grid comes back as one JSON value (not a row set) so the row cap
  // can't truncate it. See supabase/migrations/*_kde_grid_json.sql.
  async function fetchKde({ bandwidthM = 400, cellM = 150 } = {}) {
    kdeLoading.value = true
    mapError.value = null
    try {
      const f = filters.value
      const { data, error: err } = await supabase.rpc('incidents_kde_grid', {
        bandwidth_m: bandwidthM,
        cell_m: cellM,
        p_date_from: f.dateFrom || null,
        p_date_to: f.dateTo || null,
        p_barangay: f.barangay || null,
        p_offense: f.offense || null,
        p_case_status: f.caseStatus || null,
        p_search: sanitizeSearch(f.search) || null,
      })
      if (err) throw err
      kdeCells.value = data || []
    } catch (e) {
      mapError.value = e.message || String(e)
      kdeCells.value = []
    } finally {
      kdeLoading.value = false
    }
  }

  // Distinct values for the dropdowns, scanned across every row.
  async function fetchFilterOptions() {
    let data
    try {
      data = await fetchAllRows(() =>
        supabase.from(TABLE).select('id, barangay, offense, case_status').order('id')
      )
    } catch (e) {
      error.value = e.message || String(e)
      return
    }
    const uniq = (key) =>
      [...new Set(data.map((r) => r[key]).filter(Boolean))].sort()
    filterOptions.value = {
      barangays: uniq('barangay'),
      offenses: uniq('offense'),
      caseStatuses: uniq('case_status'),
    }
  }

  // --- Pagination controls ---
  function setPage(p) {
    const next = Math.min(Math.max(1, p), totalPages.value)
    if (next !== page.value) {
      page.value = next
      fetchIncidents()
    }
  }
  function nextPage() {
    setPage(page.value + 1)
  }
  function prevPage() {
    setPage(page.value - 1)
  }

  // --- Filter mutations (reset to page 1 and refetch the table) ---
  function applyFilters(patch) {
    filters.value = { ...filters.value, ...patch }
    page.value = 1
    fetchIncidents()
  }

  function resetFilters() {
    filters.value = {
      search: '',
      dateFrom: '',
      dateTo: '',
      barangay: '',
      offense: '',
      caseStatus: '',
    }
    page.value = 1
    fetchIncidents()
  }

  return {
    // table
    incidents,
    loading,
    error,
    page,
    pageSize,
    totalCount,
    totalPages,
    // filters
    filters,
    filterOptions,
    // map
    mapIncidents,
    mapLoading,
    mapError,
    kdeCells,
    kdeLoading,
    // actions
    fetchIncidents,
    fetchMapIncidents,
    fetchKde,
    fetchFilterOptions,
    setPage,
    nextPage,
    prevPage,
    applyFilters,
    resetFilters,
  }
})
