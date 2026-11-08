import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

// "JUAN DELA CRUZ JR" -> "Juan Dela Cruz Jr" (source text is all caps).
export function titleName(s) {
  if (!s) return ''
  return s.toLowerCase().replace(/(^|[\s\-.'(])([a-zñ])/g, (_, p, c) => p + c.toUpperCase())
}

// Estimated birth-year range -> "b. ~1986" / "b. ~1985–1988" / null.
export function bornLabel(min, max) {
  if (min == null) return null
  return min === max ? `b. ~${min}` : `b. ~${min}–${max}`
}

function mapRow(r) {
  return {
    id: r.id,
    displayName: r.display_name,
    suffix: r.suffix,
    sex: r.sex,
    asSuspect: r.as_suspect ?? 0,
    asVictim: r.as_victim ?? 0,
    blotters: r.blotters ?? 0,
    lastDate: r.last_date,
    birthYearMin: r.birth_year_min,
    birthYearMax: r.birth_year_max,
    aliases: r.aliases || [],
    barangays: r.barangays || [],
    lastSuspectStatus: r.last_suspect_status,
    score: r.score,
  }
}

function mapDetail(d) {
  const s = d.stats || {}
  return {
    ...mapRow({ ...s, id: d.id, display_name: d.display_name, suffix: d.suffix, sex: d.sex }),
    createdAt: d.created_at,
    mentions: (d.mentions || []).map((m) => ({
      mentionId: m.mention_id,
      id: m.incident_id, // incident id (so CaseMap / incident links work)
      blotterno: m.blotterno,
      role: m.role,
      name: m.name,
      alias: m.alias,
      age: m.age,
      estBirthYear: m.est_birth_year,
      status: m.status,
      occupation: m.occupation,
      linkSource: m.link_source,
      dateCommitted: m.date_committed,
      timeCommitted: m.time_committed,
      offense: m.offense,
      incidentType: m.incident_type,
      barangay: m.barangay,
      caseStatus: m.case_status,
      lat: m.lat != null ? Number(m.lat) : null,
      lng: m.lng != null ? Number(m.lng) : null,
      coordFlag: m.coord_flag,
    })),
    associates: (d.associates || []).map((a) => ({
      id: a.id,
      displayName: a.display_name,
      roles: a.roles || [],
      shared: a.shared,
    })),
    investigations: (d.investigations || []).map((v) => ({
      id: v.id,
      caseNo: v.case_no,
      title: v.title,
      status: v.status,
    })),
  }
}

function mapMatch(m) {
  const side = (p) => ({
    id: p.id,
    displayName: p.display_name,
    suffix: p.suffix,
    sex: p.sex,
    blotters: p.blotters,
    birthYearMin: p.birth_year_min,
    birthYearMax: p.birth_year_max,
  })
  return {
    a: side(m.a),
    b: side(m.b),
    similarity: Number(m.similarity),
    ageGap: m.age_gap,
    sharedBarangays: m.shared_barangays || [],
    sharedAssociates: m.shared_associates || 0,
    score: Number(m.score),
  }
}

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

// All reads run as the caller (RLS: /persons page); all changes go through
// security-definer RPCs that re-check access and write person_events.
export const usePersonsStore = defineStore('persons', () => {
  const filters = ref({ query: '', role: '', repeatOnly: true })
  const results = ref([])
  const loading = ref(false)
  const error = ref(null)

  let requestId = 0
  async function search() {
    const id = ++requestId
    loading.value = true
    error.value = null
    try {
      const f = filters.value
      const data = await must(
        supabase.rpc('persons_search', {
          p_query: f.query.trim() || null,
          p_role: f.role || null,
          // Searching a name should find one-off mentions too.
          p_min_blotters: f.repeatOnly && !f.query.trim() ? 2 : 1,
          p_limit: 200,
        })
      )
      if (id === requestId) results.value = (data || []).map(mapRow)
    } catch (e) {
      if (id === requestId) error.value = e.message || String(e)
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function setFilters(patch) {
    filters.value = { ...filters.value, ...patch }
    search()
  }

  const current = ref(null)
  const currentLoading = ref(false)
  const currentError = ref(null)

  async function fetchPerson(id, { logView = true } = {}) {
    currentLoading.value = true
    currentError.value = null
    try {
      const data = await must(supabase.rpc('person_detail', { p_id: id }))
      if (!data) throw new Error('Person not found (it may have been merged into another record)')
      current.value = mapDetail(data)
      if (logView) supabase.rpc('log_person_view', { p_id: id }).then(() => {})
    } catch (e) {
      current.value = null
      currentError.value = e.message || String(e)
    } finally {
      currentLoading.value = false
    }
  }

  async function fetchMatches({ personId = null, includeAgeConflict = false, limit = 50 } = {}) {
    const data = await must(
      supabase.rpc('person_match_candidates', {
        p_person: personId,
        p_include_age_conflict: includeAgeConflict,
        p_limit: limit,
      })
    )
    return (data || []).map(mapMatch)
  }

  const merge = (keepId, mergeId) => must(supabase.rpc('merge_persons', { p_keep: keepId, p_merge: mergeId }))
  const split = (mentionId) => must(supabase.rpc('split_person_mention', { p_mention: mentionId }))
  const notSame = (a, b) => must(supabase.rpc('mark_persons_not_same', { p_a: a, p_b: b }))

  // People named on one incident, with how many blotters each appears in.
  async function forIncident(incidentId) {
    const rows = await must(
      supabase
        .from('incident_persons')
        .select('id, role, position, name, alias, age, sex, status, placeholder, person_id')
        .eq('incident_id', incidentId)
        .order('role', { ascending: false }) // suspects first
        .order('position')
    )
    const ids = [...new Set(rows.map((r) => r.person_id).filter(Boolean))]
    const counts = new Map()
    if (ids.length) {
      const stats = await must(supabase.from('person_stats').select('person_id, blotters').in('person_id', ids))
      for (const s of stats) counts.set(s.person_id, s.blotters)
    }
    return rows.map((r) => ({
      mentionId: r.id,
      role: r.role,
      name: r.name,
      alias: r.alias,
      age: r.age,
      sex: r.sex,
      status: r.status,
      placeholder: r.placeholder,
      personId: r.person_id,
      blotters: counts.get(r.person_id) ?? null,
    }))
  }

  return {
    filters,
    results,
    loading,
    error,
    search,
    setFilters,
    current,
    currentLoading,
    currentError,
    fetchPerson,
    fetchMatches,
    merge,
    split,
    notSame,
    forIncident,
  }
})
